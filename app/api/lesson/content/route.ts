import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateLessonContent } from "@/lib/ai";

export const maxDuration = 30;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const { session_id, word_id } = await request.json();
  const admin = createAdminClient();

  const { data: session } = await admin
    .from("practice_sessions").select("id, student_id").eq("id", session_id).single();
  if (!session || session.student_id !== user.id) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const { data: word } = await admin
    .from("words").select("id, text").eq("id", word_id).single();
  if (!word) return NextResponse.json({ error: "Word not found" }, { status: 404 });

  let content;
  try {
    content = await generateLessonContent(word.text);
  } catch {
    return NextResponse.json({ error: "AI could not create the lesson, try again" }, { status: 502 });
  }

  // Record the teaching content for research (what the AI taught, when)
  await admin.from("questions").insert({
    session_id,
    student_id: user.id,
    word_id: word.id,
    question_type: "lesson_content",
    difficulty_level: 1,
    question_data: content as unknown as Record<string, unknown>,
    answered_at: new Date().toISOString(),
  });

  return NextResponse.json({ content });
}
