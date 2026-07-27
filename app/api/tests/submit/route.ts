import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 60;
const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const MODEL = "claude-sonnet-4-5-20250929";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const { assignment_id, answers } = await request.json() as {
    assignment_id: string;
    answers: { question_id: string; answer: unknown }[];
  };

  const admin = createAdminClient();

  const { data: assignment } = await admin
    .from("test_assignments")
    .select("id, student_id, test_id, tests(show_results)")
    .eq("id", assignment_id).single();
  if (!assignment || assignment.student_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: questions } = await admin
    .from("test_questions")
    .select("id, question_type, question_data, words(text)")
    .eq("test_id", assignment.test_id);

  const qMap = new Map((questions??[]).map(q=>[q.id,q]));

  let scoreRaw = 0;
  const answerRows: object[] = [];

  for (const { question_id, answer } of answers) {
    const q = qMap.get(question_id);
    if (!q) continue;
    const d = q.question_data as Record<string,unknown>;
    const word = Array.isArray(q.words)?q.words[0]:q.words;
    const wordText = (word as {text?:string}|null)?.text??"";

    let isCorrect = false;
    let answerText = "";
    let grammarScore: number|null = null;
    let usageScore: number|null = null;
    let naturalnessScore: number|null = null;
    let aiFeedback: string|null = null;

    switch (q.question_type) {
      case "true_false": {
        const val = answer===true||answer==="true";
        isCorrect = val===Boolean(d.correct_answer);
        answerText = val?"True":"False";
        break;
      }
      case "multiple_choice":
      case "sentence_completion": {
        const idx = Number(answer);
        const opts = d.options as string[];
        isCorrect = idx===Number(d.correct_index);
        answerText = opts?.[idx]??String(answer);
        break;
      }
      case "fill_blank": {
        answerText = String(answer).trim().toLowerCase();
        isCorrect = answerText===String(d.correct_word).trim().toLowerCase();
        answerText = String(answer);
        break;
      }
      case "matching": {
        // chosen[wordIndex] = definitionIndex the student picked
        const chosen = (Array.isArray(answer)?answer:[]).map(Number);
        const words = (d.words as string[]??[]);
        const definitions = (d.definitions as string[]??[]);
        const pairs = (d.pairs as {word:string;definition:string}[]??[]);

        // Grade: for each word, check if the student picked the definition
        // that actually belongs to that word
        isCorrect = chosen.length > 0 && chosen.length === words.length &&
          chosen.every((defIdx, wordIdx) => {
            const pickedDef = definitions[defIdx];
            // Find what the correct definition for this word is
            const correctDef = pairs.find(p => p.word === words[wordIdx])?.definition
              ?? pairs[wordIdx]?.definition;
            return pickedDef === correctDef;
          });
        answerText = chosen.map((di, wi) =>
          `${words[wi]??wi} → ${definitions[di]??di}`
        ).join(" | ");
        break;
      }
      case "write_sentence": {
        answerText = String(answer).trim();
        // AI grades writing immediately
        try {
          const res = await ai.messages.create({
            model:MODEL, max_tokens:400,
            messages:[{role:"user",content:`
You are grading an ESL student's sentence for the word "${wordText}".
Sentence: "${answerText}"
Grade kindly. Respond with ONLY this JSON:
{"is_correct":true,"grammar_score":0.9,"usage_score":1.0,"naturalness_score":0.8,"feedback":"one warm encouraging sentence"}
            `}]
          });
          const text = res.content.filter(b=>b.type==="text").map(b=>(b as {text:string}).text).join("");
          const m = text.match(/\{[\s\S]*\}/);
          if (m) {
            const g = JSON.parse(m[0]);
            isCorrect = Boolean(g.is_correct);
            grammarScore = Number(g.grammar_score??0.5);
            usageScore = Number(g.usage_score??0.5);
            naturalnessScore = Number(g.naturalness_score??0.5);
            aiFeedback = String(g.feedback??"");
          }
        } catch { isCorrect = answerText.toLowerCase().includes(wordText.toLowerCase()); }
        break;
      }
    }
    if (isCorrect) scoreRaw++;
    answerRows.push({
      assignment_id, question_id, student_id:user.id,
      student_answer:answerText, is_correct:isCorrect,
      grammar_score:grammarScore, usage_score:usageScore,
      naturalness_score:naturalnessScore, ai_feedback:aiFeedback,
    });
  }

  await admin.from("test_answers").insert(answerRows);

  const test = Array.isArray(assignment.tests)?assignment.tests[0]:assignment.tests;
  const immediate = (test as {show_results?:string}|null)?.show_results==="immediate";

  await admin.from("test_assignments").update({
    completed_at: new Date().toISOString(),
    score_raw: scoreRaw,
    score_total: answers.length,
    results_visible: immediate,
  }).eq("id", assignment_id);

  return NextResponse.json({ ok:true, score_raw:scoreRaw, score_total:answers.length, immediate });
}
