import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

function csvRow(cells: unknown[]) {
  return cells.map((c) => {
    const s = c === null || c === undefined ? "" : String(c);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",");
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Not logged in", { status: 401 });

  const type = new URL(request.url).searchParams.get("type") ?? "writing";
  const admin = createAdminClient();

  const { data: classes } = await supabase
    .from("classes")
    .select("id, name, enrollments(student:profiles!enrollments_student_id_fkey(id, username, full_name))")
    .eq("teacher_id", user.id);

  const allStudents = (classes ?? []).flatMap((cls) =>
    (cls.enrollments ?? [])
      .map((e) => {
        const s = Array.isArray(e.student) ? e.student[0] : e.student;
        return s ? { ...(s as { id: string; username: string; full_name: string }), className: cls.name } : null;
      }).filter(Boolean)
  ) as { id: string; username: string; full_name: string; className: string }[];

  const studentIds = allStudents.map((s) => s.id);
  if (studentIds.length === 0) return new NextResponse("No students", { status: 404 });

  const sMap = new Map(allStudents.map((s) => [s.id, s]));
  const lines: string[] = [];

  if (type === "writing") {
    lines.push(csvRow([
      "Student_ID","Student_Name","Class","Word","Session_Date","Turn",
      "Sentence","Is_Correct","Grammar_Score","Usage_Score","Naturalness_Score",
      "AI_Feedback","Grammar_Correction","Improved_Sentence",
    ]));
    const { data: rows } = await admin
      .from("writing_sentences")
      .select("student_id, word_id, sentence, is_correct, grammar_score, usage_score, naturalness_score, ai_feedback, grammar_correction, improved_sentence, turn_number, created_at, words(text), writing_sessions!inner(started_at)")
      .in("student_id", studentIds).order("created_at");
    for (const r of rows ?? []) {
      const s = sMap.get(r.student_id);
      const w = Array.isArray(r.words) ? r.words[0] : r.words;
      const sess = Array.isArray(r.writing_sessions) ? r.writing_sessions[0] : r.writing_sessions;
      lines.push(csvRow([
        s?.username, s?.full_name, s?.className,
        (w as { text?: string } | null)?.text,
        (sess as { started_at?: string } | null)?.started_at?.slice(0, 10),
        r.turn_number, r.sentence, r.is_correct,
        r.grammar_score, r.usage_score, r.naturalness_score,
        r.ai_feedback, r.grammar_correction, r.improved_sentence,
      ]));
    }
    return new NextResponse(lines.join("\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="writing_evaluation.csv"',
      },
    });
  }

  if (type === "quiz") {
    lines.push(csvRow([
      "Student_ID","Student_Name","Class","Word","Mode","Question_Type",
      "Difficulty_Level","Is_Correct","Attempts","Hints_Used",
      "Student_Answer","AI_Feedback","Date",
    ]));
    const { data: rows } = await admin
      .from("questions")
      .select("student_id, word_id, question_type, difficulty_level, is_correct, attempts, hints_used, student_answer, ai_feedback, answered_at, words(text), practice_sessions!inner(mode)")
      .in("student_id", studentIds)
      .neq("question_type", "lesson_content")
      .not("answered_at", "is", null).order("answered_at");
    for (const r of rows ?? []) {
      const s = sMap.get(r.student_id);
      const w = Array.isArray(r.words) ? r.words[0] : r.words;
      const ps = Array.isArray(r.practice_sessions) ? r.practice_sessions[0] : r.practice_sessions;
      lines.push(csvRow([
        s?.username, s?.full_name, s?.className,
        (w as { text?: string } | null)?.text,
        (ps as { mode?: string } | null)?.mode,
        r.question_type, r.difficulty_level, r.is_correct,
        r.attempts, r.hints_used, r.student_answer,
        r.ai_feedback, r.answered_at?.slice(0, 10),
      ]));
    }
    return new NextResponse(lines.join("\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="quiz_practice_evaluation.csv"',
      },
    });
  }

  return new NextResponse("Unknown type", { status: 400 });
}
