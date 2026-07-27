import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const pct = (n: number, d: number) =>
  d > 0 ? `${Math.round((n / d) * 100)}%` : "—";

export default async function EvaluationPage() {
  const profile = await requireProfile("teacher");
  const supabase = await createClient();
  const admin = createAdminClient();

  // Load classes + students
  const { data: classes } = await supabase
    .from("classes")
    .select("id, name, enrollments(student:profiles!enrollments_student_id_fkey(id, username, full_name))")
    .eq("teacher_id", profile.id)
    .order("created_at");

  const allStudents = (classes ?? []).flatMap((cls) =>
    (cls.enrollments ?? [])
      .map((e) => {
        const s = Array.isArray(e.student) ? e.student[0] : e.student;
        return s
          ? { ...(s as { id: string; username: string; full_name: string }),
              className: cls.name, classId: cls.id }
          : null;
      })
      .filter(Boolean)
  ) as { id: string; username: string; full_name: string; className: string; classId: string }[];

  if (allStudents.length === 0) {
    return (
      <main className="mx-auto max-w-2xl p-4">
        <Link href="/teacher" className="text-sm text-brand-600">← Dashboard</Link>
        <h1 className="mt-1 text-xl font-bold">📋 Full evaluation</h1>
        <p className="mt-4 text-gray-500">No students enrolled yet.</p>
      </main>
    );
  }

  const studentIds = allStudents.map((s) => s.id);

  // Load ALL data — no class-level filter on words so we get everything
  const [
    { data: questions },
    { data: wSentences },
    { data: wordProgress },
  ] = await Promise.all([
    admin
      .from("questions")
      .select("student_id, word_id, question_type, is_correct, attempts, hints_used, student_answer, ai_feedback, difficulty_level, answered_at, practice_sessions!inner(mode)")
      .in("student_id", studentIds)
      .neq("question_type", "lesson_content")
      .not("answered_at", "is", null)
      .order("answered_at"),
    admin
      .from("writing_sentences")
      .select("student_id, word_id, session_id, sentence, is_correct, grammar_score, usage_score, naturalness_score, ai_feedback, grammar_correction, improved_sentence, turn_number, created_at")
      .in("student_id", studentIds)
      .order("created_at"),
    admin
      .from("word_progress")
      .select("student_id, word_id, practice_count, correct_count, current_level, writing_attempts, writing_correct")
      .in("student_id", studentIds),
  ]);

  // Collect ALL word IDs we need to look up — from questions + sentences + progress
  const allWordIds = new Set<string>([
    ...(questions ?? []).map((q) => q.word_id),
    ...(wSentences ?? []).map((s) => s.word_id),
    ...(wordProgress ?? []).map((p) => p.word_id),
  ]);

  // Fetch those words directly (no deep join, no filter issues)
  const { data: words } = allWordIds.size > 0
    ? await admin
        .from("words")
        .select("id, text, difficulty, unit_id, units(name)")
        .in("id", [...allWordIds])
    : { data: [] };

  const wordMap = new Map(
    (words ?? []).map((w) => {
      const u = Array.isArray(w.units) ? w.units[0] : w.units;
      return [w.id, { text: w.text, difficulty: w.difficulty, unit: (u as { name?: string } | null)?.name ?? "" }];
    })
  );

  type PK = `${string}|${string}`;
  const progMap = new Map(
    (wordProgress ?? []).map((p) => [`${p.student_id}|${p.word_id}` as PK, p])
  );

  return (
    <main className="mx-auto max-w-2xl p-4 pb-16">
      <header className="mb-5">
        <Link href="/teacher" className="text-sm text-brand-600">← Dashboard</Link>
        <h1 className="mt-1 text-xl font-bold">📋 Full evaluation</h1>
        <p className="text-sm text-gray-500">
          Per student · per word · quiz + practice + writing
        </p>
      </header>

      {/* Download buttons */}
      <div className="mb-5 rounded-2xl border border-gray-200 bg-white p-4">
        <p className="mb-2 font-bold text-sm">📥 Download complete datasets</p>
        <div className="flex flex-wrap gap-2">
          <a href="/api/reports/evaluation?type=writing"
            className="rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white">
            ✍️ Writing transcripts (CSV)
          </a>
          <a href="/api/reports/evaluation?type=quiz"
            className="rounded-xl bg-indigo-500 px-4 py-2.5 text-sm font-semibold text-white">
            🎯 Quiz &amp; practice data (CSV)
          </a>
        </div>
      </div>

      {allStudents.map((student) => {
        const qs = (questions ?? []).filter((q) => q.student_id === student.id);
        const sentences = (wSentences ?? []).filter((s) => s.student_id === student.id);

        const quizQs = qs.filter((q) => {
          const ps = Array.isArray(q.practice_sessions) ? q.practice_sessions[0] : q.practice_sessions;
          return (ps as { mode?: string } | null)?.mode === "quiz";
        });
        const practiceQs = qs.filter((q) => {
          const ps = Array.isArray(q.practice_sessions) ? q.practice_sessions[0] : q.practice_sessions;
          return (ps as { mode?: string } | null)?.mode === "practice";
        });

        // Words this student touched
        const wordIds = new Set([
          ...qs.map((q) => q.word_id),
          ...sentences.map((s) => s.word_id),
        ]);

        const totalQuizCorrect = quizQs.filter((q) => q.is_correct).length;
        const totalPracticeCorrect = practiceQs.filter((q) => q.is_correct).length;
        const totalWritingCorrect = sentences.filter((s) => s.is_correct).length;
        const hasAnyData = qs.length > 0 || sentences.length > 0;

        return (
          <details key={student.id} className="mb-3 rounded-2xl border border-gray-200 bg-white">
            <summary className="cursor-pointer select-none list-none p-4 [&::-webkit-details-marker]:hidden">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="font-bold">{student.full_name}</p>
                  <p className="text-sm text-gray-500">{student.username} · {student.className}</p>
                </div>
                {hasAnyData ? (
                  <div className="grid grid-cols-3 gap-1.5 text-center text-xs">
                    <div className="rounded-xl bg-indigo-50 px-2 py-1.5">
                      <p className="font-bold text-indigo-700">
                        {pct(totalQuizCorrect, quizQs.length)}
                      </p>
                      <p className="text-gray-500">Quiz</p>
                    </div>
                    <div className="rounded-xl bg-amber-50 px-2 py-1.5">
                      <p className="font-bold text-amber-700">
                        {pct(totalPracticeCorrect, practiceQs.length)}
                      </p>
                      <p className="text-gray-500">Practice</p>
                    </div>
                    <div className="rounded-xl bg-emerald-50 px-2 py-1.5">
                      <p className="font-bold text-emerald-700">
                        {pct(totalWritingCorrect, sentences.length)}
                      </p>
                      <p className="text-gray-500">Writing</p>
                    </div>
                  </div>
                ) : (
                  <span className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-500">
                    Not started
                  </span>
                )}
              </div>
            </summary>

            {hasAnyData && (
              <div className="border-t border-gray-100 p-4 space-y-2">
                {wordIds.size === 0 && (
                  <p className="text-sm text-gray-500">No word data found.</p>
                )}
                {[...wordIds].map((wordId) => {
                  const w = wordMap.get(wordId);
                  const wordLabel = w?.text ?? wordId.slice(0, 8) + "…";
                  const unit = w?.unit ?? "";
                  const diff = w?.difficulty ?? "easy";

                  const wQuizQs = quizQs.filter((q) => q.word_id === wordId);
                  const wPracticeQs = practiceQs.filter((q) => q.word_id === wordId);
                  const wSents = sentences.filter((s) => s.word_id === wordId);
                  const prog = progMap.get(`${student.id}|${wordId}` as PK);

                  const quizCorrect = wQuizQs.filter((q) => q.is_correct).length;
                  const practiceCorrect = wPracticeQs.filter((q) => q.is_correct).length;
                  const writingCorrect = wSents.filter((s) => s.is_correct).length;

                  const quizRate = wQuizQs.length > 0 ? quizCorrect / wQuizQs.length : null;
                  const writingRate = wSents.length > 0 ? writingCorrect / wSents.length : null;
                  const hasGap = quizRate !== null && writingRate !== null && quizRate - writingRate > 0.3;

                  return (
                    <details key={wordId}
                      className={"rounded-2xl border p-3 " +
                        (hasGap ? "border-orange-200 bg-orange-50" : "border-gray-100 bg-gray-50")}>
                      <summary className="cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold">{wordLabel}</span>
                            <span className={"text-xs " + (diff === "easy" ? "text-green-600" : "text-red-500")}>
                              {diff === "easy" ? "🟢" : "🔴"}
                            </span>
                            {unit && <span className="text-xs text-gray-400">{unit}</span>}
                            {hasGap && (
                              <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-bold text-orange-700">
                                ⚠️ Gap
                              </span>
                            )}
                          </div>
                          <div className="flex gap-2 text-xs font-semibold shrink-0">
                            {wQuizQs.length > 0 && (
                              <span className="text-indigo-600">Q:{pct(quizCorrect, wQuizQs.length)}</span>
                            )}
                            {wPracticeQs.length > 0 && (
                              <span className="text-amber-600">P:{pct(practiceCorrect, wPracticeQs.length)}</span>
                            )}
                            {wSents.length > 0 && (
                              <span className="text-emerald-600">W:{pct(writingCorrect, wSents.length)}</span>
                            )}
                          </div>
                        </div>

                        {/* Mini progress bars */}
                        <div className="mt-2 grid grid-cols-3 gap-1">
                          {[
                            { n: quizCorrect, d: wQuizQs.length, color: "bg-indigo-400", label: `Quiz (${wQuizQs.length})` },
                            { n: practiceCorrect, d: wPracticeQs.length, color: "bg-amber-400", label: `Practice (${wPracticeQs.length})` },
                            { n: writingCorrect, d: wSents.length, color: "bg-emerald-400", label: `Writing (${wSents.length})` },
                          ].map((bar) => (
                            <div key={bar.label}>
                              <div className="h-1.5 rounded-full bg-white">
                                <div
                                  className={`h-1.5 rounded-full ${bar.color}`}
                                  style={{ width: bar.d > 0 ? `${Math.round((bar.n / bar.d) * 100)}%` : "0%" }}
                                />
                              </div>
                              <p className="mt-0.5 text-[10px] text-gray-400">{bar.label}</p>
                            </div>
                          ))}
                        </div>
                      </summary>

                      <div className="mt-3 border-t border-gray-200 pt-3 space-y-3">
                        {prog && (
                          <div className="grid grid-cols-3 gap-2 text-center text-xs">
                            <div className="rounded-lg bg-white p-2">
                              <p className="font-bold">{prog.practice_count}</p>
                              <p className="text-gray-400">total practices</p>
                            </div>
                            <div className="rounded-lg bg-white p-2">
                              <p className="font-bold">Lv{prog.current_level}</p>
                              <p className="text-gray-400">current level</p>
                            </div>
                            <div className="rounded-lg bg-white p-2">
                              <p className="font-bold">{prog.writing_attempts}</p>
                              <p className="text-gray-400">writing tries</p>
                            </div>
                          </div>
                        )}

                        {hasGap && (
                          <div className="rounded-xl bg-orange-100 px-3 py-2 text-xs text-orange-800">
                            <b>⚠️ Receptive/productive gap:</b>{" "}
                            {student.full_name.split(" ")[0]} scores {pct(quizCorrect, wQuizQs.length)} on
                            quizzes but {pct(writingCorrect, wSents.length)} in writing.
                            They recognise this word but struggle to produce it independently.
                          </div>
                        )}

                        {/* Quiz + practice questions */}
                        {[...wQuizQs, ...wPracticeQs].length > 0 && (
                          <div>
                            <p className="mb-1.5 text-xs font-bold text-gray-600">
                              Quiz &amp; practice questions ({wQuizQs.length + wPracticeQs.length})
                            </p>
                            <div className="space-y-1.5">
                              {[...wQuizQs, ...wPracticeQs].map((q, i) => {
                                const ps = Array.isArray(q.practice_sessions)
                                  ? q.practice_sessions[0] : q.practice_sessions;
                                const mode = (ps as { mode?: string } | null)?.mode ?? "";
                                return (
                                  <div key={i} className={
                                    "rounded-lg px-3 py-2 text-xs " +
                                    (q.is_correct ? "bg-white" : "bg-red-50")
                                  }>
                                    <div className="flex items-center justify-between gap-1">
                                      <span className="font-medium capitalize">
                                        {mode} · {q.question_type.replace(/_/g, " ")} · Lv{q.difficulty_level}
                                      </span>
                                      <span className="shrink-0">
                                        {q.is_correct ? "✅" : "❌"} · {q.attempts}× · 💡{q.hints_used}
                                      </span>
                                    </div>
                                    {q.student_answer && (
                                      <p className="mt-0.5 text-gray-600">
                                        Answer: <i>{q.student_answer}</i>
                                      </p>
                                    )}
                                    {!q.is_correct && q.ai_feedback && (
                                      <p className="mt-0.5 text-red-700">{q.ai_feedback}</p>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Writing sentences */}
                        {wSents.length > 0 && (
                          <div>
                            <p className="mb-1.5 text-xs font-bold text-emerald-700">
                              Written sentences ({wSents.length})
                            </p>
                            <div className="space-y-2">
                              {wSents.map((s, i) => (
                                <div key={i} className={
                                  "rounded-lg px-3 py-2 text-xs " +
                                  (s.is_correct ? "bg-emerald-50" : "bg-orange-50")
                                }>
                                  <p className="font-medium text-gray-800">
                                    {i + 1}. &ldquo;{s.sentence}&rdquo;{" "}
                                    {s.is_correct ? "✅" : "❌"}
                                  </p>
                                  <p className="mt-0.5 text-gray-600 leading-relaxed">
                                    {s.ai_feedback}
                                  </p>
                                  {s.grammar_correction && (
                                    <p className="mt-0.5 text-orange-700">
                                      ✏️ Correction: <i>{s.grammar_correction}</i>
                                    </p>
                                  )}
                                  {s.improved_sentence && (
                                    <p className="mt-0.5 text-blue-700">
                                      💡 Improved: <i>{s.improved_sentence}</i>
                                    </p>
                                  )}
                                  <div className="mt-1 flex gap-2 text-gray-400">
                                    {s.grammar_score != null && (
                                      <span>Grammar: {Math.round(s.grammar_score * 100)}%</span>
                                    )}
                                    {s.usage_score != null && (
                                      <span>Usage: {Math.round(s.usage_score * 100)}%</span>
                                    )}
                                    {s.naturalness_score != null && (
                                      <span>Natural: {Math.round(s.naturalness_score * 100)}%</span>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </details>
                  );
                })}
              </div>
            )}
          </details>
        );
      })}
    </main>
  );
}
