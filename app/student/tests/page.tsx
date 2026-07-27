import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function StudentTestsPage() {
  const profile = await requireProfile("student");
  // Use admin client so results_visible is never blocked by RLS
  const admin = createAdminClient();

  const { data: assignments } = await admin
    .from("test_assignments")
    .select("id, started_at, completed_at, score_raw, score_total, results_visible, tests(id, name, test_type, status, instructions, open_at, close_at)")
    .eq("student_id", profile.id)
    .order("assigned_at", { ascending: false });

  return (
    <main className="mx-auto max-w-lg p-4 pb-16">
      <header className="mb-5">
        <Link href="/student" className="text-sm text-gray-500">← Home</Link>
        <h1 className="mt-1 text-xl font-bold">📋 My tests</h1>
      </header>

      {assignments && assignments.length > 0 ? (
        <div className="grid gap-3">
          {assignments.map((a) => {
            const t = Array.isArray(a.tests) ? a.tests[0] : a.tests;
            if (!t || t.status === "draft") return null;

            const done = !!a.completed_at;
            const pct  = done && a.score_total
              ? Math.round(((a.score_raw ?? 0) / a.score_total) * 100) : null;
            const now  = new Date();
            const openAt       = t.open_at  ? new Date(t.open_at)  : null;
            const closeAt      = t.close_at ? new Date(t.close_at) : null;
            const notOpenYet   = openAt  && now < openAt;
            const alreadyClosed= closeAt && now > closeAt;

            return (
              <div key={a.id} className="rounded-2xl border border-gray-200 bg-white p-4">
                <div className="flex items-start justify-between mb-1">
                  <div>
                    <p className="font-bold">{t.name}</p>
                    <p className="text-sm capitalize text-gray-500">{t.test_type}</p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                    done ? "bg-green-100 text-green-700" : "bg-brand-100 text-brand-700"
                  }`}>
                    {done ? "Done ✓" : "Pending"}
                  </span>
                </div>

                {t.instructions && (
                  <p className="mb-2 text-sm text-gray-600">{t.instructions}</p>
                )}

                <div className="mt-3">
                  {/* Not started / in progress */}
                  {!done && notOpenYet && (
                    <p className="rounded-xl bg-gray-100 py-3 text-center text-sm text-gray-500">
                      🔒 Opens {openAt?.toLocaleDateString()} at{" "}
                      {openAt?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  )}
                  {!done && !notOpenYet && alreadyClosed && (
                    <p className="rounded-xl bg-red-50 py-3 text-center text-sm text-red-600">
                      ⛔ This test has closed
                    </p>
                  )}
                  {!done && !notOpenYet && !alreadyClosed && (
                    <Link href={`/student/tests/${a.id}`}
                      className="block rounded-xl bg-brand-500 py-3 text-center font-semibold text-white">
                      {a.started_at ? "Continue test →" : "Start test →"}
                    </Link>
                  )}

                  {/* Completed */}
                  {done && a.results_visible && (
                    <div>
                      <div className={`mb-2 rounded-xl p-3 text-center ${
                        (pct ?? 0) >= 80 ? "bg-green-50" :
                        (pct ?? 0) >= 60 ? "bg-amber-50" : "bg-indigo-50"
                      }`}>
                        <p className="text-2xl font-extrabold text-gray-800">{pct}%</p>
                        <p className="text-sm text-gray-600">
                          {a.score_raw}/{a.score_total} correct
                        </p>
                      </div>
                      <Link href={`/student/tests/${a.id}/results`}
                        className="block rounded-xl border border-brand-300 py-2.5 text-center text-sm font-semibold text-brand-600">
                        See detailed results &amp; feedback →
                      </Link>
                    </div>
                  )}
                  {done && !a.results_visible && (
                    <div className="rounded-xl bg-gray-50 py-3 text-center">
                      <p className="text-sm text-gray-500">✅ Submitted</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        Waiting for teacher to release results
                      </p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center">
          <p className="text-gray-600">No tests assigned yet.</p>
          <Link href="/student" className="mt-3 block text-sm text-brand-600">← Home</Link>
        </div>
      )}
    </main>
  );
}
