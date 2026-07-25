import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { nextLevel, startingLevel } from "@/lib/adaptive";
import { gradeAnswer } from "@/lib/grading";
import { gradeWrittenSentence } from "@/lib/ai";

export const maxDuration = 30;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const { question_id, answer } = await request.json();
  const admin = createAdminClient();

  const { data: q } = await admin
    .from("questions")
    .select("id, student_id, session_id, word_id, question_type, difficulty_level, question_data, answered_at, words(text, difficulty)")
    .eq("id", question_id)
    .single();

  if (!q || q.student_id !== user.id) {
    return NextResponse.json({ error: "Question not found" }, { status: 404 });
  }
  if (q.answered_at) {
    return NextResponse.json({ error: "Already answered" }, { status: 400 });
  }

  const wordRow = Array.isArray(q.words) ? q.words[0] : q.words;
  const wordText = wordRow?.text ?? "";
  const data = q.question_data as Record<string, unknown>;

  // ---------- GRADE (uses shared grading with tutor feedback) ----------
  const { data: student } = await admin
    .from("profiles").select("full_name").eq("id", user.id).single();
  const firstName = (student?.full_name ?? "").split(" ")[0];

  const graded = await gradeAnswer(q.question_type, data, answer, wordText, firstName);
  const isCorrect = graded.isCorrect;
  const correctDisplay = graded.correctDisplay;
  const answerText = graded.answerText;
  const feedback = graded.feedback;

  // ---------- SAVE ANSWER (research record) ----------
  await admin
    .from("questions")
    .update({
      student_answer: answerText,
      is_correct: isCorrect,
      ai_feedback: feedback,
      answered_at: new Date().toISOString(),
    })
    .eq("id", q.id);

  // ---------- UPDATE ADAPTIVE PROGRESS ----------
  const { data: prog } = await admin
    .from("word_progress")
    .select("practice_count, correct_count, current_level")
    .eq("student_id", user.id)
    .eq("word_id", q.word_id)
    .maybeSingle();

  const baseLevel =
    prog?.current_level ??
    startingLevel((wordRow?.difficulty as "easy" | "hard") ?? "easy");

  await admin.from("word_progress").upsert(
    {
      student_id: user.id,
      word_id: q.word_id,
      practice_count: (prog?.practice_count ?? 0) + 1,
      correct_count: (prog?.correct_count ?? 0) + (isCorrect ? 1 : 0),
      current_level: nextLevel(baseLevel, isCorrect),
      last_practiced: new Date().toISOString(),
    },
    { onConflict: "student_id,word_id" }
  );

  // ---------- UPDATE SESSION COUNTERS ----------
  const { data: session } = await admin
    .from("practice_sessions")
    .select("total_questions, correct_answers")
    .eq("id", q.session_id)
    .single();

  if (session) {
    await admin
      .from("practice_sessions")
      .update({
        total_questions: session.total_questions + 1,
        correct_answers: session.correct_answers + (isCorrect ? 1 : 0),
      })
      .eq("id", q.session_id);
  }

  return NextResponse.json({
    is_correct: isCorrect,
    correct_display: correctDisplay,
    feedback,
    mistake: graded.mistake,
    suggestion: graded.suggestion,
    why_right: graded.whyRight,
    why_wrong: graded.whyWrong,
    extra_example: graded.extraExample,
    improved: graded.improved,
  });
}
