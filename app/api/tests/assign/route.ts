import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const { test_id, student_ids } = await request.json() as {
    test_id: string; student_ids: string[];
  };

  if (!student_ids?.length) {
    return NextResponse.json({ error: "Select at least one student." }, { status: 400 });
  }

  const admin = createAdminClient();

  // Verify teacher owns this test
  const { data: test } = await supabase
    .from("tests").select("teacher_id").eq("id", test_id).single();
  if (!test || test.teacher_id !== user.id) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  // Set test to active
  await admin.from("tests").update({ status: "active" }).eq("id", test_id);

  // Upsert assignments — one row per student
  const rows = student_ids.map(sid => ({
    test_id, student_id: sid, results_visible: false,
  }));
  const { error } = await admin
    .from("test_assignments")
    .upsert(rows, { onConflict: "test_id,student_id" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, assigned: student_ids.length });
}
