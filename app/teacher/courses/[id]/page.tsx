import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  assignPart, bulkAddWords, createUnit, createWord, deleteUnit, deleteWord,
  moveWordPart, toggleWordDifficulty, updateQuizCount,
} from "@/lib/actions/teacher";

export const dynamic = "force-dynamic";

interface Word { id: string; text: string; difficulty: string; part?: number; created_at: string }

export default async function CourseWorkspace({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ msg?: string }>;
}) {
  await requireProfile("teacher");
  const { id } = await params;
  const { msg } = await searchParams;
  const supabase = await createClient();

  const { data: course } = await supabase
    .from("courses")
    .select("id, name, active_unit_id, active_part, quiz_questions, classes(name)")
    .eq("id", id)
    .single();

  if (!course) notFound();
  const cls = Array.isArray(course.classes) ? course.classes[0] : course.classes;

  const { data: units } = await supabase
    .from("units")
    .select("id, name, order_index, words(id, text, difficulty, part, created_at)")
    .eq("course_id", id)
    .order("order_index");

  const activeUnitName =
    (units ?? []).find((u) => u.id === course.active_unit_id)?.name ?? null;

  return (
    <main className="mx-auto max-w-2xl p-4 pb-16">
      <header className="mb-5">
        <Link href="/teacher" className="text-sm text-brand-600">&larr; Dashboard</Link>
        <h1 className="mt-1 text-xl font-bold">{course.name}</h1>
        <p className="text-sm text-gray-500">{cls?.name}</p>
      </header>

      {msg && (
        <p className="mb-4 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-700">{msg}</p>
      )}

      {/* Course settings */}
      <div className="mb-4 rounded-2xl border border-gray-200 bg-white p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="font-bold">⚙️ Course settings</p>
          <p className="text-sm text-gray-500">
            {activeUnitName
              ? <>📌 Assigned: <b>{activeUnitName} · Part {course.active_part}</b></>
              : "No assignment set — all units open"}
          </p>
        </div>
        <form action={updateQuizCount} className="flex items-center gap-2">
          <input type="hidden" name="course_id" value={course.id} />
          <label className="text-sm text-gray-600">Questions per quiz:</label>
          <input name="quiz_questions" type="number" min={3} max={20}
            defaultValue={course.quiz_questions ?? 5}
            className="w-20 rounded-xl border border-gray-300 px-3 py-2 text-center text-base" />
          <button className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white">
            Save
          </button>
        </form>
      </div>

      <form action={createUnit} className="mb-5 flex gap-2">
        <input type="hidden" name="course_id" value={course.id} />
        <input name="name" placeholder="New unit name (e.g. Unit 1: Career)" required
          className="flex-1 rounded-xl border border-gray-300 px-4 py-3 text-base outline-none focus:border-brand-500" />
        <button className="rounded-xl bg-brand-500 px-4 font-semibold text-white active:scale-[0.98]">
          + Unit
        </button>
      </form>

      {units && units.length > 0 ? (
        units.map((unit, idx) => {
          const words = ([...(unit.words ?? [])] as Word[]).sort((a, b) =>
            a.created_at < b.created_at ? -1 : 1
          );
          const parts: { n: 1 | 2; items: Word[] }[] = [
            { n: 1, items: words.filter((w) => (w.part ?? 1) === 1) },
            { n: 2, items: words.filter((w) => (w.part ?? 1) === 2) },
          ];

          return (
            <details key={unit.id} open={idx === 0}
              className="mb-3 rounded-2xl border border-gray-200 bg-white">
              <summary className="cursor-pointer select-none list-none px-5 py-4 [&::-webkit-details-marker]:hidden">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold">
                      {unit.name}
                      {course.active_unit_id === unit.id && (
                        <span className="ml-2 rounded-full bg-brand-100 px-2 py-0.5 text-xs font-bold text-brand-700">
                          📌 Part {course.active_part} assigned
                        </span>
                      )}
                    </p>
                    <p className="text-sm text-gray-500">
                      {words.length} words · Part 1: {parts[0].items.length} · Part 2: {parts[1].items.length}
                    </p>
                  </div>
                  <span className="text-gray-400">▾</span>
                </div>
              </summary>

              <div className="border-t border-gray-100 px-5 py-4">
                {parts.map(({ n, items }) => {
                  const isAssigned =
                    course.active_unit_id === unit.id && course.active_part === n;
                  return (
                    <div key={n} className="mb-5">
                      <div className="mb-2 flex items-center justify-between">
                        <p className="font-bold text-gray-700">
                          Part {n}
                          <span className="ml-1 text-sm font-normal text-gray-400">
                            ({items.length} words)
                          </span>
                        </p>
                        <form action={assignPart}>
                          <input type="hidden" name="course_id" value={course.id} />
                          <input type="hidden" name="unit_id" value={unit.id} />
                          <input type="hidden" name="part" value={n} />
                          <button className={
                            "rounded-full px-3 py-1.5 text-xs font-bold " +
                            (isAssigned
                              ? "bg-brand-500 text-white"
                              : "border border-brand-300 text-brand-600")
                          }>
                            {isAssigned ? "📌 Assigned ✓" : "📌 Assign to students"}
                          </button>
                        </form>
                      </div>

                      {items.length > 0 ? (
                        <div className="mb-3 flex flex-wrap gap-2">
                          {items.map((w) => (
                            <span key={w.id}
                              className={
                                "inline-flex items-center gap-0.5 rounded-full border px-1 py-1 text-sm " +
                                (w.difficulty === "easy"
                                  ? "border-green-200 bg-green-50"
                                  : "border-red-200 bg-red-50")
                              }>
                              <form action={toggleWordDifficulty} className="inline">
                                <input type="hidden" name="course_id" value={course.id} />
                                <input type="hidden" name="word_id" value={w.id} />
                                <input type="hidden" name="current" value={w.difficulty} />
                                <button
                                  className={
                                    "rounded-full px-1.5 py-0.5 font-medium " +
                                    (w.difficulty === "easy" ? "text-green-800" : "text-red-800")
                                  }
                                  title="Tap to switch easy/hard">
                                  {w.difficulty === "easy" ? "🟢" : "🔴"} {w.text}
                                </button>
                              </form>
                              <form action={moveWordPart} className="inline">
                                <input type="hidden" name="course_id" value={course.id} />
                                <input type="hidden" name="word_id" value={w.id} />
                                <input type="hidden" name="current_part" value={w.part ?? 1} />
                                <button className="px-1 text-gray-400 hover:text-brand-600"
                                  title={`Move to Part ${n === 1 ? 2 : 1}`}>
                                  ⇄
                                </button>
                              </form>
                              <form action={deleteWord} className="inline">
                                <input type="hidden" name="course_id" value={course.id} />
                                <input type="hidden" name="word_id" value={w.id} />
                                <button className="px-1 text-gray-400 hover:text-red-600" title="Delete word">
                                  ✕
                                </button>
                              </form>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="mb-3 text-sm text-gray-400">
                          No words in Part {n} yet — add below or move words here with ⇄.
                        </p>
                      )}

                      <form action={createWord} className="mb-2 flex flex-wrap gap-2">
                        <input type="hidden" name="course_id" value={course.id} />
                        <input type="hidden" name="unit_id" value={unit.id} />
                        <input type="hidden" name="part" value={n} />
                        <input name="text" placeholder={`Add a word to Part ${n}…`} required
                          className="min-w-36 flex-1 rounded-xl border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-brand-500" />
                        <select name="difficulty"
                          className="rounded-xl border border-gray-300 bg-white px-2 py-2.5 text-sm">
                          <option value="easy">🟢 Easy</option>
                          <option value="hard">🔴 Hard</option>
                        </select>
                        <button className="rounded-xl bg-brand-500 px-4 text-sm font-semibold text-white active:scale-[0.98]">
                          Add
                        </button>
                      </form>

                      <details className="rounded-xl bg-gray-50 px-4 py-3">
                        <summary className="cursor-pointer select-none text-sm font-medium text-brand-700">
                          📋 Paste many words into Part {n}
                        </summary>
                        <form action={bulkAddWords} className="mt-3 grid gap-2">
                          <input type="hidden" name="course_id" value={course.id} />
                          <input type="hidden" name="unit_id" value={unit.id} />
                          <input type="hidden" name="part" value={n} />
                          <textarea name="words" rows={3} required
                            placeholder="bright, building, collect, comfortable…"
                            className="rounded-xl border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-brand-500" />
                          <div className="flex items-center gap-4 text-sm">
                            <span className="text-gray-600">Mark all as:</span>
                            <label className="flex items-center gap-1.5">
                              <input type="radio" name="difficulty" value="easy" defaultChecked /> 🟢 Easy
                            </label>
                            <label className="flex items-center gap-1.5">
                              <input type="radio" name="difficulty" value="hard" /> 🔴 Hard
                            </label>
                          </div>
                          <button className="rounded-xl bg-brand-500 py-2.5 text-sm font-semibold text-white active:scale-[0.98]">
                            Add all to Part {n}
                          </button>
                        </form>
                      </details>
                    </div>
                  );
                })}

                <form action={deleteUnit} className="text-right">
                  <input type="hidden" name="course_id" value={course.id} />
                  <input type="hidden" name="unit_id" value={unit.id} />
                  <button className="text-sm text-red-500 underline-offset-2 hover:underline">
                    Delete this unit
                  </button>
                </form>
              </div>
            </details>
          );
        })
      ) : (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center">
          <p className="text-gray-600">No units yet. Create the first one above 👆</p>
        </div>
      )}
    </main>
  );
}
