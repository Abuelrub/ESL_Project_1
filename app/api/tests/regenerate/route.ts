// Regenerate a single question with AI
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 30;
const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const MODEL = "claude-sonnet-4-5-20250929";
const LEVEL_FOR: Record<string,number> = { easy:2, medium:3, hard:4 };

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const { question_id, test_id } = await request.json();
  const admin = createAdminClient();

  const { data: test } = await supabase
    .from("tests").select("teacher_id, course_id").eq("id", test_id).single();
  if (!test || test.teacher_id !== user.id) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  const { data: q } = await admin.from("test_questions")
    .select("id, question_type, difficulty, word_id, words(text)").eq("id", question_id).single();
  if (!q) return NextResponse.json({ error: "Question not found" }, { status: 404 });

  const word = Array.isArray(q.words) ? q.words[0] : q.words;
  const wordText = (word as {text?:string}|null)?.text ?? "";
  const level = LEVEL_FOR[q.difficulty] ?? 2;

  // Get distractors from the course
  const { data: units } = await admin.from("units").select("id").eq("course_id", test.course_id);
  const { data: words } = await admin.from("words").select("text")
    .in("unit_id", (units??[]).map(u=>u.id)).neq("id", q.word_id ?? "");
  const distractors = (words??[]).map(w=>w.text).sort(()=>Math.random()-0.5).slice(0,6);

  const schemas: Record<string,string> = {
    true_false:`{"statement":"...","correct_answer":true,"explanation":"...","hint":"..."}`,
    multiple_choice:`{"question":"What does '${wordText}' mean?","options":["opt1","opt2","opt3","opt4"],"correct_index":0,"explanation":"...","hint":"..."}`,
    fill_blank:`{"sentence":"sentence with ___ .","options":["${wordText}","w2","w3","w4"],"correct_word":"${wordText}","explanation":"...","hint":"..."}`,
    matching:`{"pairs":[{"word":"${wordText}","definition":"..."},{"word":"other1","definition":"..."},{"word":"other2","definition":"..."}],"explanation":"...","hint":"..."}`,
    write_sentence:`{"instruction":"Write a sentence using '${wordText}'.","hint":"Think about what ${wordText} means."}`,
  };
  const desiredBool = Math.random()<0.5;
  const typeNote = q.question_type==="true_false"
    ? `Statement MUST be ${desiredBool}. Set correct_answer to ${desiredBool}.`
    : q.question_type==="fill_blank" ? `Wrong options from: ${distractors.join(", ")}.` : "";

  const prompt = `Create ONE vocabulary question for a Novice 2 ESL student.
Word: "${wordText}", Type: ${q.question_type}, Level: ${level}/5. ${typeNote}
Simple English. Respond ONLY with this JSON: ${schemas[q.question_type]??schemas.multiple_choice}`;

  try {
    const res = await ai.messages.create({
      model:MODEL, max_tokens:400,
      messages:[{role:"user",content:prompt}]
    });
    const text = res.content.filter(b=>b.type==="text").map(b=>(b as {text:string}).text).join("");
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("No JSON");
    const data = JSON.parse(m[0]);

    // Shuffle options
    if ((q.question_type==="multiple_choice") && Array.isArray(data.options)) {
      const correct = data.options[data.correct_index];
      data.options.sort(()=>Math.random()-0.5);
      data.correct_index = data.options.indexOf(correct);
    }
    if (q.question_type==="fill_blank" && Array.isArray(data.options)) {
      data.options.sort(()=>Math.random()-0.5);
    }

    await admin.from("test_questions").update({
      question_data: data, teacher_edited: false
    }).eq("id", question_id);

    return NextResponse.json({ ok: true, question_data: data });
  } catch(e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "AI failed" }, { status: 502 });
  }
}
