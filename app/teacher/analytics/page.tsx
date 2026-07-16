import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { computeClassAnalytics, ratePct, rate, studentAccuracyDescriptives } from "@/lib/analytics";
import { fmt } from "@/lib/stats";
import { MASTERY_COUNT } from "@/lib/adaptive";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const profile = await requireProfile("teacher");
  const supabase = await createClient();

  const { data: classes } = await supabase
    .from("classes").select("id, name").eq("teacher_id", profile.id).order("created_at");

  const analyses = await Promise.all(
    (classes ?? []).map((c) => computeClassAnalytics(supabase, c.id, c.name))
  );

  return (
    <main className="mx-auto max-w-2xl p-4 pb-16">
      <header className="mb-5">
        <Link href="/teacher" className="text-sm text-brand-600">&larr; Dashboard</Link>
        <h1 className="mt-1 text-xl font-bold">🔬 Class analytics</h1>
        <p className="text-sm text-gray-500">
          Full performance evaluation — computed live from all recorded data.
        </p>
      </header>

      {analyses.map((a) => {
        const desc = studentAccuracyDescriptives(a.students);
        const activeWords = a.words.filter((w) => w.total.asked > 0);
        return (
          <section key={a.classId} className="mb-10">
            <h2 className="mb-3 text-lg font-bold">🏫 {a.className}</h2>

            {a.needsMigration && (
              <div className="mb-4 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
                <p className="font-bold text-amber-800">⚠️ Database update needed</p>
                <p className="text-sm text-amber-800">
                  Run <b>migration_analytics_all.sql</b> in Supabase → SQL Editor, then refresh this page.
                </p>
              </div>
            )}

            {/* Overview */}
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Active students", value: `${a.overview.activeStudents}/${a.overview.totalStudents}` },
                { label: "Questions answered", value: a.overview.totalAnswered },
                { label: "Class accuracy", value: isFinite(a.overview.accuracy) ? `${fmt(a.overview.accuracy, 0)}%` : "—" },
                { label: "First-try rate", value: isFinite(a.overview.firstTryRate) ? `${fmt(a.overview.firstTryRate, 0)}%` : "—" },
              ].map((c) => (
                <div key={c.label} className="rounded-2xl border border-gray-200 bg-white p-3 text-center">
                  <p className="text-xl font-extrabold text-brand-700">{c.value}</p>
                  <p className="text-xs text-gray-500">{c.label}</p>
                </div>
              ))}
            </div>

            {desc && (
              <p className="mb-4 rounded-2xl bg-gray-50 px-4 py-3 text-sm text-gray-600">
                <b>Student accuracy distribution</b> (n = {desc.n}): mean {fmt(desc.mean)}% ·
                SD {fmt(desc.sd)} · range {fmt(desc.min, 0)}–{fmt(desc.max, 0)}%
              </p>
            )}

            {/* Statistical findings */}
            <div className="mb-5">
              <h3 className="mb-2 px-1 font-bold">📐 Statistical analysis</h3>
              <div className="grid gap-2.5">
                {a.findings.map((f) => (
                  <div key={f.title}
                    className={
                      "rounded-2xl border p-4 " +
                      (f.hasData ? "border-brand-200 bg-white" : "border-gray-200 bg-gray-50")
                    }>
                    <p className="font-bold">{f.icon} {f.title}</p>
                    <p className="mt-1 font-mono text-xs text-gray-600">{f.stat}</p>
                    {f.interpretation && (
                      <p className="mt-1.5 text-sm text-brand-800">{f.interpretation}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Download RESULTS */}
            <div className="mb-5 rounded-2xl border border-gray-200 bg-white p-4">
              <p className="mb-2 font-bold">📥 Download analysis results</p>
              <div className="flex flex-wrap gap-2">
                <a href={`/api/reports/analysis?class=${a.classId}`}
                  className="rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white">
                  Full analysis report
                </a>
                <a href={`/api/reports/matrix?class=${a.classId}`}
                  className="rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white">
                  Word × student matrix
                </a>
              </div>
            </div>

            {/* Per-word evaluation with per-student breakdown */}
            <h3 className="mb-2 px-1 font-bold">
              📚 Word-by-word evaluation
              <span className="ml-1 font-normal text-gray-400">
                ({activeWords.length} words with data, hardest first)
              </span>
            </h3>
            <div className="grid gap-2">
              {activeWords.map((w) => {
                const ft = rate(w.total.firstTry, w.total.asked);
                const color = !isFinite(ft) ? "border-gray-200"
                  : ft < 0.5 ? "border-rose-300"
                  : ft < 0.75 ? "border-amber-300" : "border-emerald-300";
                return (
                  <details key={w.wordId} className={`rounded-2xl border-2 bg-white ${color}`}>
                    <summary className="cursor-pointer select-none list-none p-3.5 [&::-webkit-details-marker]:hidden">
                      <div className="flex items-center justify-between">
                        <p className="font-bold">
                          {w.text}
                          <span className={
                            "ml-1.5 align-middle text-xs font-medium " +
                            (w.difficulty === "easy" ? "text-green-600" : "text-red-500")
                          }>
                            {w.difficulty === "easy" ? "🟢" : "🔴"}
                          </span>
                          <span className="ml-1 align-middle text-xs font-normal text-gray-400">{w.unit}</span>
                        </p>
                        <span className="text-sm font-semibold text-gray-600">
                          {ratePct(w.total.firstTry, w.total.asked)} first-try
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-gray-500">
                        {w.total.asked} questions · {ratePct(w.total.correct, w.total.asked)} accuracy ·
                        💡 {w.total.hints} hints · ⭐ {w.mastered} mastered
                        {w.total.quizAsked > 0 && ` · quiz: ${ratePct(w.total.quizCorrect, w.total.quizAsked)}`}
                      </p>
                    </summary>
                    <div className="border-t border-gray-100 p-3.5">
                      <div className="grid gap-1.5 text-sm">
                        {w.perStudent.map((ps) => (
                          <div key={ps.studentId} className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2">
                            <span className="font-medium">
                              {ps.name}
                              {ps.practiceCount >= MASTERY_COUNT && " ⭐"}
                            </span>
                            <span className="text-xs text-gray-600">
                              {ps.cell.asked}q · {ratePct(ps.cell.correct, ps.cell.asked)} ·
                              💡{ps.cell.hints} · Lv{ps.level || "—"} · {ps.practiceCount}/{MASTERY_COUNT}
                            </span>
                          </div>
                        ))}
                        {w.perStudent.length === 0 && (
                          <p className="text-gray-500">No student activity on this word yet.</p>
                        )}
                      </div>
                    </div>
                  </details>
                );
              })}
              {activeWords.length === 0 && !a.needsMigration && (
                <p className="rounded-2xl bg-gray-50 p-4 text-sm text-gray-500">
                  No question data yet — analytics appear as soon as students practice.
                </p>
              )}
            </div>
          </section>
        );
      })}
    </main>
  );
}
