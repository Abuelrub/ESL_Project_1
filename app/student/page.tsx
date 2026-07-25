import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { MASTERY_COUNT } from "@/lib/adaptive";

export const dynamic = "force-dynamic";

export default async function StudentHome() {
  const profile = await requireProfile("student");
  const supabase = await createClient();

  const [{ data: enrollments }, { data: progress }, { data: sessions }, { data: quizWordRows }] = await Promise.all([
    supabase
      .from("enrollments")
      .select("classes(id, name, courses(id, name, units!units_course_id_fkey(id, name, order_index, part1_name, part2_name, part1_assigned, part2_assigned, words(id, part))))")
      .eq("student_id", profile.id),
    supabase
      .from("word_progress")
      .select("word_id, practice_count")
      .eq("student_id", profile.id),
    supabase
      .from("practice_sessions")
      .select("id")
      .eq("student_id", profile.id),
    supabase
      .from("questions")
      .select("word_id, practice_sessions!inner(mode)")
      .eq("student_id", profile.id)
      .eq("practice_sessions.mode", "quiz")
      .not("answered_at", "is", null),
  ]);

  const quizWordCount = new Map<string, number>();
  for (const r of (quizWordRows ?? []) as { word_id: string }[]) {
    quizWordCount.set(r.word_id, (quizWordCount.get(r.word_id) ?? 0) + 1);
  }

  const progressMap = new Map((progress ?? []).map((p) => [p.word_id, p.practice_count]));
  const totalPracticed = progressMap.size;
  const mastered = (progress ?? []).filter((p) => p.practice_count >= MASTERY_COUNT).length;

  const classes = (enrollments ?? [])
    .map((e) => (Array.isArray(e.classes) ? e.classes[0] : e.classes))
    .filter(Boolean);

  return (
    <main className="mx-auto max-w-lg p-4 pb-16">
      <header className="mb-5 rounded-3xl bg-gradient-to-r from-indigo-500 via-purple-500 to-purple-600 p-6 text-white shadow-lg shadow-purple-200">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm text-indigo-100">Hello,</p>
            <h1 className="text-2xl font-extrabold tracking-tight">{profile.full_name} 👋</h1>
            <p className="mt-1 text-sm text-indigo-100">Ready to practice?</p>
          </div>
          <form action="/logout" method="post">
            <button className="rounded-xl bg-white/20 px-4 py-2 text-sm font-semibold backdrop-blur transition hover:bg-white/30">
              Log out
            </button>
          </form>
        </div>
      </header>

      <div className="mb-5 grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-indigo-100 p-4 text-center">
          <p className="text-2xl">🎯</p>
          <p className="mt-1 text-2xl font-extrabold text-indigo-700">{sessions?.length ?? 0}</p>
          <p className="text-xs font-medium text-indigo-600">Sessions</p>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-amber-100 p-4 text-center">
          <p className="text-2xl">✏️</p>
          <p className="mt-1 text-2xl font-extrabold text-amber-700">{totalPracticed}</p>
          <p className="text-xs font-medium text-amber-600">Words</p>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-emerald-100 p-4 text-center">
          <p className="text-2xl">⭐</p>
          <p className="mt-1 text-2xl font-extrabold text-emerald-700">{mastered}</p>
          <p className="text-xs font-medium text-emerald-600">Mastered</p>
        </div>
      </div>

      {classes.length > 0 ? (
        classes.map((cls) =>
          (cls!.courses ?? []).map((course) => {
            return (
            <section key={course.id} className="mb-4">
              <h2 className="mb-2 px-1 text-lg font-bold">📚 {course.name}</h2>
              <div className="grid gap-3">
                {[...(course.units ?? [])]
                  .sort((a, b) => a.order_index - b.order_index)
                  .map((unit) => {
                    const u = unit as unknown as {
                      part1_assigned?: boolean; part2_assigned?: boolean;
                      part1_name?: string; part2_name?: string;
                    };
                    const partsAssigned: string[] = [];
                    if (u.part1_assigned) partsAssigned.push(u.part1_name ?? "Part 1");
                    if (u.part2_assigned) partsAssigned.push(u.part2_name ?? "Part 2");
                    const locked = partsAssigned.length === 0;
                    const isAssigned = partsAssigned.length > 0;
                    const wordIds = ((unit.words ?? []) as { id: string; part?: number }[])
                      .filter((w) => {
                        const p = w.part ?? 1;
                        return p === 1 ? u.part1_assigned : u.part2_assigned;
                      })
                      .map((w) => w.id);
                    const practiced = wordIds.filter((id) => progressMap.has(id)).length;
                    const masteredHere = wordIds.filter(
                      (id) => (progressMap.get(id) ?? 0) >= MASTERY_COUNT
                    ).length;
                    const pct = wordIds.length > 0
                      ? Math.round((practiced / wordIds.length) * 100) : 0;

                    return (
                      <div key={unit.id}
                        className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                        <div className="mb-2 flex items-center justify-between">
                          <p className="font-semibold">
                            {locked && "🔒 "}{unit.name}
                            {isAssigned && (
                              <span className="ml-1.5 rounded-full bg-brand-100 px-2 py-0.5 text-xs font-bold text-brand-700">
                                📌 {partsAssigned.join(" · ")}
                              </span>
                            )}
                          </p>
                          <span className="text-sm text-gray-500">
                            ⭐ {masteredHere}/{wordIds.length}
                          </span>
                        </div>
                        <div className="mb-1 h-2.5 rounded-full bg-gray-100">
                          <div
                            className="h-2.5 rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <p className="mb-1 text-xs text-gray-500">
                          {practiced} of {wordIds.length} words practiced
                        </p>
                        {(() => {
                          const covered = wordIds.filter((id) => (quizWordCount.get(id) ?? 0) > 0).length;
                          const totalTests = wordIds.reduce((n, id) => n + (quizWordCount.get(id) ?? 0), 0);
                          const avg = wordIds.length > 0 ? (totalTests / wordIds.length).toFixed(1) : "0";
                          return (
                            <p className="mb-3 text-xs text-emerald-700">
                              🎯 Quiz coverage: {covered}/{wordIds.length} words · avg {avg}× each
                            </p>
                          );
                        })()}
                        {locked ? (
                          <p className="rounded-xl bg-gray-50 py-3 text-center text-sm text-gray-500">
                            🔒 Your teacher will open this unit soon
                          </p>
                        ) : wordIds.length > 0 ? (
                          <div className="grid grid-cols-2 gap-2">
                            <Link href={`/student/learn/${unit.id}`}
                              className="block rounded-xl bg-brand-500 py-3 text-center font-semibold text-white transition active:scale-[0.98]">
                              📖 Practice
                            </Link>
                            <Link href={`/student/practice/${unit.id}`}
                              className="block rounded-xl border-2 border-brand-500 bg-white py-3 text-center font-semibold text-brand-600 transition active:scale-[0.98]">
                              🎯 Quiz
                            </Link>
                          </div>
                        ) : (
                          <p className="rounded-xl bg-gray-50 py-3 text-center text-sm text-gray-500">
                            No words in this unit yet
                          </p>
                        )}
                      </div>
                    );
                  })}
              </div>
            </section>
          );})
        )
      ) : (
        <div className="rounded-2xl border border-gray-200 bg-white p-6">
          <p className="text-gray-600">
            You are not enrolled in a class yet. Please ask your teacher.
          </p>
        </div>
      )}
    </main>
  );
}
