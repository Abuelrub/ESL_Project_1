import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const { question_id } = await request.json();
  const admin = createAdminClient();

  const { data: q } = await admin
    .from("questions").select("id, student_id, hints_used").eq("id", question_id).single();
  if (!q || q.student_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await admin.from("questions")
    .update({ hints_used: (q.hints_used ?? 0) + 1 }).eq("id", q.id);

  return NextResponse.json({ ok: true });
}
