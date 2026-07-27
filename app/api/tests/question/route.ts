// Save an edited question OR add a manual one
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const body = await request.json();
  const { test_id, question_id, question_type, difficulty, question_data, word_id } = body;
  const admin = createAdminClient();

  // Verify teacher owns this test
  const { data: test } = await supabase
    .from("tests").select("id, teacher_id").eq("id", test_id).single();
  if (!test || test.teacher_id !== user.id) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  if (question_id) {
    // UPDATE existing question
    const { error } = await admin.from("test_questions").update({
      question_type, difficulty, question_data,
      word_id: word_id || null, teacher_edited: true,
    }).eq("id", question_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, action: "updated" });
  } else {
    // INSERT new manual question — put it at the end
    const { count } = await admin.from("test_questions")
      .select("*", { count: "exact", head: true }).eq("test_id", test_id);
    const { data, error } = await admin.from("test_questions").insert({
      test_id, question_type, difficulty, question_data,
      word_id: word_id || null,
      order_index: count ?? 0, teacher_edited: true,
    }).select("id").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, action: "inserted", id: data.id });
  }
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const { question_id, test_id } = await request.json();
  const admin = createAdminClient();

  const { data: test } = await supabase
    .from("tests").select("teacher_id").eq("id", test_id).single();
  if (!test || test.teacher_id !== user.id) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  await admin.from("test_questions").delete().eq("id", question_id);
  return NextResponse.json({ ok: true });
}
