import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeClassAnalytics, ratePct } from "@/lib/analytics";
import { fmt } from "@/lib/stats";
import { MASTERY_COUNT } from "@/lib/adaptive";

// CSV exports for research:
//   /api/reports/students?class=ID   — per-student summary
//   /api/reports/words?class=ID      — per-word analysis
//   /api/reports/questions?class=ID  — every question (the raw research dataset)

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(rows: unknown[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\n");
}
function pct(part: number, whole: number) {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "";
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ type: string }> }
) {
  const { type } = await params;
  const url = new URL(request.url);
  const classId = url.searchParams.get("class");
  if (!classId) return NextResponse.json({ error: "Missing class" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  // Verify the caller is this class's teacher (or an admin)
  const { data: profile } = await supabase
    .from("profiles").select("role").eq("id", user.id).single();
  const admin = createAdminClient();
  const { data: cls } = await admin
    .from("classes").select("id, name, teacher_id").eq("id", classId).single();
  if (!cls) return NextResponse.json({ error: "Class not found" }, { status: 404 });
  if (profile?.role !== "admin" && cls.teacher_id !== user.id) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  const { data: enrollments } = await admin
    .from("enrollments")
    .select("student:profiles!enrollments_student_id_fkey(id, username, full_name)")
    .eq("class_id", classId);
  const students = (enrollments ?? [])
    .map((e) => (Array.isArray(e.student) ? e.student[0] : e.student))
    .filter(Boolean) as { id: string; username: string; full_name: string }[];
  const studentMap = new Map(students.map((s) => [s.id, s]));
  const studentIds = students.map((s) => s.id);

  let rows: unknown[][] = [];
  let filename = "report.csv";

  if (type === "students") {
    // Uses the RLS-aware RPC via the caller's own session
    const { data: stats } = await supabase.rpc("class_student_stats", { p_class_id: classId });
    rows = [[
      "Student_ID", "Student_Name", "Practice_Sessions", "Quiz_Sessions",
      "Questions_Answered", "Correct", "Accuracy", "First_Try_Correct",
      "First_Try_Rate", "Hints_Used", "Total_Attempts",
    ]];
    for (const st of stats ?? []) {
      const s = studentMap.get(st.student_id);
      if (!s) continue;
      rows.push([
        s.username, s.full_name, st.practice_sessions, st.quiz_sessions,
        st.total_questions, st.correct_answers,
        pct(Number(st.correct_answers), Number(st.total_questions)),
        st.first_try_correct,
        pct(Number(st.first_try_correct), Number(st.total_questions)),
        st.total_hints, st.total_attempts,
      ]);
    }
    filename = `students_${cls.name.replace(/\W+/g, "_")}.csv`;

  } else if (type === "words") {
    const { data: stats } = await supabase.rpc("class_word_stats", { p_class_id: classId });
    rows = [[
      "Word", "Teacher_Difficulty", "Unit", "Times_Asked", "Correct",
      "Accuracy", "First_Try_Correct", "First_Try_Rate",
      "Hints_Used", "Avg_Attempts", "Students_Mastered",
    ]];
    for (const w of stats ?? []) {
      rows.push([
        w.word_text, w.difficulty, w.unit_name, w.times_asked, w.correct_count,
        pct(Number(w.correct_count), Number(w.times_asked)),
        w.first_try_count,
        pct(Number(w.first_try_count), Number(w.times_asked)),
        w.total_hints, w.avg_attempts, w.students_mastered,
      ]);
    }
    filename = `words_${cls.name.replace(/\W+/g, "_")}.csv`;

  } else if (type === "questions") {
    // Raw research dataset — every question ever asked to this class
    const { data: questions } = await admin
      .from("questions")
      .select("student_id, question_type, difficulty_level, is_correct, attempts, hints_used, student_answer, ai_feedback, created_at, answered_at, question_data, words(text), practice_sessions(mode)")
      .in("student_id", studentIds.length > 0 ? studentIds : ["00000000-0000-0000-0000-000000000000"])
      .order("created_at")
      .limit(50000);

    rows = [[
      "Student_ID", "Student_Name", "Word", "Mode", "Question_Type",
      "Difficulty_Level", "Is_Correct", "Attempts", "Hints_Used",
      "Student_Answer", "AI_Feedback", "Created_At", "Answered_At", "Question_JSON",
    ]];
    for (const q of questions ?? []) {
      const s = studentMap.get(q.student_id);
      const word = Array.isArray(q.words) ? q.words[0] : q.words;
      const session = Array.isArray(q.practice_sessions)
        ? q.practice_sessions[0] : q.practice_sessions;
      rows.push([
        s?.username ?? q.student_id, s?.full_name ?? "",
        word?.text ?? "", session?.mode ?? "",
        q.question_type, q.difficulty_level,
        q.is_correct === null ? "" : q.is_correct,
        q.attempts, q.hints_used,
        q.student_answer ?? "", q.ai_feedback ?? "",
        q.created_at, q.answered_at ?? "",
        JSON.stringify(q.question_data),
      ]);
    }
    filename = `questions_${cls.name.replace(/\W+/g, "_")}.csv`;

  } else if (type === "matrix") {
    // COMPUTED RESULTS: one row per word per student
    const a = await computeClassAnalytics(supabase, classId, cls.name);
    rows = [[
      "Word", "Teacher_Difficulty", "Unit", "Student_ID", "Student_Name",
      "Questions", "Correct", "Accuracy", "First_Try", "First_Try_Rate",
      "Hints", "Attempts", "Current_Level", "Practice_Count", "Mastered",
    ]];
    for (const w of a.words) {
      for (const ps of w.perStudent) {
        rows.push([
          w.text, w.difficulty, w.unit, ps.username, ps.name,
          ps.cell.asked, ps.cell.correct, ratePct(ps.cell.correct, ps.cell.asked),
          ps.cell.firstTry, ratePct(ps.cell.firstTry, ps.cell.asked),
          ps.cell.hints, ps.cell.attempts, ps.level, ps.practiceCount,
          ps.practiceCount >= MASTERY_COUNT ? "YES" : "no",
        ]);
      }
    }
    filename = `matrix_${cls.name.replace(/\W+/g, "_")}.csv`;

  } else if (type === "analysis") {
    // COMPUTED RESULTS: the full statistical report
    const a = await computeClassAnalytics(supabase, classId, cls.name);
    rows = [
      ["ESL AI TUTOR - CLASS ANALYSIS REPORT"],
      ["Class", cls.name],
      ["Generated", new Date().toISOString()],
      [],
      ["OVERVIEW"],
      ["Active students", `${a.overview.activeStudents}/${a.overview.totalStudents}`],
      ["Questions answered", a.overview.totalAnswered],
      ["Class accuracy", isFinite(a.overview.accuracy) ? `${fmt(a.overview.accuracy)}%` : "n/a"],
      ["First-try rate", isFinite(a.overview.firstTryRate) ? `${fmt(a.overview.firstTryRate)}%` : "n/a"],
      ["Total hints used", a.overview.totalHints],
      [],
      ["STATISTICAL FINDINGS"],
      ["Test", "Statistics", "Interpretation"],
    ];
    for (const f of a.findings) {
      rows.push([f.title, f.stat, f.interpretation]);
    }
    rows.push([], ["WORD-BY-WORD EVALUATION (hardest first)"]);
    rows.push([
      "Word", "Teacher_Difficulty", "Unit", "Questions", "Accuracy",
      "First_Try_Rate", "Hints", "Quiz_Accuracy", "Students_Mastered",
    ]);
    for (const w of a.words.filter((w) => w.total.asked > 0)) {
      rows.push([
        w.text, w.difficulty, w.unit, w.total.asked,
        ratePct(w.total.correct, w.total.asked),
        ratePct(w.total.firstTry, w.total.asked),
        w.total.hints,
        ratePct(w.total.quizCorrect, w.total.quizAsked),
        w.mastered,
      ]);
    }
    rows.push([], ["PER-STUDENT SUMMARY"]);
    rows.push([
      "Student_ID", "Student_Name", "Questions", "Accuracy", "First_Try_Rate",
      "Practice_Qs", "Quiz_Qs", "Quiz_Accuracy", "Hints", "Words_Mastered", "Quiz_Scores_Timeline",
    ]);
    for (const s2 of a.students) {
      rows.push([
        s2.username, s2.name, s2.cell.asked,
        ratePct(s2.cell.correct, s2.cell.asked),
        ratePct(s2.cell.firstTry, s2.cell.asked),
        s2.cell.practiceAsked, s2.cell.quizAsked,
        ratePct(s2.cell.quizCorrect, s2.cell.quizAsked),
        s2.cell.hints, s2.mastered,
        s2.quizScores.map((q) => `${q.correct}/${q.total}`).join(" -> "),
      ]);
    }
    filename = `analysis_${cls.name.replace(/\W+/g, "_")}.csv`;

  } else {
    return NextResponse.json({ error: "Unknown report type" }, { status: 400 });
  }

  return new NextResponse(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
