import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function TeacherWritingPage() {
  const profile = await requireProfile("teacher");
  const supabase = await createClient();
  const admin = createAdminClient();

  const { data: classes } = await supabase
    .from("classes")
    .select("id, name, enrollments(student:profiles!enrollments_student_id_fkey(id, username, full_name))")
    .eq("teacher_id", profile.id)
    .order("created_at");

  const allStudents = (classes ?? []).flatMap((cls) =>
    (cls.enrollments ?? []).map((e) => {
      const s = Array.isArray(e.student) ? e.student[0] : e.student;
      return s ? { ...s, className: cls.name } : null;
    }).filter(Boolean)
  ) as { id: string; username: string; full_name: string; className: string }[];

  if (allStudents.length === 0) {
    return (
      <main className="mx-auto max-w-2xl p-4">
        <Link href="/teacher" className="text-sm text-brand-600">&larr; Dashboard</Link>
        <h1 className="mt-1 text-xl font-bold">✍️ Writing transcripts</h1>
        <p className="mt-4 text-gray-500">No students enrolled in your classes yet.</p>
      </main>
    );
  }

  const studentIds = allStudents.map((s) => s.id);

  const [{ data: sessions }, { data: sentences }] = await Promise.all([
    admin.from("writing_sessions")
      .select("id, student_id, word_id, sentences_attempted, sentences_correct, final_score, started_at, completed_at, words(text)")
      .in("student_id", studentIds)
      .order("started_at", { ascending: false }),
    admin.from("writing_sentences")
      .select("session_id, student_id, word_id, sentence, is_correct, grammar_score, usage_score, naturalness_score, ai_feedback, grammar_correction, improved_sentence, turn_number, created_at, words(text)")
      .in("student_id", studentIds)
      .order("created_at"),
  ]);

  const sentencesBySession = new Map<string, typeof sentences>();
  for (const s of sentences ?? []) {
    if (!sentencesBySession.has(s.session_id)) sentencesBySession.set(s.session_id, []);
    sentencesBySession.get(s.session_id)!.push(s);
  }

  const studentMap = new Map(allStudents.map((s) => [s.id, s]));

  // Group sessions by student
  const byStudent = new Map<string, typeof sessions>();
  for (const sess of sessions ?? []) {
    if (!byStudent.has(sess.student_id)) byStudent.set(sess.student_id, []);
    byStudent.get(sess.student_id)!.push(sess);
  }

  return (
    <main className="mx-auto max-w-2xl p-4 pb-16">
      <header className="mb-5">
        <Link href="/teacher" className="text-sm text-brand-600">&larr; Dashboard</Link>
        <h1 className="mt-1 text-xl font-bold">✍️ Writing transcripts</h1>
        <p className="text-sm text-gray-500">
          Every sentence your students wrote — the full writing evaluation.
        </p>
      </header>

      {allStudents.map((student) => {
        const stuSessions = byStudent.get(student.id) ?? [];
        if (stuSessions.length === 0) return null;

        const totalSentences = stuSessions.reduce((n, s) => n + s.sentences_attempted, 0);
        const totalCorrect = stuSessions.reduce((n, s) => n + s.sentences_correct, 0);
        const wordsDone = new Set(stuSessions.map((s) => s.word_id)).size;

        return (
          <details key={student.id} className="mb-3 rounded-2xl border border-gray-200 bg-white">
            <summary className="cursor-pointer select-none list-none p-4 [&::-webkit-details-marker]:hidden">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-bold">{student.full_name}</p>
                  <p className="text-sm text-gray-500">{student.username} · {student.className}</p>
                </div>
                <div className="text-right text-sm">
                  <p className="font-semibold text-brand-600">{totalCorrect}/{totalSentences} correct</p>
                  <p className="text-gray-500">{wordsDone} word(s) practiced</p>
                </div>
              </div>
            </summary>

            <div className="border-t border-gray-100 p-4 space-y-4">
              {stuSessions.map((sess) => {
                const word = Array.isArray(sess.words) ? sess.words[0] : sess.words;
                const sents = sentencesBySession.get(sess.id) ?? [];
                const pct = sess.sentences_attempted > 0
                  ? Math.round((sess.sentences_correct / sess.sentences_attempted) * 100) : 0;
                return (
                  <div key={sess.id} className="rounded-xl border border-gray-100 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <p className="font-semibold">
                        {(word as { text?: string } | null)?.text ?? ""}
                      </p>
                      <span className={
                        "text-xs font-bold px-2 py-0.5 rounded-full " +
                        (pct >= 80 ? "bg-emerald-100 text-emerald-700" :
                         pct >= 50 ? "bg-amber-100 text-amber-700" :
                                     "bg-red-100 text-red-700")
                      }>
                        {pct}% · {sess.sentences_correct}/{sess.sentences_attempted}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {sents.map((s, i) => (
                        <div key={s.created_at}
                          className={"rounded-lg p-2.5 text-sm " +
                            (s.is_correct ? "bg-emerald-50" : "bg-orange-50")}>
                          <p className="font-medium text-gray-800">
                            {i + 1}. &ldquo;{s.sentence}&rdquo;
                            <span className="ml-1">
                              {s.is_correct ? "✅" : "❌"}
                            </span>
                          </p>
                          <p className="mt-1 text-gray-600 text-xs">{s.ai_feedback}</p>
                          {s.grammar_correction && (
                            <p className="mt-1 text-orange-700 text-xs">
                              ✏️ Correction: <i>{s.grammar_correction}</i>
                            </p>
                          )}
                          <div className="mt-1 flex gap-2 text-xs text-gray-400">
                            {s.grammar_score != null && <span>Grammar: {Math.round(s.grammar_score * 100)}%</span>}
                            {s.usage_score != null && <span>Usage: {Math.round(s.usage_score * 100)}%</span>}
                            {s.naturalness_score != null && <span>Natural: {Math.round(s.naturalness_score * 100)}%</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </details>
        );
      })}
    </main>
  );
}
