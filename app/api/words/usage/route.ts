import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ count: 0 });

  const wordId = new URL(request.url).searchParams.get("word_id") ?? "";
  const admin  = createAdminClient();

  const { count } = await admin
    .from("word_progress")
    .select("*", { count: "exact", head: true })
    .eq("word_id", wordId)
    .gt("practice_count", 0);

  return NextResponse.json({ count: count ?? 0 });
}
