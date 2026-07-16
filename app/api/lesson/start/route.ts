import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const { unit_id, word_id } = await request.json();
  if (!unit_id || !word_id) return NextResponse.json({ error: "Missing data" }, { status: 400 });

  // RLS check: the student can only see units in their class
  const { data: unit } = await supabase
    .from("units").select("id, course_id, order_index").eq("id", unit_id).single();
  if (!unit) return NextResponse.json({ error: "Unit not found" }, { status: 404 });

  const admin = createAdminClient();

  // TEACHER ASSIGNMENT GATE
  const { data: courseInfo } = await admin
    .from("courses").select("active_unit_id, active_part").eq("id", unit.course_id).single();
  if (courseInfo?.active_unit_id) {
    const { data: activeUnit } = await admin
      .from("units").select("id, order_index").eq("id", courseInfo.active_unit_id).single();
    if (activeUnit && unit.order_index > activeUnit.order_index) {
      return NextResponse.json({ error: "This unit is not assigned yet" }, { status: 403 });
    }
    if (activeUnit && unit.id === activeUnit.id) {
      const { data: wordCheck } = await admin
        .from("words").select("part").eq("id", word_id).single();
      if (((wordCheck?.part ?? 1)) > (courseInfo.active_part ?? 1)) {
        return NextResponse.json({ error: "This word is in Part 2 — not assigned yet" }, { status: 403 });
      }
    }
  }

  const [{ data: session, error }, { data: word }, { data: prog }] = await Promise.all([
    admin.from("practice_sessions")
      .insert({ student_id: user.id, unit_id: unit.id, course_id: unit.course_id, mode: "practice" })
      .select("id").single(),
    admin.from("words").select("id, text, difficulty").eq("id", word_id).single(),
    admin.from("word_progress")
      .select("practice_count, correct_count, current_level")
      .eq("student_id", user.id).eq("word_id", word_id).maybeSingle(),
  ]);

  if (error || !session || !word) {
    const detail = error?.message ?? "unknown";
    const help = detail.includes("mode")
      ? " — please run migration_practice_mode.sql in Supabase SQL Editor"
      : "";
    return NextResponse.json(
      { error: `Could not start lesson (${detail})${help}` },
      { status: 500 }
    );
  }

  const practiceCount = prog?.practice_count ?? 0;

  return NextResponse.json({
    session_id: session.id,
    word: word.text,
    practice_count: practiceCount,
    short_lesson: practiceCount >= 6,        // skip teach steps on later visits
    sentence_required: practiceCount >= 6,   // sentence step required from 3rd visit
  });
}
