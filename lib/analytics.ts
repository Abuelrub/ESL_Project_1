// ============================================================
// CLASS ANALYTICS — computes the full performance evaluation
// used by both the Analytics page and the results downloads.
// ============================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import { welchT, pairedT, pearson, mean, sd, fmt, fmtP } from "@/lib/stats";
import { MASTERY_COUNT } from "@/lib/adaptive";

export interface CellStat {
  asked: number; correct: number; firstTry: number; hints: number; attempts: number;
  quizAsked: number; quizCorrect: number;
  practiceAsked: number; practiceCorrect: number;
}
export interface WordAnalysis {
  wordId: string; text: string; difficulty: string; unit: string;
  total: CellStat;
  mastered: number;
  perStudent: { studentId: string; name: string; username: string; cell: CellStat; level: number; practiceCount: number }[];
}
export interface StudentAnalysis {
  studentId: string; name: string; username: string;
  cell: CellStat; mastered: number; quizScores: { correct: number; total: number }[];
}
export interface Finding {
  icon: string; title: string; stat: string; interpretation: string; hasData: boolean;
}
export interface ClassAnalytics {
  classId: string; className: string;
  needsMigration: boolean;
  words: WordAnalysis[];
  students: StudentAnalysis[];
  findings: Finding[];
  overview: { activeStudents: number; totalStudents: number; totalAnswered: number; accuracy: number; firstTryRate: number; totalHints: number };
}

const emptyCell = (): CellStat => ({
  asked: 0, correct: 0, firstTry: 0, hints: 0, attempts: 0,
  quizAsked: 0, quizCorrect: 0, practiceAsked: 0, practiceCorrect: 0,
});
const addTo = (c: CellStat, r: { mode: string; asked: number; correct: number; first_try: number; hints: number; attempts: number }) => {
  c.asked += Number(r.asked); c.correct += Number(r.correct);
  c.firstTry += Number(r.first_try); c.hints += Number(r.hints); c.attempts += Number(r.attempts);
  if (r.mode === "quiz") { c.quizAsked += Number(r.asked); c.quizCorrect += Number(r.correct); }
  else { c.practiceAsked += Number(r.asked); c.practiceCorrect += Number(r.correct); }
};
export const rate = (part: number, whole: number) => (whole > 0 ? part / whole : NaN);
export const ratePct = (part: number, whole: number) =>
  whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—";

export async function computeClassAnalytics(
  supabase: SupabaseClient,
  classId: string,
  className: string
): Promise<ClassAnalytics> {
  const [{ data: enrollments }, gridRes, { data: wordRows }, { data: progressRows }, { data: quizSessions }] =
    await Promise.all([
      supabase.from("enrollments")
        .select("student:profiles!enrollments_student_id_fkey(id, username, full_name)")
        .eq("class_id", classId),
      supabase.rpc("class_qword_stats", { p_class_id: classId }),
      supabase.from("words")
        .select("id, text, difficulty, units!inner(name, courses!units_course_id_fkey!inner(class_id))")
        .eq("units.courses.class_id", classId),
      supabase.from("word_progress").select("student_id, word_id, practice_count, correct_count, current_level"),
      supabase.from("practice_sessions")
        .select("student_id, total_questions, correct_answers, started_at")
        .eq("mode", "quiz").not("completed_at", "is", null).order("started_at"),
    ]);

  const needsMigration = !!gridRes.error;
  const grid = (gridRes.data ?? []) as {
    student_id: string; word_id: string; mode: string;
    asked: number; correct: number; first_try: number; hints: number; attempts: number;
  }[];

  const students = (enrollments ?? [])
    .map((e) => (Array.isArray(e.student) ? e.student[0] : e.student))
    .filter(Boolean) as { id: string; username: string; full_name: string }[];
  const studentIds = new Set(students.map((s) => s.id));

  const progMap = new Map(
    (progressRows ?? [])
      .filter((p) => studentIds.has(p.student_id))
      .map((p) => [`${p.student_id}|${p.word_id}`, p])
  );

  // ---------- build word x student matrix ----------
  const cellMap = new Map<string, CellStat>();
  const wordTotals = new Map<string, CellStat>();
  const studentTotals = new Map<string, CellStat>();
  for (const r of grid) {
    if (!studentIds.has(r.student_id)) continue;
    const key = `${r.student_id}|${r.word_id}`;
    if (!cellMap.has(key)) cellMap.set(key, emptyCell());
    addTo(cellMap.get(key)!, r);
    if (!wordTotals.has(r.word_id)) wordTotals.set(r.word_id, emptyCell());
    addTo(wordTotals.get(r.word_id)!, r);
    if (!studentTotals.has(r.student_id)) studentTotals.set(r.student_id, emptyCell());
    addTo(studentTotals.get(r.student_id)!, r);
  }

  const words: WordAnalysis[] = ((wordRows ?? []) as unknown as {
    id: string; text: string; difficulty: string;
    units: { name: string } | { name: string }[];
  }[]).map((w) => {
    const unit = Array.isArray(w.units) ? w.units[0] : w.units;
    const perStudent = students
      .map((s) => {
        const cell = cellMap.get(`${s.id}|${w.id}`) ?? emptyCell();
        const prog = progMap.get(`${s.id}|${w.id}`);
        return {
          studentId: s.id, name: s.full_name, username: s.username, cell,
          level: prog?.current_level ?? 0,
          practiceCount: prog?.practice_count ?? 0,
        };
      })
      .filter((ps) => ps.cell.asked > 0 || ps.practiceCount > 0);
    const mastered = students.filter(
      (s) => (progMap.get(`${s.id}|${w.id}`)?.practice_count ?? 0) >= MASTERY_COUNT
    ).length;
    return {
      wordId: w.id, text: w.text, difficulty: w.difficulty,
      unit: unit?.name ?? "", total: wordTotals.get(w.id) ?? emptyCell(),
      mastered, perStudent,
    };
  }).sort((a, b) =>
    rate(a.total.firstTry, a.total.asked) - rate(b.total.firstTry, b.total.asked) || a.text.localeCompare(b.text)
  );

  const studentAnalyses: StudentAnalysis[] = students.map((s) => {
    const cell = studentTotals.get(s.id) ?? emptyCell();
    const mastered = words.filter(
      (w) => (progMap.get(`${s.id}|${w.wordId}`)?.practice_count ?? 0) >= MASTERY_COUNT
    ).length;
    const quizScores = (quizSessions ?? [])
      .filter((q) => q.student_id === s.id && q.total_questions > 0)
      .map((q) => ({ correct: q.correct_answers, total: q.total_questions }));
    return { studentId: s.id, name: s.full_name, username: s.username, cell, mastered, quizScores };
  }).sort((a, b) => a.name.localeCompare(b.name));

  // ---------- statistical findings ----------
  const findings: Finding[] = [];
  const askedWords = words.filter((w) => w.total.asked >= 3);

  // 1) Teacher's easy/hard vs measured difficulty (Welch t-test on first-try rates)
  {
    const easy = askedWords.filter((w) => w.difficulty === "easy")
      .map((w) => rate(w.total.firstTry, w.total.asked) * 100).filter(isFinite);
    const hard = askedWords.filter((w) => w.difficulty === "hard")
      .map((w) => rate(w.total.firstTry, w.total.asked) * 100).filter(isFinite);
    const t = welchT(easy, hard);
    findings.push({
      icon: "🏷️",
      title: "Teacher difficulty labels vs real student performance",
      stat: t.valid
        ? `Easy words: ${fmt(t.m1)}% first-try (SD ${fmt(t.sd1)}, n=${t.n1}) · Hard words: ${fmt(t.m2)}% (SD ${fmt(t.sd2)}, n=${t.n2}) · Welch t(${fmt(t.df)}) = ${fmt(t.t, 2)}, ${fmtP(t.p)}`
        : "Needs at least 3 easy and 3 hard words with 3+ questions each.",
      interpretation: t.valid
        ? t.significant
          ? (t.m1 > t.m2
            ? "The teacher's labels are validated: students really do perform significantly better on 'easy' words."
            : "Surprising: students perform significantly better on 'hard' words — the labels may need review.")
          : "No significant difference yet between easy and hard words — labels not confirmed by the data so far."
        : "",
      hasData: t.valid,
    });
  }

  // 2) Does practice predict quiz performance? (Pearson r per student)
  {
    const pts = studentAnalyses.filter((s) => s.cell.practiceAsked >= 3 && s.cell.quizAsked >= 3);
    const x = pts.map((s) => s.cell.practiceAsked);
    const y = pts.map((s) => rate(s.cell.quizCorrect, s.cell.quizAsked) * 100);
    const c = pearson(x, y);
    findings.push({
      icon: "📈",
      title: "Does more practice lead to better quiz scores?",
      stat: c.valid
        ? `Pearson r = ${fmt(c.r, 2)} (n = ${c.n} students), t(${c.df}) = ${fmt(c.t, 2)}, ${fmtP(c.p)}`
        : "Needs at least 4 students with both practice and quiz activity.",
      interpretation: c.valid
        ? c.significant
          ? (c.r > 0
            ? "Yes — students who practice more score significantly higher on quizzes. Strong evidence the AI practice is working."
            : "Unexpected negative relationship — students may be practicing hardest on words they struggle with.")
          : "No significant relationship yet — more data needed."
        : "",
      hasData: c.valid,
    });
  }

  // 3) Practice accuracy vs quiz accuracy (paired t-test, same students)
  {
    const both = studentAnalyses.filter((s) => s.cell.practiceAsked >= 3 && s.cell.quizAsked >= 3);
    const pAcc = both.map((s) => rate(s.cell.practiceCorrect, s.cell.practiceAsked) * 100);
    const qAcc = both.map((s) => rate(s.cell.quizCorrect, s.cell.quizAsked) * 100);
    const t = pairedT(pAcc, qAcc);
    findings.push({
      icon: "⚖️",
      title: "Practice mode vs quiz mode accuracy (same students)",
      stat: t.valid
        ? `Practice: ${fmt(t.m1)}% · Quiz: ${fmt(t.m2)}% · paired t(${t.df}) = ${fmt(t.t, 2)}, ${fmtP(t.p)} (n = ${t.n1})`
        : "Needs at least 3 students active in both modes.",
      interpretation: t.valid
        ? t.significant
          ? (t.m1 > t.m2
            ? "Students do significantly better in practice (with hints and support) than in quizzes — the scaffolding is helping."
            : "Students score significantly higher in quizzes than practice — practice questions may be harder, which is by design.")
          : "Practice and quiz accuracy are similar — skills transfer well from supported practice to independent testing."
        : "",
      hasData: t.valid,
    });
  }

  // 4) Quiz improvement over time (first vs latest quiz, paired)
  {
    const withTwo = studentAnalyses.filter((s) => s.quizScores.length >= 2);
    const first = withTwo.map((s) => (s.quizScores[0].correct / s.quizScores[0].total) * 100);
    const last = withTwo.map((s) => {
      const q = s.quizScores[s.quizScores.length - 1];
      return (q.correct / q.total) * 100;
    });
    const t = pairedT(last, first);
    findings.push({
      icon: "🚀",
      title: "Are quiz scores improving over time?",
      stat: t.valid
        ? `First quiz: ${fmt(t.m2)}% · Latest quiz: ${fmt(t.m1)}% · paired t(${t.df}) = ${fmt(t.t, 2)}, ${fmtP(t.p)} (n = ${t.n1})`
        : "Needs at least 3 students with 2+ completed quizzes.",
      interpretation: t.valid
        ? t.significant
          ? (t.m1 > t.m2
            ? "Significant improvement from first to latest quiz — clear evidence of learning with the AI tool."
            : "Scores significantly dropped — check whether later quizzes covered harder units.")
          : "No significant change yet between first and latest quizzes."
        : "",
      hasData: t.valid,
    });
  }

  // 5) Do hints relate to word difficulty? (hints per question vs first-try rate)
  {
    const pts = askedWords.filter((w) => w.total.asked >= 4);
    const x = pts.map((w) => w.total.hints / w.total.asked);
    const y = pts.map((w) => rate(w.total.firstTry, w.total.asked) * 100);
    const c = pearson(x, y);
    findings.push({
      icon: "💡",
      title: "Hint usage as a difficulty signal",
      stat: c.valid
        ? `Pearson r = ${fmt(c.r, 2)} between hints-per-question and first-try rate (n = ${c.n} words), ${fmtP(c.p)}`
        : "Needs at least 4 words with 4+ questions each.",
      interpretation: c.valid
        ? c.significant && c.r < 0
          ? "Confirmed: words where students tap more hints are also the words they get wrong more — hint data is a valid difficulty measure for your research."
          : "Hint usage doesn't significantly track difficulty yet."
        : "",
      hasData: c.valid,
    });
  }

  // ---------- overview ----------
  const active = studentAnalyses.filter((s) => s.cell.asked > 0);
  const totAnswered = studentAnalyses.reduce((a, s) => a + s.cell.asked, 0);
  const totCorrect = studentAnalyses.reduce((a, s) => a + s.cell.correct, 0);
  const totFirst = studentAnalyses.reduce((a, s) => a + s.cell.firstTry, 0);
  const totHints = studentAnalyses.reduce((a, s) => a + s.cell.hints, 0);

  return {
    classId, className, needsMigration, words, students: studentAnalyses, findings,
    overview: {
      activeStudents: active.length, totalStudents: students.length,
      totalAnswered: totAnswered,
      accuracy: rate(totCorrect, totAnswered) * 100,
      firstTryRate: rate(totFirst, totAnswered) * 100,
      totalHints: totHints,
    },
  };
}

// Class-level descriptive stats line (mean/SD/median of student accuracy)
export function studentAccuracyDescriptives(students: StudentAnalysis[]) {
  const accs = students
    .filter((s) => s.cell.asked >= 3)
    .map((s) => rate(s.cell.correct, s.cell.asked) * 100);
  if (accs.length === 0) return null;
  return {
    n: accs.length,
    mean: mean(accs),
    sd: sd(accs),
    min: Math.min(...accs),
    max: Math.max(...accs),
  };
}
