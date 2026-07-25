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

  // Try the cache first — same lesson content is reused across students (big speed win)
  const { data: cached } = await admin
    .from("word_content").select("content").eq("word_id", word.id).maybeSingle();

  let content;
  if (cached?.content) {
    content = cached.content;
  } else {
    try {
      content = await generateLessonContent(word.text);
    } catch {
      return NextResponse.json({ error: "AI could not create the lesson, try again" }, { status: 502 });
    }
    // Save for next student (fire-and-forget)
    admin.from("word_content").upsert({ word_id: word.id, content }).then(() => {});
  }

  // Record that this student was taught (research signal)
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
