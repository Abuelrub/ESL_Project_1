import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { MASTERY_COUNT } from "@/lib/adaptive";

export const dynamic = "force-dynamic";

interface StudentStat {
  student_id: string;
  total_questions: number;
  correct_answers: number;
  first_try_correct: number;
  total_hints: number;
  total_attempts: number;
  practice_sessions: number;
  quiz_sessions: number;
}
interface WordStat {
  word_id: string;
  word_text: string;
  difficulty: string;
  unit_name: string;
  times_asked: number;
  correct_count: number;
  first_try_count: number;
  total_hints: number;
  avg_attempts: number;
  students_mastered: number;
}

const pct = (part: number, whole: number) =>
  whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—";

export default async function StudentsReportPage() {
  const profile = await requireProfile("teacher");
  const supabase = await createClient();

  const { data: classes } = await supabase
    .from("classes")
    .select("id, name, enrollments(student:profiles!enrollments_student_id_fkey(id, username, full_name))")
    .eq("teacher_id", profile.id)
    .order("created_at");

  return (
    <main className="mx-auto max-w-2xl p-4 pb-16">
      <header className="mb-5">
        <Link href="/teacher" className="text-sm text-brand-600">&larr; Dashboard</Link>
        <h1 className="mt-1 text-xl font-bold">📊 Students &amp; reports</h1>
      </header>

      {(classes ?? []).map(async (cls) => {
        const students = (cls.enrollments ?? [])
          .map((e) => (Array.isArray(e.student) ? e.student[0] : e.student))
          .filter(Boolean) as { id: string; username: string; full_name: string }[];
        const studentIds = students.map((s) => s.id);

        const [{ data: statsRaw }, { data: wordStatsRaw }, { data: progressRows }, { data: quizSessions }] =
          await Promise.all([
            supabase.rpc("class_student_stats", { p_class_id: cls.id }),
            supabase.rpc("class_word_stats", { p_class_id: cls.id }),
            studentIds.length > 0
              ? supabase
                  .from("word_progress")
                  .select("student_id, practice_count, correct_count, current_level, words(text)")
                  .in("student_id", studentIds)
              : Promise.resolve({ data: [] }),
            studentIds.length > 0
              ? supabase
                  .from("practice_sessions")
                  .select("student_id, total_questions, correct_answers, started_at, mode")
                  .in("student_id", studentIds)
                  .eq("mode", "quiz")
                  .not("completed_at", "is", null)
                  .order("started_at")
              : Promise.resolve({ data: [] }),
          ]);

        const stats = (statsRaw ?? []) as StudentStat[];
        const wordStats = (wordStatsRaw ?? []) as WordStat[];
        const statMap = new Map(stats.map((s) => [s.student_id, s]));

        // Class summary
        const totQ = stats.reduce((a, s) => a + Number(s.total_questions), 0);
        const totCorrect = stats.reduce((a, s) => a + Number(s.correct_answers), 0);
        const totFirstTry = stats.reduce((a, s) => a + Number(s.first_try_correct), 0);
        const totHints = stats.reduce((a, s) => a + Number(s.total_hints), 0);
        const activeStudents = stats.filter((s) => Number(s.total_questions) > 0).length;

        // Hardest words: lowest first-try rate, minimum 3 asks
        const hardest = wordStats
          .filter((w) => Number(w.times_asked) >= 3)
          .sort(
            (a, b) =>
              Number(a.first_try_count) / Number(a.times_asked) -
              Number(b.first_try_count) / Number(b.times_asked)
          )
          .slice(0, 5);

        return (
          <section key={cls.id} className="mb-8">
            <h2 className="mb-3 text-lg font-bold">🏫 {cls.name}</h2>

            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Active students", value: `${activeStudents}/${students.length}` },
                { label: "Questions answered", value: totQ },
                { label: "Class accuracy", value: pct(totCorrect, totQ) },
                { label: "First-try rate", value: pct(totFirstTry, totQ) },
              ].map((c) => (
                <div key={c.label} className="rounded-2xl border border-gray-200 bg-white p-3 text-center">
                  <p className="text-xl font-extrabold text-brand-700">{c.value}</p>
                  <p className="text-xs text-gray-500">{c.label}</p>
                </div>
              ))}
            </div>

            {hardest.length > 0 && (
              <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 p-4">
                <p className="mb-2 font-bold text-rose-800">🔥 Hardest words for this class</p>
                <div className="grid gap-1.5">
                  {hardest.map((w) => (
                    <div key={w.word_id} className="flex items-center justify-between text-sm">
                      <span className="font-semibold text-rose-900">
                        {w.word_text}
                        <span className="ml-1 font-normal text-rose-400">({w.unit_name})</span>
                      </span>
                      <span className="text-rose-700">
                        {pct(Number(w.first_try_count), Number(w.times_asked))} first-try
                        · {w.total_hints} hints
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mb-4 rounded-2xl border border-gray-200 bg-white p-4">
              <p className="mb-2 font-bold">📥 Research exports (CSV)</p>
              <p className="mb-3 text-sm text-gray-500">
                Open in Excel, SPSS, or R. The questions file is the full raw dataset.
              </p>
              <div className="flex flex-wrap gap-2">
                <a href={`/api/reports/students?class=${cls.id}`}
                  className="rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white">
                  Student summary
                </a>
                <a href={`/api/reports/words?class=${cls.id}`}
                  className="rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white">
                  Word analysis
                </a>
                <a href={`/api/reports/questions?class=${cls.id}`}
                  className="rounded-xl border-2 border-brand-500 bg-white px-4 py-2.5 text-sm font-semibold text-brand-600">
                  All questions (raw data)
                </a>
              </div>
            </div>

            <div className="grid gap-3">
              {students
                .sort((a, b) => a.full_name.localeCompare(b.full_name))
                .map((s) => {
                  const st = statMap.get(s.id);
                  const answered = Number(st?.total_questions ?? 0);
                  const myProgress = (progressRows ?? []).filter(
                    (p) => p.student_id === s.id
                  );
                  const mastered = myProgress.filter(
                    (p) => p.practice_count >= MASTERY_COUNT
                  ).length;
                  const struggling = myProgress
                    .filter((p) => p.practice_count >= 3 && p.correct_count / p.practice_count < 0.5)
                    .map((p) => {
                      const w = Array.isArray(p.words) ? p.words[0] : p.words;
                      return { text: (w as { text: string } | null)?.text ?? "?", ...p };
                    });
                  const myQuizzes = (quizSessions ?? []).filter((q) => q.student_id === s.id);

                  return (
                    <details key={s.id} className="rounded-2xl border border-gray-200 bg-white">
                      <summary className="cursor-pointer select-none list-none p-4 [&::-webkit-details-marker]:hidden">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-bold">{s.full_name}</p>
                            <p className="text-sm text-gray-500">{s.username}</p>
                          </div>
                          {answered === 0 ? (
                            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-500">
                              Not started
                            </span>
                          ) : (
                            <span className="text-gray-400">▾</span>
                          )}
                        </div>
                        {answered > 0 && (
                          <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                            {[
                              { v: `${Number(st?.practice_sessions ?? 0)}·${Number(st?.quiz_sessions ?? 0)}`, l: "Prac·Quiz" },
                              { v: answered, l: "Answered" },
                              { v: pct(Number(st?.correct_answers ?? 0), answered), l: "Accuracy" },
                              { v: `⭐${mastered}`, l: "Mastered" },
                            ].map((m) => (
                              <div key={m.l} className="rounded-xl bg-gray-50 py-2">
                                <p className="text-sm font-bold">{m.v}</p>
                                <p className="text-[11px] text-gray-500">{m.l}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </summary>

                      {answered > 0 && (
                        <div className="border-t border-gray-100 p-4 text-sm">
                          <div className="mb-3 grid grid-cols-3 gap-2 text-center">
                            {[
                              { v: pct(Number(st?.first_try_correct ?? 0), answered), l: "First-try rate" },
                              { v: Number(st?.total_hints ?? 0), l: "Hints used" },
                              { v: answered > 0 ? (Number(st?.total_attempts ?? 0) / answered).toFixed(1) : "—", l: "Avg attempts" },
                            ].map((m) => (
                              <div key={m.l} className="rounded-xl bg-brand-50 py-2">
                                <p className="font-bold text-brand-700">{m.v}</p>
                                <p className="text-[11px] text-gray-500">{m.l}</p>
                              </div>
                            ))}
                          </div>

                          {struggling.length > 0 && (
                            <div className="mb-3">
                              <p className="mb-1 font-bold text-rose-700">⚠️ Struggling words</p>
                              <p className="text-gray-600">
                                {struggling.map((w) =>
                                  `${w.text} (${w.correct_count}/${w.practice_count})`
                                ).join(" · ")}
                              </p>
                            </div>
                          )}

                          {myQuizzes.length > 0 && (
                            <div>
                              <p className="mb-1 font-bold">🎯 Quiz history</p>
                              <p className="text-gray-600">
                                {myQuizzes.map((qz, i) => (
                                  <span key={i}>
                                    {i > 0 && " → "}
                                    {qz.correct_answers}/{qz.total_questions}
                                  </span>
                                ))}
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </details>
                  );
                })}
            </div>
          </section>
        );
      })}

      {(classes ?? []).length === 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-6">
          <p className="text-gray-600">No classes assigned to you yet.</p>
        </div>
      )}
    </main>
  );
}
