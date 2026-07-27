import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { approveTest, generateTestQuestions } from "@/lib/actions/tests";
import WordSelector from "@/components/WordSelector";
import QuestionEditor from "@/components/QuestionEditor";

export const dynamic = "force-dynamic";

const TYPE_LABELS: Record<string, string> = {
  true_false: "True / False",
  multiple_choice: "Multiple choice",
  fill_blank: "Fill in the blank",
  matching: "Matching",
  write_sentence: "Write a sentence",
};
const DIFF_COLORS: Record<string, string> = {
  easy: "border-green-200 bg-green-50 text-green-800",
  medium: "border-amber-200 bg-amber-50 text-amber-800",
  hard: "border-red-200 bg-red-50 text-red-800",
};

export default async function DesignPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ msg?: string }>;
}) {
  await requireProfile("teacher");
  const { id } = await params;
  const { msg } = await searchParams;
  const supabase = await createClient();
  const admin = createAdminClient();

  const { data: test, error: testErr } = await supabase
    .from("tests").select("*").eq("id", id).single();

  if (testErr || !test) {
    return (
      <main className="mx-auto max-w-2xl p-4">
        <Link href="/teacher/tests" className="text-sm text-brand-600">← Tests</Link>
        <div className="mt-4 rounded-2xl border-2 border-amber-300 bg-amber-50 p-5">
          <p className="font-bold text-amber-800">⚠️ Database update needed</p>
          <p className="text-sm text-amber-800 mt-1">
            Run <b>migration_tests.sql</b> in Supabase → SQL Editor, then refresh.
          </p>
        </div>
      </main>
    );
  }
  if (!test) notFound();

  // Load all units + words for this course
  const { data: units } = await admin
    .from("units")
    .select("id, name, order_index, words(id, text, difficulty)")
    .eq("course_id", test.course_id)
    .order("order_index");

  const allWords = (units ?? []).flatMap((u) =>
    ((u.words ?? []) as { id: string; text: string; difficulty: string }[])
      .map((w) => ({ ...w, unitName: u.name, unitId: u.id }))
  );

  const { data: questions } = await admin
    .from("test_questions")
    .select("id, question_type, difficulty, question_data, word_id, teacher_edited, words(text)")
    .eq("test_id", id)
    .order("order_index");

  const comp = (test.composition as Record<string, number>) ?? {};
  const diff = (test.difficulty_mix as Record<string, number>) ?? {};
  const total = Object.values(comp).reduce((a, b) => a + b, 0);
  const savedWordIds: string[] = (test as Record<string, unknown>).selected_word_ids as string[] ?? [];

  return (
    <main className="mx-auto max-w-2xl p-4 pb-16">
      <header className="mb-5">
        <Link href="/teacher/tests" className="text-sm text-brand-600">← Tests</Link>
        <div className="flex items-center justify-between mt-1">
          <h1 className="text-xl font-bold">{test.name}</h1>
          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${
            test.status === "draft" ? "bg-gray-100 text-gray-600" : "bg-blue-100 text-blue-700"
          }`}>{test.status}</span>
        </div>
      </header>

      {msg && (
        <p className="mb-4 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-700">{msg}</p>
      )}

      {/* ── STEP 1: Composition ── */}
      <section className="mb-5 rounded-2xl border border-gray-200 bg-white p-5">
        <h2 className="mb-1 font-semibold">Step 1 — Question types &amp; count</h2>
        <p className="mb-4 text-sm text-gray-500">
          Enter how many questions of each type. The total becomes your test length.
        </p>
        <form action={generateTestQuestions} id="genForm" className="grid gap-4">
          <input type="hidden" name="test_id" value={test.id} />
          <input type="hidden" name="course_id" value={test.course_id} />

          {/* Question type inputs */}
          <div className="grid gap-2">
            {Object.entries(TYPE_LABELS).map(([key, label]) => (
              <div key={key}
                className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                <div>
                  <p className="font-medium text-sm">{label}</p>
                  <p className="text-xs text-gray-400">
                    {key === "true_false" && "Students tap True or False"}
                    {key === "multiple_choice" && "Students pick from 4 options"}
                    {key === "fill_blank" && "Students tap the correct word"}
                    {key === "matching" && "Students match words to meanings"}
                    {key === "write_sentence" && "Students write their own sentence (AI grades)"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-500">How many:</label>
                  <input
                    name={key} type="number" min={0} max={20}
                    defaultValue={comp[key] ?? 0}
                    className="w-16 rounded-xl border border-gray-300 px-2 py-2 text-center text-base font-bold"
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Running total indicator */}
          <div className="rounded-xl bg-brand-50 border border-brand-200 px-4 py-3 flex items-center justify-between">
            <p className="text-sm font-medium text-brand-700">
              Total questions saved: <b>{total > 0 ? total : "—"}</b>
            </p>
            <p className="text-xs text-gray-500">
              (counts update after you generate)
            </p>
          </div>

          {/* Difficulty mix */}
          <div>
            <p className="mb-2 text-sm font-medium text-gray-700">
              Difficulty mix — how many of each?
              <span className="ml-1 text-xs font-normal text-gray-400">
                (total should equal your question count above)
              </span>
            </p>
            <div className="grid grid-cols-3 gap-2">
              {["easy", "medium", "hard"].map((d) => (
                <label key={d}
                  className={`flex flex-col items-center gap-1 rounded-xl border px-3 py-3 ${DIFF_COLORS[d]}`}>
                  <span className="text-sm font-semibold capitalize">{d}</span>
                  <input name={d} type="number" min={0} max={30}
                    defaultValue={diff[d] ?? 0}
                    className="w-16 rounded-lg border border-current/20 bg-white px-2 py-1.5 text-center text-base font-bold" />
                </label>
              ))}
            </div>
          </div>

          {/* ── STEP 2: Word selection ── */}
          <div>
            <p className="mb-1 text-sm font-medium text-gray-700">
              Step 2 — Choose words for the test
            </p>
            <p className="mb-3 text-xs text-gray-500">
              Select specific words, or leave all ticked to use all words from all units.
              Questions will be generated only from words you select.
            </p>

            {units && units.length > 0 ? (
              <WordSelector
                units={(units ?? []).map((u) => ({
                  id: u.id,
                  name: u.name,
                  words: ((u.words ?? []) as { id: string; text: string; difficulty: string }[]),
                  selectedIds: savedWordIds,
                }))}
              />
            ) : (
              <p className="text-sm text-amber-700">
                No words found. Add words to this course first.
              </p>
            )}
          </div>

          <button
            className="rounded-xl bg-brand-500 py-3.5 text-base font-bold text-white active:scale-[0.98]"
            type="submit">
            🤖 Generate questions with AI
          </button>
        </form>
      </section>

      {/* ── STEP 3: Review & edit questions ── */}
      {questions && questions.length > 0 && (
        <section className="mb-5">
          <h2 className="mb-3 font-semibold">
            Step 3 — Review, edit &amp; approve
          </h2>
          <QuestionEditor
            testId={test.id}
            words={allWords.map(w => ({ id: w.id, text: w.text }))}
            initialQuestions={questions.map(q => ({
              id: q.id,
              question_type: q.question_type,
              difficulty: q.difficulty,
              question_data: q.question_data as Record<string, unknown>,
              word: (Array.isArray(q.words) ? q.words[0] : q.words) as { text: string } | null,
              teacher_edited: (q as Record<string, unknown>)["teacher_edited"] as boolean | undefined,
            }))}
          />
        </section>
      )}

      {/* ── Approve ── */}
      {questions && questions.length > 0 && test.status === "draft" && (
        <section className="rounded-2xl border border-green-200 bg-green-50 p-5">
          <h2 className="mb-1 font-semibold text-green-800">
            Step 4 — Approve &amp; assign to students
          </h2>
          <p className="mb-3 text-sm text-green-700">
            Happy with all {questions.length} questions?
            Approve the test to make it assignable. You can regenerate while it&apos;s still a draft.
          </p>
          <form action={approveTest}>
            <input type="hidden" name="test_id" value={test.id} />
            <button className="rounded-xl bg-green-600 px-6 py-3 font-semibold text-white active:scale-[0.98]">
              ✅ Approve test ({questions.length} questions)
            </button>
          </form>
        </section>
      )}

      {test.status !== "draft" && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
          <p className="text-sm font-medium text-blue-800">
            This test is {test.status} — questions are locked.{" "}
            <Link href={`/teacher/tests/${test.id}/assign`} className="underline">
              Go to assignment →
            </Link>
          </p>
        </div>
      )}
    </main>
  );
}
