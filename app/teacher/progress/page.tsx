// @ts-nocheck
import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function ProgressMatrixPage({
  searchParams,
}: {
  searchParams: Promise<{ unit?: string; course?: string; mode?: string }>;
}) {
  const profile = await requireProfile("teacher");
  const { unit: selectedUnitId, course: selectedCourseId, mode: selectedMode } = await searchParams;
  const mode = selectedMode === "writing" ? "writing" : "practice";
  const supabase = await createClient();
  const admin    = createAdminClient();

  // ── Load teacher's classes separately, then courses, then units ──
  const { data: classes } = await supabase
    .from("classes")
    .select("id, name")
    .eq("teacher_id", profile.id)
    .order("created_at");

  const classIds = (classes ?? []).map((c) => c.id);

  const { data: coursesRaw } = classIds.length
    ? await admin
        .from("courses")
        .select("id, name, class_id")
        .in("class_id", classIds)
    : { data: [] };

  const { data: unitsRaw } = coursesRaw?.length
    ? await admin
        .from("units")
        .select("id, name, order_index, course_id, part1_name, part2_name, part1_assigned, part2_assigned")
        .in("course_id", (coursesRaw ?? []).map((c) => c.id))
    : { data: [] };

  const classMap = new Map((classes ?? []).map((c) => [c.id, c]));

  const allCourses = (coursesRaw ?? []).map((co) => {
    const cls = classMap.get(co.class_id);
    return {
      ...co,
      className: cls?.name ?? "",
      classId: co.class_id,
      units: (unitsRaw ?? []).filter((u) => u.course_id === co.id),
    };
  });

  // Pick selected course (default to first)
  const course = allCourses.find((c) => c.id === selectedCourseId) ?? allCourses[0];

  // All units for this course sorted
  const units = [...(course?.units ?? [])].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));

  // Pick selected unit (default to first)
  const unit = units.find((u) => u.id === selectedUnitId) ?? units[0];

  if (!course || !unit) {
    return (
      <main className="mx-auto max-w-4xl p-4">
        <Link href="/teacher" className="text-sm text-brand-600">← Dashboard</Link>
        <h1 className="mt-2 text-xl font-bold">📊 Unit Progress Matrix</h1>
        <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 text-center">
          <p className="text-gray-500">No courses or units found. Add units and words to your course first.</p>
        </div>
      </main>
    );
  }

  // ── Load words for selected unit ──────────────────────────
  const { data: words } = await admin
    .from("words")
    .select("id, text, difficulty, part")
    .eq("unit_id", unit.id)
    .order("created_at");

  const wordList = (words ?? []) as { id: string; text: string; difficulty: string; part: number }[];

  // Split by part
  const part1Words = wordList.filter((w) => (w.part ?? 1) === 1);
  const part2Words = wordList.filter((w) => (w.part ?? 1) === 2);

  // ── Load enrolled students ────────────────────────────────
  const { data: enrollments } = await admin
    .from("enrollments")
    .select("student:profiles!enrollments_student_id_fkey(id, full_name, username)")
    .eq("class_id", course.classId);

  const students = (enrollments ?? [])
    .map((e) => (Array.isArray(e.student) ? e.student[0] : e.student))
    .filter(Boolean)
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  if (students.length === 0 || wordList.length === 0) {
    return (
      <main className="mx-auto max-w-4xl p-4 pb-16">
        <Link href="/teacher" className="text-sm text-brand-600">← Dashboard</Link>
        <h1 className="mt-2 text-xl font-bold">📊 Unit Progress Matrix</h1>
        <p className="mt-4 text-gray-500">
          {students.length === 0 ? "No students enrolled yet." : "No words in this unit yet."}
        </p>
      </main>
    );
  }

  // ── Load practice data for all students × all words ───────
  const studentIds = students.map((s) => s.id);
  const wordIds    = wordList.map((w) => w.id);

  const { data: progress } = await admin
    .from("word_progress")
    .select("student_id, word_id, practice_count, correct_count, current_level")
    .in("student_id", studentIds)
    .in("word_id", wordIds);

  // Also load quiz exposure counts
  const { data: quizRows } = await admin
    .from("questions")
    .select("student_id, word_id, is_correct, practice_sessions!inner(mode)")
    .in("student_id", studentIds)
    .in("word_id", wordIds)
    .not("answered_at", "is", null);

  // Also load writing counts
  const { data: writingRows } = await admin
    .from("writing_sentences")
    .select("student_id, word_id, is_correct")
    .in("student_id", studentIds)
    .in("word_id", wordIds);

  // Build lookup: `${studentId}|${wordId}` → stats
  type Stats = {
    practice_count: number;
    correct_count: number;
    current_level: number;
    quiz_count: number;
    quiz_correct: number;
    writing_count: number;
    writing_correct: number;
  };
  const statsMap = new Map<string, Stats>();

  for (const p of progress ?? []) {
    const key = `${p.student_id}|${p.word_id}`;
    statsMap.set(key, {
      practice_count:  p.practice_count ?? 0,
      correct_count:   p.correct_count  ?? 0,
      current_level:   p.current_level  ?? 1,
      quiz_count:      0,
      quiz_correct:    0,
      writing_count:   0,
      writing_correct: 0,
    });
  }

  for (const q of quizRows ?? []) {
    const ps = Array.isArray(q.practice_sessions) ? q.practice_sessions[0] : q.practice_sessions;
    if ((ps as { mode?: string })?.mode !== "quiz") continue;
    const key = `${q.student_id}|${q.word_id}`;
    const s = statsMap.get(key) ?? { practice_count:0, correct_count:0, current_level:1, quiz_count:0, quiz_correct:0, writing_count:0, writing_correct:0 };
    s.quiz_count++;
    if (q.is_correct) s.quiz_correct++;
    statsMap.set(key, s);
  }

  for (const w of writingRows ?? []) {
    const key = `${w.student_id}|${w.word_id}`;
    const s = statsMap.get(key) ?? { practice_count:0, correct_count:0, current_level:1, quiz_count:0, quiz_correct:0, writing_count:0, writing_correct:0 };
    s.writing_count++;
    if (w.is_correct) s.writing_correct++;
    statsMap.set(key, s);
  }

  // ── Cell colour logic ─────────────────────────────────────
  function cellInfo(studentId: string, wordId: string) {
    const st = statsMap.get(`${studentId}|${wordId}`);
    if (mode === "writing") {
      const wc = st?.writing_count ?? 0;
      const wr = st?.writing_correct ?? 0;
      if (wc === 0) return { bg: "bg-gray-100", text: "—", label: "Not written", pc: 0 };
      if (wr >= 3)  return { bg: "bg-emerald-200", text: `${wr}✓`, label: "Evaluated", pc: wc };
      if (wc >= 1)  return { bg: "bg-amber-200",   text: `${wr}/${wc}`, label: "In progress", pc: wc };
      return { bg: "bg-gray-100", text: "—", label: "Not written", pc: 0 };
    }
    if (!st || st.practice_count === 0) return { bg: "bg-gray-100", text: "—", label: "Not started", pc: 0 };
    if (st.practice_count >= 8) return { bg: "bg-emerald-200", text: String(st.practice_count), label: "Mastered", pc: st.practice_count };
    if (st.practice_count >= 4) return { bg: "bg-amber-200",   text: String(st.practice_count), label: "Learning",  pc: st.practice_count };
    return { bg: "bg-blue-200", text: String(st.practice_count), label: "Started", pc: st.practice_count };
  }

  // ── Class summary per word ────────────────────────────────
  function wordSummary(wordId: string) {
    const total = students.length;
    if (mode === "writing") {
      const touched  = students.filter((s) => (statsMap.get(`${s.id}|${wordId}`)?.writing_count ?? 0) > 0).length;
      const mastered = students.filter((s) => (statsMap.get(`${s.id}|${wordId}`)?.writing_correct ?? 0) >= 3).length;
      return { total, touched, mastered };
    }
    const touched  = students.filter((s) => (statsMap.get(`${s.id}|${wordId}`)?.practice_count ?? 0) > 0).length;
    const mastered = students.filter((s) => (statsMap.get(`${s.id}|${wordId}`)?.practice_count ?? 0) >= 8).length;
    return { total, touched, mastered };
  }

  // ── Student summary (words touched vs total) ──────────────
  function studentSummary(studentId: string) {
    if (mode === "writing") {
      const touched  = wordList.filter((w) => (statsMap.get(`${studentId}|${w.id}`)?.writing_count ?? 0) > 0).length;
      const mastered = wordList.filter((w) => (statsMap.get(`${studentId}|${w.id}`)?.writing_correct ?? 0) >= 3).length;
      return { touched, mastered, notStarted: wordList.length - touched };
    }
    const touched  = wordList.filter((w) => (statsMap.get(`${studentId}|${w.id}`)?.practice_count ?? 0) > 0).length;
    const mastered = wordList.filter((w) => (statsMap.get(`${studentId}|${w.id}`)?.practice_count ?? 0) >= 8).length;
    return { touched, mastered, notStarted: wordList.length - touched };
  }

  const u = unit as { part1_name?: string; part2_name?: string; part1_assigned?: boolean; part2_assigned?: boolean };
  const part1Label = u.part1_name ?? "Part 1";
  const part2Label = u.part2_name ?? "Part 2";

  return (
    <main className="mx-auto max-w-[1200px] p-4 pb-16">
      {/* Header */}
      <header className="mb-5">
        <Link href="/teacher" className="text-sm text-brand-600">← Dashboard</Link>
        <h1 className="mt-1 text-xl font-bold">📊 Unit Progress Matrix</h1>
        <p className="text-sm text-gray-500">
          See every student's progress on every word — at a glance.
        </p>
      </header>

      {/* Filters */}
      <div className="mb-5 flex flex-wrap gap-3">
        {allCourses.length > 1 && (
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-600">Course</label>
            <div className="flex flex-wrap gap-2">
              {allCourses.map((co) => (
                <Link key={co.id}
                  href={`/teacher/progress?course=${co.id}`}
                  className={`rounded-xl border px-3 py-2 text-sm font-medium transition ${
                    co.id === course.id
                      ? "border-brand-500 bg-brand-50 text-brand-700"
                      : "border-gray-300 bg-white text-gray-600 hover:border-brand-300"
                  }`}>
                  {co.name}
                </Link>
              ))}
            </div>
          </div>
        )}
        <div>
          <label className="mb-1 block text-xs font-semibold text-gray-600">Unit</label>
          <div className="flex flex-wrap gap-2">
            {units.map((u) => (
              <Link key={u.id}
                href={`/teacher/progress?course=${course.id}&unit=${u.id}`}
                className={`rounded-xl border px-3 py-2 text-sm font-medium transition ${
                  u.id === unit.id
                    ? "border-brand-500 bg-brand-50 text-brand-700"
                    : "border-gray-300 bg-white text-gray-600 hover:border-brand-300"
                }`}>
                {u.name}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Mode toggle */}
      <div className="mb-4 flex items-center gap-2">
        <span className="text-sm font-semibold text-gray-600">Show:</span>
        <Link href={`/teacher/progress?course=${course.id}&unit=${unit.id}&mode=practice`}
          className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
            mode === "practice"
              ? "bg-brand-500 text-white"
              : "border border-gray-300 bg-white text-gray-600 hover:border-brand-300"
          }`}>
          📖 Practice & Quiz
        </Link>
        <Link href={`/teacher/progress?course=${course.id}&unit=${unit.id}&mode=writing`}
          className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
            mode === "writing"
              ? "bg-purple-500 text-white"
              : "border border-gray-300 bg-white text-gray-600 hover:border-brand-300"
          }`}>
          ✍️ Writing
        </Link>
      </div>

      {/* Download button */}
      <div className="mb-4 flex justify-end">
        <a
          href={`/api/reports/progress?unit=${unit.id}&mode=${mode}`}
          download
          className={`rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition active:scale-95 ${
            mode === "writing" ? "bg-purple-500 hover:bg-purple-600" : "bg-brand-500 hover:bg-brand-600"
          }`}>
          📥 Download {mode === "writing" ? "Writing" : "Practice"} CSV
        </a>
      </div>

      {/* Legend */}
      <div className="mb-4 flex flex-wrap items-center gap-4 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-xs">
        <span className="font-semibold text-gray-600">Legend:</span>
        {mode === "practice" ? (
          <>
            {[
              { bg: "bg-gray-100",    label: "⬜ Not started" },
              { bg: "bg-blue-200",    label: "🟦 Started (1–3)" },
              { bg: "bg-amber-200",   label: "🟨 Learning (4–7)" },
              { bg: "bg-emerald-200", label: "🟩 Mastered (8+)" },
            ].map((l) => (
              <span key={l.label} className="flex items-center gap-1.5">
                <span className={`inline-block h-4 w-4 rounded ${l.bg} border border-gray-300`} />
                {l.label}
              </span>
            ))}
            <span className="ml-auto text-gray-400">Number = times practiced</span>
          </>
        ) : (
          <>
            {[
              { bg: "bg-gray-100",    label: "⬜ Not written yet" },
              { bg: "bg-amber-200",   label: "🟨 In progress (correct/attempts)" },
              { bg: "bg-emerald-200", label: "🟩 Evaluated (3+ correct sentences)" },
            ].map((l) => (
              <span key={l.label} className="flex items-center gap-1.5">
                <span className={`inline-block h-4 w-4 rounded ${l.bg} border border-gray-300`} />
                {l.label}
              </span>
            ))}
            <span className="ml-auto text-gray-400">Cell shows correct/total sentences</span>
          </>
        )}
      </div>

      {/* Summary stats */}
      <div className="mb-5 grid grid-cols-3 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-gray-200 bg-white p-3 text-center">
          <p className="text-2xl font-extrabold text-brand-700">{students.length}</p>
          <p className="text-xs text-gray-500">Students</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-3 text-center">
          <p className="text-2xl font-extrabold text-brand-700">{wordList.length}</p>
          <p className="text-xs text-gray-500">Words</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-3 text-center">
          <p className="text-2xl font-extrabold text-emerald-600">
            {students.reduce((n, s) => n + studentSummary(s.id).mastered, 0)}
          </p>
          <p className="text-xs text-gray-500">Total mastered</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-3 text-center">
          <p className="text-2xl font-extrabold text-red-500">
            {students.reduce((n, s) => n + studentSummary(s.id).notStarted, 0)}
          </p>
          <p className="text-xs text-gray-500">Not started (all students)</p>
        </div>
      </div>

      {/* Matrix table */}
      <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
        <table className="min-w-full text-xs">
          <thead>
            {/* Part header row */}
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="sticky left-0 z-10 bg-gray-50 px-3 py-2 text-left font-semibold text-gray-600 min-w-[140px]">
                Student
              </th>
              <th className="px-2 py-2 text-center font-semibold text-gray-500 min-w-[60px]">
                Summary
              </th>
              {part1Words.length > 0 && (
                <th colSpan={part1Words.length}
                  className={`px-2 py-2 text-center font-bold ${u.part1_assigned ? "text-brand-700" : "text-gray-400"}`}>
                  {part1Label} {u.part1_assigned ? "📌" : "🔒"}
                </th>
              )}
              {part2Words.length > 0 && (
                <th colSpan={part2Words.length}
                  className={`border-l border-gray-200 px-2 py-2 text-center font-bold ${u.part2_assigned ? "text-brand-700" : "text-gray-400"}`}>
                  {part2Label} {u.part2_assigned ? "📌" : "🔒"}
                </th>
              )}
            </tr>
            {/* Word name row */}
            <tr className="border-b-2 border-gray-300 bg-gray-50">
              <th className="sticky left-0 z-10 bg-gray-50 px-3 py-2 text-left text-gray-600">
                &nbsp;
              </th>
              <th className="px-2 py-2 text-center text-gray-500 font-medium">
                ✓ / total
              </th>
              {wordList.map((w, i) => {
                const sum = wordSummary(w.id);
                const isFirstPart2 = w.part === 2 && (wordList[i - 1]?.part ?? 1) === 1;
                return (
                  <th key={w.id}
                    className={`px-2 py-2 font-semibold text-gray-700 min-w-[52px] ${isFirstPart2 ? "border-l border-gray-200" : ""}`}>
                    <div className="flex flex-col items-center gap-0.5">
                      <span className={w.difficulty === "easy" ? "text-green-600" : "text-red-500"}>
                        {w.difficulty === "easy" ? "🟢" : "🔴"}
                      </span>
                      <span className="whitespace-nowrap">{w.text}</span>
                      <span className="text-[10px] font-normal text-gray-400">
                        {sum.touched}/{sum.total}
                      </span>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {students.map((student, si) => {
              const sum = studentSummary(student.id);
              return (
                <tr key={student.id}
                  className={`border-b border-gray-100 ${si % 2 === 0 ? "bg-white" : "bg-gray-50/50"}`}>
                  {/* Student name */}
                  <td className={`sticky left-0 z-10 px-3 py-2 font-semibold text-gray-800 min-w-[140px] ${si % 2 === 0 ? "bg-white" : "bg-gray-50"}`}>
                    <div>
                      <p>{student.full_name}</p>
                      <p className="text-[10px] font-normal text-gray-400">{student.username}</p>
                    </div>
                  </td>
                  {/* Summary cell */}
                  <td className="px-2 py-2 text-center">
                    <div className="flex flex-col items-center">
                      <span className="font-bold text-emerald-600">{sum.mastered}</span>
                      <span className="text-[10px] text-gray-400">{sum.touched}/{wordList.length}</span>
                    </div>
                  </td>
                  {/* Word cells */}
                  {wordList.map((w, i) => {
                    const cell = cellInfo(student.id, w.id);
                    const isFirstPart2 = w.part === 2 && (wordList[i - 1]?.part ?? 1) === 1;
                    return (
                      <td key={w.id}
                        className={`px-1 py-2 text-center ${isFirstPart2 ? "border-l border-gray-200" : ""}`}
                        title={`${student.full_name} — ${w.text}: ${cell.label} (${cell.pc} practices)`}>
                        <span className={`inline-flex h-7 w-10 items-center justify-center rounded-lg text-[11px] font-bold ${cell.bg}`}>
                          {cell.text}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}

            {/* Class average row */}
            <tr className="border-t-2 border-gray-300 bg-brand-50">
              <td className="sticky left-0 z-10 bg-brand-50 px-3 py-2 font-bold text-brand-700">
                Class avg
              </td>
              <td className="px-2 py-2 text-center">
                <span className="font-bold text-brand-700">
                  {students.length > 0
                    ? Math.round(students.reduce((n, s) => n + studentSummary(s.id).mastered, 0) / students.length)
                    : 0}
                </span>
                <span className="text-[10px] text-gray-500"> mastered</span>
              </td>
              {wordList.map((w, i) => {
                const sum = wordSummary(w.id);
                const pct = Math.round((sum.touched / sum.total) * 100);
                const isFirstPart2 = w.part === 2 && (wordList[i - 1]?.part ?? 1) === 1;
                return (
                  <td key={w.id}
                    className={`px-1 py-2 text-center ${isFirstPart2 ? "border-l border-gray-200" : ""}`}>
                    <span className={`inline-flex h-7 w-10 items-center justify-center rounded-lg text-[11px] font-bold ${
                      pct >= 80 ? "bg-emerald-100 text-emerald-700" :
                      pct >= 40 ? "bg-amber-100 text-amber-700" :
                                  "bg-red-100 text-red-700"
                    }`}>
                      {pct}%
                    </span>
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Per-word summary cards */}
      <section className="mt-6">
        <h2 className="mb-3 font-bold text-gray-700">{mode === "writing" ? "Words not yet written" : "Words needing attention"}</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {wordList
            .map((w) => ({ ...w, sum: wordSummary(w.id) }))
            .filter((w) => w.sum.touched < w.sum.total)
            .sort((a, b) => a.sum.touched - b.sum.touched)
            .map((w) => {
              const notStarted = w.sum.total - w.sum.touched;
              return (
                <div key={w.id}
                  className={`rounded-2xl border p-3 ${
                    notStarted === w.sum.total ? "border-red-200 bg-red-50" :
                    notStarted > w.sum.total / 2 ? "border-amber-200 bg-amber-50" :
                    "border-blue-200 bg-blue-50"
                  }`}>
                  <p className="font-semibold text-gray-800">{w.text}</p>
                  <p className="text-xs text-gray-500">
                    {w.difficulty === "easy" ? "🟢 Easy" : "🔴 Hard"}
                  </p>
                  <p className={`mt-1 text-sm font-bold ${
                    notStarted === w.sum.total ? "text-red-600" :
                    notStarted > w.sum.total / 2 ? "text-amber-600" :
                    "text-blue-600"
                  }`}>
                    {notStarted} student{notStarted !== 1 ? "s" : ""} not started
                  </p>
                  <p className="text-xs text-gray-400">
                    {w.sum.mastered} mastered · {w.sum.touched} touched
                  </p>
                </div>
              );
            })}
        </div>
        {wordList.every((w) => wordSummary(w.id).touched === students.length) && (
          <p className="text-sm text-emerald-700">
            🎉 Every student has started every word in this unit!
          </p>
        )}
      </section>
    </main>
  );
}
