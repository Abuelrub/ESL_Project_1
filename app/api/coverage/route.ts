import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Per-word all-time quiz coverage for a unit (how many times each word was quizzed).
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const unitId = new URL(request.url).searchParams.get("unit");
  if (!unitId) return NextResponse.json({ error: "Missing unit" }, { status: 400 });

  const admin = createAdminClient();
  const { data: words } = await admin
    .from("words").select("id, text").eq("unit_id", unitId);
  if (!words) return NextResponse.json({ words: [] });

  // Count only QUIZ-mode questions (research needs quiz-mode exposure, not practice)
  const { data: rows } = await admin
    .from("questions")
    .select("word_id, practice_sessions!inner(mode)")
    .eq("student_id", user.id)
    .in("word_id", words.map((w) => w.id))
    .eq("practice_sessions.mode", "quiz")
    .not("answered_at", "is", null);

  const counts = new Map<string, number>();
  for (const r of rows ?? []) counts.set(r.word_id, (counts.get(r.word_id) ?? 0) + 1);

  const result = words.map((w) => ({
    id: w.id, text: w.text, quizzed: counts.get(w.id) ?? 0,
  }));
  const covered = result.filter((r) => r.quizzed > 0).length;
  return NextResponse.json({ words: result, covered, total: result.length });
}
