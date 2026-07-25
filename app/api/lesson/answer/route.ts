import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { startingLevel } from "@/lib/adaptive";
import { gradeAnswer } from "@/lib/grading";

export const maxDuration = 30;
const MAX_ATTEMPTS = 3;

// PRACTICE-MODE ANSWERS: wrong answers get a re-teach + retry (up to 3 tries).
// Every attempt, hint, and outcome is recorded for research.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const { question_id, answer } = await request.json();
  const admin = createAdminClient();

  const { data: q } = await admin
    .from("questions")
    .select("id, student_id, session_id, word_id, question_type, question_data, answered_at, attempts, words(text, difficulty)")
    .eq("id", question_id).single();

  if (!q || q.student_id !== user.id) {
    return NextResponse.json({ error: "Question not found" }, { status: 404 });
  }
  if (q.answered_at) return NextResponse.json({ error: "Already answered" }, { status: 400 });

  const wordRow = Array.isArray(q.words) ? q.words[0] : q.words;
  const wordText = wordRow?.text ?? "";
  const data = q.question_data as Record<string, unknown>;

  // Get student first name for warmer feedback
  const { data: student } = await admin
    .from("profiles").select("full_name").eq("id", user.id).single();
  const firstName = (student?.full_name ?? "").split(" ")[0];

  const attemptNumber = (q.attempts ?? 0) + 1;
  const graded = await gradeAnswer(q.question_type, data, answer, wordText, firstName);

  // ---------- WRONG but retries remain: re-teach and let them try again ----------
  if (!graded.isCorrect && attemptNumber < MAX_ATTEMPTS) {
    await admin.from("questions")
      .update({ attempts: attemptNumber, student_answer: graded.answerText })
      .eq("id", q.id);

    return NextResponse.json({
      retry: true,
      attempts_left: MAX_ATTEMPTS - attemptNumber,
      teach: graded.feedback || `Not quite. Remember what "${wordText}" means and try again!`,
      mistake: graded.mistake,
      suggestion: graded.suggestion,
      why_right: graded.whyRight,
      why_wrong: graded.whyWrong,
      extra_example: graded.extraExample,
      improved: graded.improved,
      correct_display: graded.correctDisplay,
    });
  }

  // ---------- FINALIZE (correct, or out of retries) ----------
  const firstTryCorrect = graded.isCorrect && attemptNumber === 1;

  await admin.from("questions")
    .update({
      attempts: attemptNumber,
      student_answer: graded.answerText,
      is_correct: graded.isCorrect,
      ai_feedback: graded.feedback,
      answered_at: new Date().toISOString(),
    })
    .eq("id", q.id);

  // Word progress: every finished check = 1 practice.
  // Level: up only on first-try correct; never down in practice mode.
  const { data: prog } = await admin
    .from("word_progress")
    .select("practice_count, correct_count, current_level")
    .eq("student_id", user.id).eq("word_id", q.word_id).maybeSingle();

  const baseLevel =
    prog?.current_level ??
    startingLevel((wordRow?.difficulty as "easy" | "hard") ?? "easy");

  await admin.from("word_progress").upsert(
    {
      student_id: user.id,
      word_id: q.word_id,
      practice_count: (prog?.practice_count ?? 0) + 1,
      correct_count: (prog?.correct_count ?? 0) + (firstTryCorrect ? 1 : 0),
      current_level: firstTryCorrect ? Math.min(5, baseLevel + 1) : baseLevel,
      last_practiced: new Date().toISOString(),
    },
    { onConflict: "student_id,word_id" }
  );

  const { data: session } = await admin
    .from("practice_sessions")
    .select("total_questions, correct_answers")
    .eq("id", q.session_id).single();
  if (session) {
    await admin.from("practice_sessions")
      .update({
        total_questions: session.total_questions + 1,
        correct_answers: session.correct_answers + (graded.isCorrect ? 1 : 0),
      })
      .eq("id", q.session_id);
  }

  return NextResponse.json({
    is_correct: graded.isCorrect,
    first_try: firstTryCorrect,
    correct_display: graded.correctDisplay,
    feedback: graded.feedback,
    mistake: graded.mistake,
    suggestion: graded.suggestion,
    why_right: graded.whyRight,
    why_wrong: graded.whyWrong,
    extra_example: graded.extraExample,
    improved: graded.improved,
  });
}
