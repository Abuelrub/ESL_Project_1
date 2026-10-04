// @ts-nocheck
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

function csvRow(cells) {
  return cells.map((c) => {
    const s = c === null || c === undefined ? "" : String(c);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",");
}

export async function GET(request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Not logged in", { status: 401 });

  const url    = new URL(request.url);
  const unitId = url.searchParams.get("unit") ?? "";
  const mode   = url.searchParams.get("mode") === "writing" ? "writing" : "practice";
  const admin  = createAdminClient();

  // Step 1: get unit + its course_id
  const { data: unit } = await admin
    .from("units").select("id, name, course_id").eq("id", unitId).single();
  if (!unit) return new NextResponse("Unit not found", { status: 404 });

  // Step 2: get course + class_id
  const { data: course } = await admin
    .from("courses").select("id, name, class_id").eq("id", unit.course_id).single();
  if (!course) return new NextResponse("Course not found", { status: 404 });

  // Step 3: verify teacher owns this class
  const { data: cls } = await admin
    .from("classes").select("teacher_id, name").eq("id", course.class_id).single();
  if (!cls || cls.teacher_id !== user.id)
    return new NextResponse("Not allowed", { status: 403 });

  // Step 4: get words
  const { data: words } = await admin
    .from("words").select("id, text, difficulty, part")
    .eq("unit_id", unitId).order("created_at");
  const wordList = words ?? [];

  // Step 5: get enrolled students
  const { data: enrollments } = await admin
    .from("enrollments")
    .select("student:profiles!enrollments_student_id_fkey(id, full_name, username)")
    .eq("class_id", course.class_id);
  const students = (enrollments ?? [])
    .map((e) => (Array.isArray(e.student) ? e.student[0] : e.student))
    .filter(Boolean).sort((a, b) => a.full_name.localeCompare(b.full_name));

  const studentIds = students.map((s) => s.id);
  const wordIds    = wordList.map((w) => w.id);
  const lines = [];

  if (mode === "practice") {
    const { data: progress } = await admin
      .from("word_progress").select("student_id, word_id, practice_count, correct_count, current_level")
      .in("student_id", studentIds).in("word_id", wordIds);
    const { data: quizRows } = await admin
      .from("questions").select("student_id, word_id, is_correct, practice_sessions!inner(mode)")
      .in("student_id", studentIds).in("word_id", wordIds).not("answered_at", "is", null);

    const statsMap = new Map();
    for (const p of progress ?? []) {
      statsMap.set(`${p.student_id}|${p.word_id}`, {
        practice_count: p.practice_count ?? 0, correct_count: p.correct_count ?? 0,
        current_level: p.current_level ?? 1, quiz_count: 0, quiz_correct: 0,
      });
    }
    for (const q of quizRows ?? []) {
      const ps = Array.isArray(q.practice_sessions) ? q.practice_sessions[0] : q.practice_sessions;
      if (ps?.mode !== "quiz") continue;
      const key = `${q.student_id}|${q.word_id}`;
      const s = statsMap.get(key) ?? { practice_count:0, correct_count:0, current_level:1, quiz_count:0, quiz_correct:0 };
      s.quiz_count++; if (q.is_correct) s.quiz_correct++;
      statsMap.set(key, s);
    }

    lines.push(csvRow(["Student_ID","Student_Name",
      ...wordList.map((w) => `${w.text} [P${w.part??1}] practices`),
      ...wordList.map((w) => `${w.text} level`),
      ...wordList.map((w) => `${w.text} quiz`),
      "Words_Touched","Words_Mastered"]));

    for (const st of students) {
      const g = (wid) => statsMap.get(`${st.id}|${wid}`);
      lines.push(csvRow([st.username, st.full_name,
        ...wordList.map((w) => g(w.id)?.practice_count ?? 0),
        ...wordList.map((w) => g(w.id)?.current_level ?? "—"),
        ...wordList.map((w) => { const v=g(w.id); return v?.quiz_count ? `${v.quiz_correct}/${v.quiz_count}` : "—"; }),
        wordList.filter((w) => (g(w.id)?.practice_count ?? 0) > 0).length,
        wordList.filter((w) => (g(w.id)?.practice_count ?? 0) >= 8).length,
      ]));
    }

    return new NextResponse(lines.join("\n"), { headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="practice_${unit.name.replace(/\s+/g,"_")}.csv"`,
    }});

  } else {
    const { data: writingRows } = await admin
      .from("writing_sentences")
      .select("student_id, word_id, sentence, is_correct, grammar_score, usage_score, naturalness_score, created_at")
      .in("student_id", studentIds).in("word_id", wordIds).order("created_at");

    const wMap = new Map();
    for (const r of writingRows ?? []) {
      const key = `${r.student_id}|${r.word_id}`;
      const s = wMap.get(key) ?? { total:0, correct:0, g:0, u:0, n:0 };
      const newTotal = s.total + 1;
      s.g = ((s.g * s.total) + (r.grammar_score ?? 0)) / newTotal;
      s.u = ((s.u * s.total) + (r.usage_score ?? 0)) / newTotal;
      s.n = ((s.n * s.total) + (r.naturalness_score ?? 0)) / newTotal;
      s.total = newTotal;
      if (r.is_correct) s.correct++;
      wMap.set(key, s);
    }

    lines.push(csvRow(["Student_ID","Student_Name",
      ...wordList.map((w) => `${w.text} correct`),
      ...wordList.map((w) => `${w.text} attempts`),
      ...wordList.map((w) => `${w.text} grammar%`),
      ...wordList.map((w) => `${w.text} usage%`),
      ...wordList.map((w) => `${w.text} natural%`),
      ...wordList.map((w) => `${w.text} evaluated`),
      "Words_Started","Words_Evaluated"]));

    for (const st of students) {
      const g = (wid) => wMap.get(`${st.id}|${wid}`);
      lines.push(csvRow([st.username, st.full_name,
        ...wordList.map((w) => g(w.id)?.correct ?? 0),
        ...wordList.map((w) => g(w.id)?.total ?? 0),
        ...wordList.map((w) => { const v=g(w.id); return v ? Math.round(v.g*100) : "—"; }),
        ...wordList.map((w) => { const v=g(w.id); return v ? Math.round(v.u*100) : "—"; }),
        ...wordList.map((w) => { const v=g(w.id); return v ? Math.round(v.n*100) : "—"; }),
        ...wordList.map((w) => (g(w.id)?.correct??0) >= 3 ? "Yes" : "No"),
        wordList.filter((w) => (g(w.id)?.total??0) > 0).length,
        wordList.filter((w) => (g(w.id)?.correct??0) >= 3).length,
      ]));
    }

    lines.push("","--- FULL SENTENCE DETAIL ---");
    lines.push(csvRow(["Student_ID","Student_Name","Word","Part","Difficulty","Sentence","Is_Correct","Grammar%","Usage%","Natural%","Date"]));
    const wordMap = new Map(wordList.map((w) => [w.id, w]));
    const stuMap  = new Map(students.map((s) => [s.id, s]));
    for (const r of writingRows ?? []) {
      const w=wordMap.get(r.word_id), st=stuMap.get(r.student_id);
      if (!w||!st) continue;
      lines.push(csvRow([st.username, st.full_name, w.text, w.part??1, w.difficulty,
        r.sentence, r.is_correct,
        r.grammar_score!=null ? Math.round(r.grammar_score*100) : "",
        r.usage_score!=null ? Math.round(r.usage_score*100) : "",
        r.naturalness_score!=null ? Math.round(r.naturalness_score*100) : "",
        r.created_at?.slice(0,10) ?? ""]));
    }

    return new NextResponse(lines.join("\n"), { headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="writing_${unit.name.replace(/\s+/g,"_")}.csv"`,
    }});
  }
}
