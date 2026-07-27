import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const { unit_id, word_ids } = await request.json() as {
    unit_id: string; word_ids: string[];
  };

  if (!word_ids?.length || word_ids.length < 2) {
    return NextResponse.json({ error: "Select at least 2 words" }, { status: 400 });
  }

  const admin = createAdminClient();

  const [{ data: words }, { data: profile }] = await Promise.all([
    admin.from("words").select("id, text").in("id", word_ids),
    admin.from("profiles").select("full_name").eq("id", user.id).single(),
  ]);

  if (!words?.length) {
    return NextResponse.json({ error: "Words not found" }, { status: 404 });
  }

  // Create one writing session per word (all linked to this multi-word attempt)
  const sessions = await Promise.all(
    words.map((w) =>
      admin.from("writing_sessions")
        .insert({ student_id: user.id, word_id: w.id, unit_id })
        .select("id").single()
    )
  );

  const sessionIds = sessions
    .map((s) => s.data?.id)
    .filter(Boolean) as string[];

  const firstName = (profile?.full_name ?? "").split(" ")[0];
  const wordTexts = words.map((w) => w.text);

  return NextResponse.json({
    session_ids: sessionIds,
    words: wordTexts,
    word_ids: words.map((w) => w.id),
    student_name: firstName,
  });
}
