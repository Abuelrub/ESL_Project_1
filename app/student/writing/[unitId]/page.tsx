import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import WritingWordPicker from "@/components/WritingWordPicker";

export const dynamic = "force-dynamic";

export default async function WritingWordPickerPage({
  params,
}: { params: Promise<{ unitId: string }> }) {
  const profile = await requireProfile("student");
  const { unitId } = await params;
  const supabase = await createClient();

  const { data: unit } = await supabase
    .from("units")
    .select("id, name, course_id, part1_name, part2_name, part1_assigned, part2_assigned, words(id, text, difficulty, part)")
    .eq("id", unitId).single();
  if (!unit) notFound();

  const u = unit as unknown as {
    part1_name?: string; part2_name?: string;
    part1_assigned?: boolean; part2_assigned?: boolean;
  };

  const allWords = (unit.words ?? []) as { id: string; text: string; difficulty: string; part?: number }[];
  const words = allWords.filter((w) => {
    const p = w.part ?? 1;
    return p === 1 ? u.part1_assigned : u.part2_assigned;
  });

  if (words.length === 0) {
    return (
      <main className="mx-auto max-w-lg p-4">
        <Link href="/student" className="text-sm text-gray-500">← Home</Link>
        <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 text-center">
          <p className="mb-2 text-3xl">🔒</p>
          <p className="font-bold">No words assigned yet</p>
          <p className="mt-1 text-sm text-gray-500">Your teacher will assign words soon.</p>
        </div>
      </main>
    );
  }

  // Load writing scores
  const { data: progress } = await supabase
    .from("word_progress")
    .select("word_id, writing_attempts")
    .eq("student_id", profile.id)
    .in("word_id", words.map((w) => w.id));

  const { data: correctRows } = await supabase
    .from("writing_sentences")
    .select("word_id")
    .eq("student_id", profile.id)
    .eq("is_correct", true)
    .in("word_id", words.map((w) => w.id));

  const correctCount = new Map<string, number>();
  for (const r of correctRows ?? []) {
    correctCount.set(r.word_id, (correctCount.get(r.word_id) ?? 0) + 1);
  }
  const attemptMap = new Map((progress ?? []).map((p) => [p.word_id, p.writing_attempts ?? 0]));

  const totalEvaluated = words.filter((w) => (correctCount.get(w.id) ?? 0) >= 3).length;

  // Build word data for the client component
  const wordData = words.map((w) => ({
    id: w.id,
    text: w.text,
    difficulty: w.difficulty,
    part: w.part,
    correct: correctCount.get(w.id) ?? 0,
    attempted: attemptMap.get(w.id) ?? 0,
  }));

  return (
    <main className="mx-auto max-w-lg p-4 pb-16">
      <header className="mb-4">
        <Link href="/student" className="text-sm text-gray-500">← Home</Link>
        <h1 className="mt-1 text-xl font-bold">✍️ Writing Studio</h1>
        <p className="text-sm text-gray-500">{unit.name}</p>
        <p className="mt-1 text-sm font-medium text-emerald-700">
          ✅ {totalEvaluated}/{words.length} words writing-evaluated
        </p>
      </header>

      <WritingWordPicker unitId={unit.id} words={wordData} />
    </main>
  );
}
