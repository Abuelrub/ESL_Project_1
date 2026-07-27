import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const { unit_id, word_id } = await request.json();
  const admin = createAdminClient();

  const [{ data: word }, { data: prog }, { data: profile }] = await Promise.all([
    admin.from("words").select("id, text, difficulty").eq("id", word_id).single(),
    admin.from("word_progress")
      .select("writing_attempts, writing_correct, writing_score")
      .eq("student_id", user.id).eq("word_id", word_id).maybeSingle(),
    admin.from("profiles").select("full_name").eq("id", user.id).single(),
  ]);

  if (!word) return NextResponse.json({ error: "Word not found" }, { status: 404 });

  // Count all-time correct writing sentences for this word
  const { count: allTimeCorrect } = await admin
    .from("writing_sentences")
    .select("*", { count: "exact", head: true })
    .eq("student_id", user.id).eq("word_id", word_id).eq("is_correct", true);

  // Start a new writing session
  const { data: session, error } = await admin
    .from("writing_sessions")
    .insert({ student_id: user.id, word_id: word.id, unit_id })
    .select("id").single();

  if (error || !session) {
    return NextResponse.json(
      { error: `Could not start session: ${error?.message}` },
      { status: 500 }
    );
  }

  const firstName = (profile?.full_name ?? "").split(" ")[0];

  return NextResponse.json({
    session_id: session.id,
    word: word.text,
    student_name: firstName,
    all_time_correct: allTimeCorrect ?? 0,
    writing_score: prog?.writing_score ?? null,
    is_evaluated: (allTimeCorrect ?? 0) >= 3,
  });
}
