// @ts-nocheck
import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { closeTest, createAndGenerate, approveTest, assignTest, releaseResults } from "@/lib/actions/tests";
import WordSelector from "@/components/WordSelector";

export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<string, string> = {
  draft:    "bg-gray-100 text-gray-600",
  approved: "bg-blue-100 text-blue-700",
  active:   "bg-green-100 text-green-700",
  closed:   "bg-gray-100 text-gray-500",
};

const TYPE_LABELS: Record<string, string> = {
  true_false: "True / False",
  multiple_choice: "Multiple choice",
  fill_blank: "Fill in the blank",
  matching: "Matching",
  write_sentence: "Write a sentence",
};

const DIFF_COLORS: Record<string, string> = {
  easy:   "border-green-200 bg-green-50 text-green-800",
  medium: "border-amber-200 bg-amber-50 text-amber-800",
  hard:   "border-red-200 bg-red-50 text-red-800",
};

export default async function TestsPage({
  searchParams,
}: { searchParams: Promise<{ msg?: string; open?: string }> }) {
  const profile = await requireProfile("teacher");
  const { msg, open } = await searchParams;
  const supabase = await createClient();
  const admin    = createAdminClient();

  const { data: classes } = await supabase
    .from("classes")
    .select("id, name, courses(id, name)")
    .eq("teacher_id", profile.id);

  const allCourses = (classes ?? []).flatMap((cls) =>
    (cls.courses ?? []).map((co) => ({ ...co, className: cls.name }))
  );

  const { data: tests } = await supabase
    .from("tests")
    .select("id, name, test_type, status, created_at, composition, difficulty_mix, course_id, instructions, show_results")
    .eq("teacher_id", profile.id)
    .order("created_at", { ascending: false });

  const testIds = (tests ?? []).map((t) => t.id);

  // Load questions and assignments for all tests
  const [{ data: allQuestions }, { data: allAssignments }] = await Promise.all([
    testIds.length
      ? admin.from("test_questions")
          .select("id, test_id, question_type, difficulty, question_data, word_id, words(text)")
          .in("test_id", testIds).order("order_index")
      : Promise.resolve({ data: [] }),
    testIds.length
      ? admin.from("test_assignments")
          .select("test_id, student_id, completed_at, score_raw, score_total, results_visible, profiles!test_assignments_student_id_fkey(full_name, username)")
          .in("test_id", testIds)
      : Promise.resolve({ data: [] }),
  ]);

  // Load units + words for the CREATE form (first course, or all)
  const firstCourseId = allCourses[0]?.id;
  const { data: allUnits } = firstCourseId
    ? await admin.from("units")
        .select("id, name, order_index, course_id, words(id, text, difficulty)")
        .in("course_id", allCourses.map((c) => c.id))
        .order("order_index")
    : { data: [] };

  // Group by test
  const qByTest  = new Map<string, NonNullable<typeof allQuestions>>();
  const aByTest  = new Map<string, NonNullable<typeof allAssignments>>();
  for (const q of allQuestions  ?? []) {
    if (!qByTest.has(q.test_id))  qByTest.set(q.test_id, []);
    qByTest.get(q.test_id)!.push(q);
  }
  for (const a of allAssignments ?? []) {
    if (!aByTest.has(a.test_id))  aByTest.set(a.test_id, []);
    aByTest.get(a.test_id)!.push(a);
  }

  // Students per course class (for assignment)
  const { data: enrollments } = await admin
    .from("enrollments")
    .select("student_id, class_id, profiles!enrollments_student_id_fkey(id, username, full_name)")
    .in("class_id", (classes ?? []).map((c) => c.id));

  return (
    <main className="mx-auto max-w-2xl p-4 pb-16">
      <header className="mb-5">
        <Link href="/teacher" className="text-sm text-brand-600">← Dashboard</Link>
        <h1 className="mt-1 text-xl font-bold">📋 Tests</h1>
        <p className="text-sm text-gray-500">Design, assign, and review pre/post tests.</p>
      </header>

      {msg && (
        <p className="mb-4 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-700">{msg}</p>
      )}

      {/* ══════════════════════════════════════════
          CREATE TEST — everything in one form
      ══════════════════════════════════════════ */}
      {allCourses.length > 0 ? (
        <details className="mb-6 rounded-2xl border border-brand-200 bg-white" open={!tests?.length || open === "new"}>
          <summary className="cursor-pointer select-none list-none px-5 py-4 [&::-webkit-details-marker]:hidden">
            <div className="flex items-center justify-between">
              <p className="font-bold text-brand-700">+ Create a new test</p>
              <span className="text-brand-400">▾</span>
            </div>
          </summary>

          <form action={createAndGenerate} className="border-t border-gray-100 p-5 grid gap-5">
            {/* Basic info */}
            <div className="grid gap-3">
              <div>
                <label className="mb-1 block text-sm font-semibold">Test name *</label>
                <input name="name" required placeholder="e.g. Pre-test, Post-test Unit 1"
                  className="w-full rounded-xl border border-gray-300 px-4 py-3 text-base outline-none focus:border-brand-500"/>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-semibold">Type</label>
                  <select name="test_type"
                    className="w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-sm">
                    <option value="pretest">📋 Pre-test</option>
                    <option value="posttest">📋 Post-test</option>
                    <option value="midterm">📋 Mid-semester</option>
                    <option value="custom">📋 Custom</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-semibold">Results visible to students</label>
                  <select name="show_results"
                    className="w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-sm">
                    <option value="manual">Teacher releases results</option>
                    <option value="immediate">Immediately after submit</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-semibold">Course *</label>
                <select name="course_id" required defaultValue=""
                  className="w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-sm">
                  <option value="" disabled>Choose a course…</option>
                  {allCourses.map((co) => (
                    <option key={co.id} value={co.id}>{co.className} — {co.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-semibold">Instructions for students (optional)</label>
                <textarea name="instructions" rows={2}
                  placeholder="e.g. Answer all questions carefully. No hints available."
                  className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm outline-none focus:border-brand-500"/>
              </div>
            </div>

            {/* Question type counts */}
            <div>
              <label className="mb-2 block text-sm font-semibold">
                Number of questions per type
                <span className="ml-1 text-xs font-normal text-gray-400">(enter 0 to skip a type)</span>
              </label>
              <div className="grid gap-2">
                {Object.entries(TYPE_LABELS).map(([key, label]) => (
                  <div key={key}
                    className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                    <div>
                      <p className="text-sm font-medium">{label}</p>
                      <p className="text-xs text-gray-400">
                        {key === "true_false"      && "Tap True or False"}
                        {key === "multiple_choice" && "Pick from 4 options"}
                        {key === "fill_blank"      && "Tap the correct word from a word bank"}
                        {key === "matching"        && "Match words to definitions"}
                        {key === "write_sentence"  && "Write a sentence (AI grades it)"}
                      </p>
                    </div>
                    <input name={key} type="number" min={0} max={20} defaultValue={0}
                      className="ml-3 w-16 rounded-xl border border-gray-300 px-2 py-2 text-center text-base font-bold"/>
                  </div>
                ))}
              </div>
            </div>

            {/* Difficulty mix */}
            <div>
              <label className="mb-2 block text-sm font-semibold">
                Difficulty mix
                <span className="ml-1 text-xs font-normal text-gray-400">
                  (total should equal your question count; leave all 0 for all-easy)
                </span>
              </label>
              <div className="grid grid-cols-3 gap-2">
                {["easy", "medium", "hard"].map((d) => (
                  <div key={d}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border px-3 py-3 ${DIFF_COLORS[d]}`}>
                    <span className="text-sm font-semibold capitalize">{d}</span>
                    <p className="text-[10px] text-center opacity-70">
                      {d === "easy"   && "L1–2 questions"}
                      {d === "medium" && "L3 questions"}
                      {d === "hard"   && "L4–5 questions"}
                    </p>
                    <input name={d} type="number" min={0} max={30} defaultValue={0}
                      className="w-16 rounded-lg border border-current/20 bg-white px-2 py-1.5 text-center text-base font-bold"/>
                  </div>
                ))}
              </div>
            </div>

            {/* Word selection */}
            <div>
              <label className="mb-1 block text-sm font-semibold">
                Select words to include
              </label>
              <p className="mb-3 text-xs text-gray-500">
                Tick the words you want the AI to use. Uncheck a unit to exclude it entirely.
              </p>
              {(allUnits ?? []).length > 0 ? (
                <WordSelector
                  units={(allUnits ?? []).map((u) => ({
                    id: u.id,
                    name: u.name,
                    words: ((u.words ?? []) as { id: string; text: string; difficulty: string }[]),
                  }))}
                />
              ) : (
                <p className="text-sm text-amber-700 rounded-xl bg-amber-50 p-3">
                  No words found. Add words to this course first.
                </p>
              )}
            </div>

            <button className="rounded-xl bg-brand-500 py-4 text-base font-bold text-white active:scale-[0.98]">
              🤖 Create &amp; generate questions with AI
            </button>
          </form>
        </details>
      ) : (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm text-amber-800">
            You need at least one course with words before creating a test.
          </p>
        </div>
      )}

      {/* ══════════════════════════════════════════
          EXISTING TESTS
      ══════════════════════════════════════════ */}
      <section>
        <h2 className="mb-3 font-semibold">All tests ({tests?.length ?? 0})</h2>
        {tests && tests.length > 0 ? (
          <div className="grid gap-3">
            {tests.map((t) => {
              const comp  = (t.composition as Record<string, number>) ?? {};
              const total = Object.values(comp).reduce((a, b) => a + b, 0);
              const qs    = qByTest.get(t.id) ?? [];
              const as_   = aByTest.get(t.id) ?? [];
              const done  = as_.filter((a) => a.completed_at).length;

              return (
                <details key={t.id} className="rounded-2xl border border-gray-200 bg-white">
                  <summary className="cursor-pointer select-none list-none px-5 py-4 [&::-webkit-details-marker]:hidden">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold">{t.name}</p>
                        <p className="text-sm text-gray-500 capitalize">
                          {t.test_type} ·{" "}
                          {total > 0 ? `${total} questions` : "not designed yet"} ·{" "}
                          {as_.length} assigned · {done} completed
                        </p>
                        {total > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {Object.entries(comp).map(([type, count]) => (
                              <span key={type}
                                className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                                {count} {type.replace(/_/g, " ")}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${STATUS_BADGE[t.status] ?? ""}`}>
                        {t.status}
                      </span>
                    </div>
                  </summary>

                  <div className="border-t border-gray-100 p-4 space-y-4">
                    {/* Actions */}
                    <div className="flex flex-wrap gap-2">
                      <Link href={`/teacher/tests/${t.id}/design`}
                        className="rounded-lg bg-brand-500 px-3 py-2 text-sm font-semibold text-white">
                        {t.status === "draft" ? "✏️ Edit & regenerate" : "👁 View questions"}
                      </Link>
                      {t.status === "approved" && (
                        <Link href={`/teacher/tests/${t.id}/assign`}
                          className="rounded-lg border border-brand-300 px-3 py-2 text-sm font-semibold text-brand-600">
                          📋 Assign students
                        </Link>
                      )}
                      {(t.status === "active" || t.status === "closed") && (
                        <Link href={`/teacher/tests/${t.id}/results`}
                          className="rounded-lg border border-brand-300 px-3 py-2 text-sm font-semibold text-brand-600">
                          📊 Results
                        </Link>
                      )}
                      {t.status === "active" && (
                        <form action={closeTest}>
                          <input type="hidden" name="test_id" value={t.id}/>
                          <button className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600">
                            Close test
                          </button>
                        </form>
                      )}
                    </div>

                    {/* Quick question preview */}
                    {qs.length > 0 && (
                      <div>
                        <p className="mb-2 text-xs font-bold text-gray-500 uppercase tracking-wide">
                          Questions ({qs.length})
                        </p>
                        <div className="grid gap-1.5">
                          {qs.map((q, i) => {
                            const d = q.question_data as Record<string, unknown>;
                            const w = Array.isArray(q.words) ? q.words[0] : q.words;
                            return (
                              <div key={q.id}
                                className={`rounded-xl border px-3 py-2 text-xs ${DIFF_COLORS[q.difficulty]}`}>
                                <span className="font-bold">Q{i + 1}</span>
                                <span className="ml-1 capitalize">{q.question_type.replace(/_/g," ")}</span>
                                {w && <span className="ml-1 opacity-70">— &ldquo;{(w as {text:string}).text}&rdquo;</span>}
                                <p className="mt-0.5 text-gray-700 line-clamp-1">
                                  {String(d.question ?? d.statement ?? d.sentence ?? d.instruction ?? "")}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Student completion status */}
                    {as_.length > 0 && (
                      <div>
                        <p className="mb-2 text-xs font-bold text-gray-500 uppercase tracking-wide">
                          Student progress
                        </p>
                        <div className="grid gap-1.5">
                          {as_.map((a) => {
                            const p = Array.isArray(a.profiles) ? a.profiles[0] : a.profiles;
                            const pct = a.score_total
                              ? Math.round((a.score_raw ?? 0) / a.score_total * 100) : null;
                            return (
                              <div key={a.student_id}
                                className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2 text-xs">
                                <span className="font-medium">
                                  {(p as {full_name?:string}|null)?.full_name}
                                </span>
                                <div className="flex items-center gap-2">
                                  {a.completed_at ? (
                                    <span className="font-bold text-green-700">
                                      {pct}% ({a.score_raw}/{a.score_total})
                                    </span>
                                  ) : (
                                    <span className="text-gray-400">Not completed</span>
                                  )}
                                  {a.completed_at && !a.results_visible && (
                                    <form action={releaseResults}>
                                      <input type="hidden" name="test_id" value={t.id}/>
                                      <input type="hidden" name="student_id" value={a.student_id}/>
                                      <button className="rounded-lg bg-green-600 px-2 py-1 font-semibold text-white">
                                        Release
                                      </button>
                                    </form>
                                  )}
                                  {a.results_visible && (
                                    <span className="rounded-full bg-green-100 px-2 py-0.5 font-bold text-green-700">
                                      Visible ✓
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </details>
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center">
            <p className="text-gray-500">No tests yet — create your first one above.</p>
          </div>
        )}
      </section>
    </main>
  );
}
