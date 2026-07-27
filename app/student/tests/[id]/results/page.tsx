import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function StudentTestResultsPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile("student");
  const { id } = await params;
  const supabase = await createClient();
  const admin    = createAdminClient();

  // Use admin to bypass RLS and always get the latest results_visible value
  const { data: assignment } = await admin
    .from("test_assignments")
    .select("id, student_id, score_raw, score_total, results_visible, completed_at, tests(id, name, test_type)")
    .eq("id", id)
    .eq("student_id", profile.id)
    .single();

  if (!assignment || !assignment.completed_at) notFound();

  if (!assignment.results_visible) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center p-6 text-center max-w-lg mx-auto">
        <p className="text-5xl mb-4">⏳</p>
        <h1 className="text-xl font-bold mb-2">Results not released yet</h1>
        <p className="text-gray-600 mb-6">
          Your teacher is reviewing your answers. Come back soon to see your results and feedback.
        </p>
        <div className="flex gap-3">
          {/* Meta refresh every 30 seconds — no JS needed */}
          <Link href={`/student/tests/${id}/results`}
            className="rounded-xl bg-brand-500 px-5 py-3 font-semibold text-white">
            🔄 Check again
          </Link>
          <Link href="/student/tests"
            className="rounded-xl border border-gray-300 bg-white px-5 py-3 font-semibold">
            Back to tests
          </Link>
        </div>
        {/* Auto-refresh every 30s */}
        <meta httpEquiv="refresh" content="30" />
      </main>
    );
  }

  const test = Array.isArray(assignment.tests) ? assignment.tests[0] : assignment.tests;

  const { data: questions } = await admin
    .from("test_questions")
    .select("id, question_type, difficulty, question_data, words(text)")
    .eq("test_id", (test as { id?: string } | null)?.id ?? "")
    .order("order_index");

  const { data: answers } = await admin
    .from("test_answers")
    .select("question_id, student_answer, is_correct, grammar_score, usage_score, naturalness_score, ai_feedback, teacher_score, teacher_comment")
    .eq("assignment_id", id);

  const ansMap = new Map((answers ?? []).map((a) => [a.question_id, a]));
  const pct = assignment.score_total
    ? Math.round(((assignment.score_raw ?? 0) / assignment.score_total) * 100) : 0;

  return (
    <main className="mx-auto max-w-lg p-4 pb-16">
      <header className="mb-5">
        <Link href="/student/tests" className="text-sm text-gray-500">← My tests</Link>
        <h1 className="mt-1 text-xl font-bold">
          {(test as { name?: string } | null)?.name}
        </h1>
      </header>

      {/* Score banner */}
      <div className={`mb-5 rounded-3xl p-6 text-center text-white shadow-lg ${
        pct >= 80 ? "bg-gradient-to-r from-green-500 to-emerald-600" :
        pct >= 60 ? "bg-gradient-to-r from-amber-400 to-orange-500" :
                   "bg-gradient-to-r from-indigo-500 to-purple-600"
      }`}>
        <p className="text-5xl font-extrabold">{pct}%</p>
        <p className="mt-1 text-lg opacity-90">
          {assignment.score_raw}/{assignment.score_total} correct
        </p>
        <p className="mt-1 text-sm opacity-80">
          {pct >= 80 ? "Excellent work! 🌟" : pct >= 60 ? "Good job! 💪" : "Keep practicing! 📚"}
        </p>
      </div>

      {/* Per question results */}
      <div className="grid gap-3">
        {(questions ?? []).map((q, i) => {
          const a = ansMap.get(q.id);
          const d = q.question_data as Record<string, unknown>;
          const word = Array.isArray(q.words) ? q.words[0] : q.words;

          // Teacher score overrides AI grade
          const correct = a
            ? (a.teacher_score != null ? a.teacher_score === 1 : a.is_correct)
            : false;

          // Build correct answer display
          const correctDisplay =
            q.question_type === "multiple_choice" && d.options && d.correct_index != null
              ? (d.options as string[])[Number(d.correct_index)]
              : q.question_type === "fill_blank" ? String(d.correct_word ?? "")
              : q.question_type === "true_false"
                ? (d.correct_answer ? "True" : "False")
              : q.question_type === "matching" && Array.isArray(d.pairs)
                ? (d.pairs as { word: string; definition: string }[])
                    .map((p) => `${p.word} = ${p.definition}`).join(" · ")
              : null;

          return (
            <div key={q.id}
              className={`rounded-2xl border-2 p-4 ${
                correct ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"
              }`}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-bold text-gray-600">
                  Q{i + 1} · {q.question_type.replace(/_/g, " ")}
                  {word && ` · "${(word as { text?: string }).text}"`}
                </p>
                <span className="text-lg">{correct ? "✅" : "❌"}</span>
              </div>

              {/* Question text */}
              <p className="text-sm text-gray-700 mb-2">
                {String(d.question ?? d.statement ?? d.sentence ?? d.instruction ?? "")}
              </p>

              {/* Student answer */}
              <p className="text-sm font-medium">
                Your answer:{" "}
                <span className={correct ? "text-green-800" : "text-red-800"}>
                  {a?.student_answer ?? "—"}
                </span>
              </p>

              {/* Correct answer (only when wrong) */}
              {!correct && correctDisplay && (
                <p className="text-sm text-gray-700 mt-0.5">
                  Correct answer: <b>{correctDisplay}</b>
                </p>
              )}

              {/* AI feedback */}
              {a?.ai_feedback && (
                <p className="mt-1.5 text-sm text-gray-600 leading-relaxed">
                  {a.ai_feedback}
                </p>
              )}

              {/* Writing scores */}
              {(a?.grammar_score != null || a?.usage_score != null) && (
                <div className="mt-1.5 flex gap-3 text-xs text-gray-500">
                  {a.grammar_score != null && (
                    <span>Grammar: {Math.round(a.grammar_score * 100)}%</span>
                  )}
                  {a.usage_score != null && (
                    <span>Usage: {Math.round(a.usage_score * 100)}%</span>
                  )}
                  {a.naturalness_score != null && (
                    <span>Natural: {Math.round(a.naturalness_score * 100)}%</span>
                  )}
                </div>
              )}

              {/* Teacher comment */}
              {a?.teacher_comment && (
                <div className="mt-2 rounded-xl border border-brand-200 bg-white px-3 py-2">
                  <p className="text-xs font-bold text-brand-700">💬 Teacher comment:</p>
                  <p className="text-sm text-gray-700 mt-0.5">{a.teacher_comment}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-5 text-center">
        <Link href="/student/tests"
          className="rounded-xl border border-gray-300 bg-white px-5 py-3 font-semibold text-gray-700">
          ← Back to my tests
        </Link>
      </div>
    </main>
  );
}
