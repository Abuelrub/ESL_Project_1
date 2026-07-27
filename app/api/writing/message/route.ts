import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 30;
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const MODEL = "claude-sonnet-4-5-20250929";
const SENTENCES_PER_SESSION = 5;
const CORRECT_FOR_EVALUATED = 3;

interface ChatMessage { role: "user" | "assistant"; content: string }

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const { session_id, sentence, history } = await request.json() as {
    session_id: string;
    sentence: string;
    history: ChatMessage[];
  };

  const admin = createAdminClient();

  const [{ data: session }, { data: profile }] = await Promise.all([
    admin.from("writing_sessions")
      .select("id, student_id, word_id, sentences_attempted, sentences_correct")
      .eq("id", session_id).single(),
    admin.from("profiles").select("full_name").eq("id", user.id).single(),
  ]);

  if (!session || session.student_id !== user.id) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const { data: word } = await admin
    .from("words").select("text, difficulty").eq("id", session.word_id).single();
  const wordText = word?.text ?? "";
  const firstName = (profile?.full_name ?? "Student").split(" ")[0];
  const turnNumber = session.sentences_attempted + 1;

  const systemPrompt = `You are a warm, expert ESL writing tutor working directly with ${firstName}, a Novice 2 (beginner) adult English learner.

The student is practicing the vocabulary word: "${wordText}"

Your job for EACH sentence the student writes:
1. Judge whether the word "${wordText}" is used CORRECTLY in meaning and grammar.
2. Give warm, specific, encouraging feedback directly to ${firstName}.
3. If there are grammar mistakes, show the correction clearly.
4. If the sentence is correct, challenge them to write a NEW sentence with a DIFFERENT context or idea.
5. If the sentence is incorrect, explain simply WHY and ask them to try again.

SCORING RULES (you must include these exact JSON fields at the END of every response):
- is_correct: true only if "${wordText}" is used with the right meaning AND grammar is mostly correct (minor spelling ok)
- grammar_score: 0.0–1.0 (1.0 = perfect grammar)
- usage_score: 0.0–1.0 (1.0 = word used perfectly)
- naturalness_score: 0.0–1.0 (1.0 = sounds like a native speaker)
- grammar_correction: the corrected sentence if grammar was wrong, else empty string
- improved_sentence: a slightly better version of their sentence (even if correct), else empty string

ALWAYS end your response with this exact block on a new line:
<<<SCORES>>>
{"is_correct":true,"grammar_score":0.9,"usage_score":1.0,"naturalness_score":0.8,"grammar_correction":"","improved_sentence":""}
<<<END>>>

TONE RULES:
- Always address ${firstName} by name at least once.
- Keep explanations SHORT and SIMPLE (max 2–3 sentences per point).
- Be warm and encouraging — never harsh.
- For turn ${turnNumber} of ${SENTENCES_PER_SESSION}: ${
  turnNumber === 1
    ? "This is their first sentence. If correct, celebrate and ask for a new context."
    : turnNumber === SENTENCES_PER_SESSION
    ? "This is the LAST sentence. After feedback, tell them the session is complete and summarize their progress."
    : "Keep the conversation going — push them to use the word in a new way."
}`;

  // Build conversation history for the API
  const messages: ChatMessage[] = [
    ...history,
    { role: "user", content: sentence },
  ];

  let fullResponse = "";
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 600,
      system: systemPrompt,
      messages,
    });
    fullResponse = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("");
  } catch {
    return NextResponse.json(
      { error: "AI could not respond, try again" },
      { status: 502 }
    );
  }

  // Extract scores from the response
  let scores = {
    is_correct: false, grammar_score: 0.5, usage_score: 0.5,
    naturalness_score: 0.5, grammar_correction: "", improved_sentence: "",
  };
  const scoresMatch = fullResponse.match(/<<<SCORES>>>\s*(\{[\s\S]*?\})\s*<<<END>>>/);
  if (scoresMatch) {
    try { Object.assign(scores, JSON.parse(scoresMatch[1])); } catch { /* keep defaults */ }
  }

  // Strip the scores block from the chat display text
  const displayText = fullResponse
    .replace(/<<<SCORES>>>[\s\S]*?<<<END>>>/g, "").trim();

  const newAttempted = session.sentences_attempted + 1;
  const newCorrect = session.sentences_correct + (scores.is_correct ? 1 : 0);
  const isDone = newAttempted >= SENTENCES_PER_SESSION;
  const sessionScore = newAttempted > 0
    ? parseFloat((newCorrect / newAttempted).toFixed(2)) : 0;

  // Save the sentence record
  await admin.from("writing_sentences").insert({
    session_id,
    student_id: user.id,
    word_id: session.word_id,
    sentence: sentence.trim(),
    is_correct: scores.is_correct,
    grammar_score: scores.grammar_score,
    usage_score: scores.usage_score,
    naturalness_score: scores.naturalness_score,
    ai_feedback: displayText,
    grammar_correction: scores.grammar_correction || null,
    improved_sentence: scores.improved_sentence || null,
    turn_number: turnNumber,
  });

  // Update session counters
  await admin.from("writing_sessions")
    .update({
      sentences_attempted: newAttempted,
      sentences_correct: newCorrect,
      ...(isDone ? { completed_at: new Date().toISOString(), final_score: sessionScore } : {}),
    })
    .eq("id", session_id);

  // Count all-time correct for this word
  const { count: allTimeCorrect } = await admin
    .from("writing_sentences")
    .select("*", { count: "exact", head: true })
    .eq("student_id", user.id).eq("word_id", session.word_id).eq("is_correct", true);

  const isEvaluated = (allTimeCorrect ?? 0) >= CORRECT_FOR_EVALUATED;

  // Update word_progress writing fields
  const { data: prog } = await admin.from("word_progress")
    .select("writing_attempts, writing_correct")
    .eq("student_id", user.id).eq("word_id", session.word_id).maybeSingle();

  await admin.from("word_progress").upsert({
    student_id: user.id,
    word_id: session.word_id,
    writing_attempts: (prog?.writing_attempts ?? 0) + 1,
    writing_correct: (prog?.writing_correct ?? 0) + (scores.is_correct ? 1 : 0),
    writing_score: isEvaluated ? Math.min(1, (allTimeCorrect ?? 0) / 5) : null,
    last_practiced: new Date().toISOString(),
  }, { onConflict: "student_id,word_id" });

  return NextResponse.json({
    ai_message: displayText,
    is_correct: scores.is_correct,
    grammar_correction: scores.grammar_correction || null,
    improved_sentence: scores.improved_sentence || null,
    turn: newAttempted,
    total: SENTENCES_PER_SESSION,
    session_score: sessionScore,
    is_done: isDone,
    is_evaluated: isEvaluated,
    all_time_correct: allTimeCorrect ?? 0,
  });
}
