import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import PracticeClient from "@/components/PracticeClient";

export const dynamic = "force-dynamic";

export default async function PracticePage({
  params,
}: {
  params: Promise<{ unitId: string }>;
}) {
  await requireProfile("student");
  const { unitId } = await params;
  const supabase = await createClient();

  // RLS ensures the student can only load units from their own class
  const { data: unit } = await supabase
    .from("units")
    .select("id, name")
    .eq("id", unitId)
    .single();

  if (!unit) notFound();

  return <PracticeClient unitId={unit.id} unitName={unit.name} />;
}
