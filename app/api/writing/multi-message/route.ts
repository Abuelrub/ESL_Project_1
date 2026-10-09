import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 30;
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const MODEL = "claude-sonnet-4-5-20250929";
const SENTENCES_PER_SESSION = 5;

interface ChatMessage { role: "user" | "assistant"; content: string }

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const { session_ids, word_ids, words, sentence, history, turn } = await request.json() as {
    session_ids: string[];
    word_ids: string[];
    words: string[];
    sentence: string;
    history: ChatMessage[];
    turn: number;
  };

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles").select("full_name").eq("id", user.id).single();
  const firstName = (profile?.full_name ?? "Student").split(" ")[0];

  const wordList = words.join('", "');
  const systemPrompt = `You are a warm ESL writing tutor working with ${firstName}, a Novice 2 beginner adult.

The student must write ONE sentence using ALL of these words: "${wordList}"

Rules for grading:
- is_correct = true ONLY if ALL ${words.length} words appear in the sentence with correct meaning
- Check each word separately and mention each one in your feedback
- Be encouraging — using multiple words together is hard!
- If some words are correct but others aren't, tell them which ones worked and which need fixing
- For turn ${turn} of ${SENTENCES_PER_SESSION}: ${
  turn === 1
    ? "This is their first try. Encourage them warmly."
    : turn === SENTENCES_PER_SESSION
    ? "This is the last sentence. Summarize what they did well."
    : "Keep encouraging them to try different contexts."
}

After feedback, ask them to write ANOTHER sentence using all the same words in a different context.

End every response with:
<<<SCORES>>>
{"is_correct":true,"grammar_score":0.9,"usage_score":1.0,"naturalness_score":0.8,"word_results":{"word1":true,"word2":true},"grammar_correction":"","improved_sentence":""}
<<<END>>>

where word_results shows true/false for each of: ${words.map(w => `"${w}"`).join(', ')}`;

  const messages: ChatMessage[] = [
    ...history,
    { role: "user", content: sentence },
  ];

  let fullResponse = "";
  try {
    const response = await client.messages.create({
      model: MODEL, max_tokens: 600,
      system: systemPrompt, messages,
    });
    fullResponse = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text).join("");
  } catch {
    return NextResponse.json({ error: "AI could not respond" }, { status: 502 });
  }

  // Parse scores
  let scores = {
    is_correct: false, grammar_score: 0.5, usage_score: 0.5,
    naturalness_score: 0.5, word_results: {} as Record<string, boolean>,
    grammar_correction: "", improved_sentence: "",
  };
  const match = fullResponse.match(/<<<SCORES>>>\s*(\{[\s\S]*?\})\s*<<<END>>>/);
  if (match) {
    try { Object.assign(scores, JSON.parse(match[1])); } catch { /* keep defaults */ }
  }

  const displayText = fullResponse.replace(/<<<SCORES>>>[\s\S]*?<<<END>>>/g, "").trim();
  const newTurn = turn + 1;
  const isDone = newTurn > SENTENCES_PER_SESSION;

  // Save writing sentences
  await Promise.all(
    session_ids.map((sid, i) =>
      admin.from("writing_sentences").insert({
        session_id: sid,
        student_id: user.id,
        word_id: word_ids[i],
        sentence: sentence.trim(),
        is_correct: scores.word_results[words[i]] ?? scores.is_correct,
        grammar_score: scores.grammar_score,
        usage_score: scores.usage_score,
        naturalness_score: scores.naturalness_score,
        ai_feedback: displayText,
        grammar_correction: scores.grammar_correction || null,
        improved_sentence: scores.improved_sentence || null,
        turn_number: turn,
      })
    )
  );

  // Update session counters
  await Promise.all(
    session_ids.map((sid, i) => {
      const wordCorrect = scores.word_results[words[i]] ?? scores.is_correct;
      return admin.from("writing_sessions").update({
        sentences_attempted: turn,
        sentences_correct: wordCorrect ? 1 : 0,
        ...(isDone ? { completed_at: new Date().toISOString() } : {}),
      }).eq("id", sid);
    })
  );

  // Update word_progress for each word — sequential to avoid race conditions
  for (let i = 0; i < word_ids.length; i++) {
    const wordId    = word_ids[i];
    const wordText  = words[i];
    const wordCorrect = scores.word_results[wordText] ?? scores.is_correct;

    // Load existing
    const { data: existing, error: fetchErr } = await admin
      .from("word_progress")
      .select("practice_count, correct_count, current_level, writing_attempts, writing_correct")
      .eq("student_id", user.id)
      .eq("word_id", wordId)
      .maybeSingle();

    if (fetchErr) {
      continue;
    }

    const newPracticeCount   = (existing?.practice_count  ?? 0) + 1;
    const newCorrectCount    = (existing?.correct_count   ?? 0) + (wordCorrect ? 1 : 0);
    const newWritingAttempts = (existing?.writing_attempts ?? 0) + 1;
    const newWritingCorrect  = (existing?.writing_correct  ?? 0) + (wordCorrect ? 1 : 0);
    const currentLevel       = existing?.current_level ?? 1;
    const newLevel           = wordCorrect ? Math.min(5, currentLevel + 1) : Math.max(1, currentLevel);

    const { error: upsertErr } = await admin.from("word_progress").upsert({
      student_id:       user.id,
      word_id:          wordId,
      practice_count:   newPracticeCount,
      correct_count:    newCorrectCount,
      current_level:    newLevel,
      writing_attempts: newWritingAttempts,
      writing_correct:  newWritingCorrect,
      last_practiced:   new Date().toISOString(),
    }, { onConflict: "student_id,word_id" });

    if (upsertErr) {
    } else {
    }
  }

  return NextResponse.json({
    ai_message: displayText,
    is_correct: scores.is_correct,
    word_results: scores.word_results,
    grammar_correction: scores.grammar_correction || null,
    improved_sentence: scores.improved_sentence || null,
    turn: newTurn,
    total: SENTENCES_PER_SESSION,
    is_done: isDone,
  });
}
