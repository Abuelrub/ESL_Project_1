import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ items: [] });

  // Use admin to bypass RLS so results_visible is always accurate
  const admin = createAdminClient();

  const { data } = await admin
    .from("test_assignments")
    .select("id, completed_at, score_raw, score_total, results_visible, tests(id, name, test_type, status, open_at, close_at)")
    .eq("student_id", user.id);

  const now = new Date();
  const items = (data ?? [])
    .filter((a) => {
      const t = Array.isArray(a.tests) ? a.tests[0] : a.tests as {
        status?: string; open_at?: string | null; close_at?: string | null;
      } | null;
      return t && t.status === "active";
    })
    .map((a) => {
      const t = Array.isArray(a.tests) ? a.tests[0] : a.tests as {
        name?: string; test_type?: string; open_at?: string | null; close_at?: string | null;
      } | null;

      const openAt  = t?.open_at  ? new Date(t.open_at)  : null;
      const closeAt = t?.close_at ? new Date(t.close_at) : null;

      // Completed + results released → show results card
      if (a.completed_at && a.results_visible) {
        return {
          id: a.id,
          test_name: t?.name ?? "Test",
          test_type: t?.test_type ?? "custom",
          status: "results_ready" as const,
          score_pct: a.score_total
            ? Math.round(((a.score_raw ?? 0) / a.score_total) * 100) : null,
        };
      }

      // Not completed + within open window → show start card
      if (!a.completed_at) {
        if (openAt  && now < openAt)  return null;  // not open yet
        if (closeAt && now > closeAt) return null;  // closed
        return {
          id: a.id,
          test_name: t?.name ?? "Test",
          test_type: t?.test_type ?? "custom",
          status: "pending" as const,
        };
      }

      return null; // completed but results not released yet — don't show
    })
    .filter(Boolean);

  return NextResponse.json({ items });
}
