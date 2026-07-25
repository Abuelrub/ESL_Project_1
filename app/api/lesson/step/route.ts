import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { QuestionType, shuffleWithMap, startingLevel } from "@/lib/adaptive";
import { generateLessonQuestion } from "@/lib/ai";

export const maxDuration = 30;

// Fixed pedagogy per lesson step:
//   step 3 = quick check (true/false or multiple choice)
//   step 4 = fill in the blank
//   step 5 = write your own sentence
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const { session_id, word_id, step } = await request.json();
  const admin = createAdminClient();

  const { data: session } = await admin
    .from("practice_sessions")
    .select("id, student_id, unit_id, course_id")
    .eq("id", session_id).single();
  if (!session || session.student_id !== user.id) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const { data: word } = await admin
    .from("words").select("id, text, difficulty, unit_id, part").eq("id", word_id).single();
  if (!word) return NextResponse.json({ error: "Word not found" }, { status: 404 });

  const { data: prog } = await admin
    .from("word_progress").select("current_level")
    .eq("student_id", user.id).eq("word_id", word_id).maybeSingle();

  const level = prog?.current_level ?? startingLevel(word.difficulty as "easy" | "hard");

  let type: QuestionType;
  if (step === 3) {
    // Alternate between true_false and multiple_choice across visits so both
    // formats are guaranteed to appear during practice
    const { count: tfCount } = await admin
      .from("questions").select("*", { count: "exact", head: true })
      .eq("student_id", user.id).eq("word_id", word_id).eq("question_type", "true_false");
    const { count: mcCount } = await admin
      .from("questions").select("*", { count: "exact", head: true })
      .eq("student_id", user.id).eq("word_id", word_id).eq("question_type", "multiple_choice");
    type = (tfCount ?? 0) <= (mcCount ?? 0) ? "true_false" : "multiple_choice";
  } else if (step === 4) type = "fill_blank";
  else if (step === 5) type = "write_sentence";
  else return NextResponse.json({ error: "Bad step" }, { status: 400 });

  // Word pool across the course with unit order + part (for distractors and context)
  const { data: units } = await admin
    .from("units").select("id, order_index").eq("course_id", session.course_id);
  const unitOrder = new Map((units ?? []).map((u) => [u.id, u.order_index]));
  const { data: courseWords } = await admin
    .from("words").select("id, text, unit_id, part")
    .in("unit_id", (units ?? []).map((u) => u.id))
    .neq("id", word.id);

  const sameUnit = (courseWords ?? []).filter((w) => w.unit_id === word.unit_id);
  const distractorSource = sameUnit.length >= 3 ? sameUnit : (courseWords ?? []);
  const distractors = distractorSource
    .map((w) => w.text).sort(() => Math.random() - 0.5).slice(0, 6);

  // Context words: earlier units, or earlier part of this unit — used inside sentences
  const wOrder = unitOrder.get(word.unit_id) ?? 0;
  const wPart = (word as { part?: number }).part ?? 1;
  const contextWords = (courseWords ?? [])
    .filter((w) => {
      const cOrder = unitOrder.get(w.unit_id) ?? 0;
      return cOrder < wOrder || (cOrder === wOrder && (w.part ?? 1) < wPart);
    })
    .map((w) => w.text)
    .sort(() => Math.random() - 0.5)
    .slice(0, 4);

  const desiredBool = Math.random() < 0.5;

  const questionLevel = Math.min(step === 4 ? level + 1 : level, 5);
  const useWordForms = type === "fill_blank" && questionLevel >= 4;

  let qData: Record<string, unknown>;
  try {
    qData = await generateLessonQuestion(
      type, word.text, questionLevel, distractors, desiredBool, contextWords, useWordForms
    );
  } catch {
    return NextResponse.json({ error: "AI could not create a question, try again" }, { status: 502 });
  }

  // Server-side shuffle (same anti-bias rules as the quiz)
  if (type === "multiple_choice") {
    const { shuffled, newIndexOf } = shuffleWithMap(qData.options as string[]);
    qData.options = shuffled;
    qData.correct_index = newIndexOf[Number(qData.correct_index)];
  } else if (type === "fill_blank") {
    const { shuffled } = shuffleWithMap(qData.options as string[]);
    qData.options = shuffled;
  }

  const { data: saved, error: saveErr } = await admin
    .from("questions")
    .insert({
      session_id,
      student_id: user.id,
      word_id: word.id,
      question_type: type,
      difficulty_level: level,
      question_data: qData,
    })
    .select("id").single();

  if (saveErr || !saved) {
    return NextResponse.json({ error: "Could not save question" }, { status: 500 });
  }

  const publicData: Record<string, unknown> = { ...qData };
  delete publicData.correct_index;
  delete publicData.correct_answer;
  delete publicData.correct_word;
  delete publicData.explanation;

  return NextResponse.json({
    question_id: saved.id,
    type,
    level,
    hint: String(qData.hint ?? ""),
    data: publicData,
  });
}
