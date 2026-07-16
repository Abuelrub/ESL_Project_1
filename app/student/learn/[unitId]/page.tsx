import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { MASTERY_COUNT } from "@/lib/adaptive";

export const dynamic = "force-dynamic";

interface WordRow {
  id: string;
  text: string;
  difficulty: string;
  practice: number;
  correct: number;
  status: "new" | "learning" | "mastered";
  struggling: boolean;
  focus: boolean;
}

export default async function WordPickerPage({
  params,
}: {
  params: Promise<{ unitId: string }>;
}) {
  const profile = await requireProfile("student");
  const { unitId } = await params;
  const supabase = await createClient();

  const { data: unit } = await supabase
    .from("units")
    .select("id, name, order_index, course_id, words(id, text, difficulty, part)")
    .eq("id", unitId).single();
  if (!unit) notFound();

  const { data: course } = await supabase
    .from("courses")
    .select("id, active_unit_id, active_part, units!units_course_id_fkey(id, order_index)")
    .eq("id", unit.course_id).single();

  const activeUnit = (course?.units ?? []).find((u) => u.id === course?.active_unit_id);
  const unitLocked = !!activeUnit && unit.order_index > activeUnit.order_index;
  const partLimit =
    activeUnit && unit.id === activeUnit.id ? (course?.active_part ?? 1) : 2;

  if (unitLocked) {
    return (
      <main className="mx-auto max-w-lg p-4">
        <Link href="/student" className="text-sm text-gray-500">&larr; Home</Link>
        <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 text-center">
          <p className="mb-2 text-3xl">🔒</p>
          <p className="font-bold">This unit is not open yet</p>
          <p className="mt-1 text-sm text-gray-500">Your teacher will assign it soon.</p>
        </div>
      </main>
    );
  }

  const allWords = (unit.words ?? []) as { id: string; text: string; difficulty: string; part?: number }[];
  const wordList = allWords.filter((w) => (w.part ?? 1) <= partLimit);
  const lockedWords = allWords.filter((w) => (w.part ?? 1) > partLimit);

  const { data: progress } = await supabase
    .from("word_progress")
    .select("word_id, practice_count, correct_count")
    .eq("student_id", profile.id)
    .in("word_id", wordList.map((w) => w.id));

  const progMap = new Map((progress ?? []).map((p) => [p.word_id, p]));

  const rows: WordRow[] = wordList.map((w) => {
    const p = progMap.get(w.id);
    const practice = p?.practice_count ?? 0;
    const correct = p?.correct_count ?? 0;
    return {
      id: w.id, text: w.text, difficulty: w.difficulty,
      practice, correct,
      status: practice >= MASTERY_COUNT ? "mastered" : practice > 0 ? "learning" : "new",
      struggling: practice >= 3 && correct / practice < 0.5,
      focus: false,
    };
  });

  // FOCUS RULE: once every easy word has 4+ practices, hard words become the focus
  const easyDone = rows
    .filter((r) => r.difficulty === "easy")
    .every((r) => r.practice >= 4);
  if (easyDone) {
    rows.forEach((r) => {
      if (r.difficulty === "hard" && r.status !== "mastered") r.focus = true;
    });
  }

  // SUGGESTION: struggling first, then easy new/low, then hard, then anything unmastered
  const pickLowest = (list: WordRow[]) =>
    [...list].sort((a, b) => a.practice - b.practice)[0];
  const suggestion =
    pickLowest(rows.filter((r) => r.struggling && r.status !== "mastered")) ??
    (!easyDone
      ? pickLowest(rows.filter((r) => r.difficulty === "easy" && r.practice < 4))
      : undefined) ??
    pickLowest(rows.filter((r) => r.difficulty === "hard" && r.status !== "mastered")) ??
    pickLowest(rows.filter((r) => r.status !== "mastered"));

  const masteredCount = rows.filter((r) => r.status === "mastered").length;

  // Groups shown as compact chip sections (short + scannable on mobile)
  const groups: { title: string; items: WordRow[] }[] = [
    { title: "❤️ Needs love", items: rows.filter((r) => r.struggling && r.status !== "mastered") },
    { title: "🎯 Focus (hard words)", items: rows.filter((r) => r.focus && !r.struggling) },
    { title: "⭕ New words", items: rows.filter((r) => r.status === "new" && !r.focus && !r.struggling) },
    { title: "🔵 Keep learning", items: rows.filter((r) => r.status === "learning" && !r.focus && !r.struggling) },
    { title: "⭐ Mastered", items: rows.filter((r) => r.status === "mastered") },
  ].filter((g) => g.items.length > 0);

  const chipStyle = (r: WordRow) => {
    if (r.struggling) return "border-rose-300 bg-rose-50 text-rose-800";
    if (r.focus) return "border-purple-300 bg-purple-50 text-purple-800";
    if (r.status === "mastered") return "border-emerald-200 bg-emerald-50 text-emerald-700";
    if (r.status === "learning") return "border-brand-200 bg-brand-50 text-brand-700";
    return "border-gray-300 bg-white text-gray-800";
  };

  return (
    <main className="mx-auto max-w-lg p-4 pb-16">
      <header className="mb-4">
        <Link href="/student" className="text-sm text-gray-500">&larr; Home</Link>
        <h1 className="mt-1 text-xl font-bold">📖 {unit.name}</h1>
        <p className="text-sm text-gray-500">
          Tap a word to practice it · ⭐ {masteredCount}/{rows.length} mastered
        </p>
      </header>

      {suggestion && (
        <Link href={`/student/learn/${unit.id}/${suggestion.id}`}
          className="mb-5 block rounded-2xl bg-gradient-to-r from-indigo-500 to-purple-600 p-4 text-white shadow-lg shadow-purple-200 transition active:scale-[0.98]">
          <p className="text-sm text-indigo-100">✨ Suggested for you — tap to start</p>
          <p className="text-2xl font-extrabold">
            {suggestion.text}{suggestion.struggling && " ❤️"}
          </p>
          <p className="mt-0.5 text-sm text-indigo-100">
            {suggestion.struggling
              ? "This word needs some love — let's learn it together!"
              : suggestion.status === "new"
                ? "A new word for you!"
                : "Keep going — you're getting close!"}
          </p>
        </Link>
      )}

      {lockedWords.length > 0 && (
        <p className="mb-3 rounded-xl bg-gray-50 px-4 py-2.5 text-sm text-gray-500">
          🔒 Part 2 ({lockedWords.length} words) opens when your teacher assigns it.
        </p>
      )}

      {groups.map((g) => (
        <section key={g.title} className="mb-4">
          <p className="mb-2 px-1 text-sm font-bold text-gray-600">
            {g.title} <span className="font-normal text-gray-400">({g.items.length})</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {g.items.map((r) => (
              <Link key={r.id} href={`/student/learn/${unit.id}/${r.id}`}
                className={
                  "rounded-full border-2 px-3.5 py-2 text-sm font-semibold transition active:scale-95 " +
                  chipStyle(r)
                }>
                {r.text}
                {r.status !== "new" && r.status !== "mastered" && (
                  <span className="ml-1 text-xs font-normal opacity-70">
                    {r.practice}/{MASTERY_COUNT}
                  </span>
                )}
                {r.status === "mastered" && <span className="ml-1">⭐</span>}
              </Link>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
