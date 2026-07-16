import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const { unit_id } = await request.json();
  if (!unit_id) return NextResponse.json({ error: "Missing unit" }, { status: 400 });

  // Verify the student can access this unit (RLS enforces enrollment)
  const { data: unit } = await supabase
    .from("units")
    .select("id, course_id")
    .eq("id", unit_id)
    .single();
  if (!unit) return NextResponse.json({ error: "Unit not found" }, { status: 404 });

  const admin = createAdminClient();
  const { data: session, error } = await admin
    .from("practice_sessions")
    .insert({ student_id: user.id, unit_id: unit.id, course_id: unit.course_id })
    .select("id")
    .single();

  if (error || !session) {
    return NextResponse.json({ error: "Could not start session" }, { status: 500 });
  }
  return NextResponse.json({ session_id: session.id });
}
