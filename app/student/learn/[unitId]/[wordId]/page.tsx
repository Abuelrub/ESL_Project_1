import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import LessonClient from "@/components/LessonClient";

export const dynamic = "force-dynamic";

export default async function LessonPage({
  params,
}: {
  params: Promise<{ unitId: string; wordId: string }>;
}) {
  await requireProfile("student");
  const { unitId, wordId } = await params;
  const supabase = await createClient();

  const [{ data: unit }, { data: word }] = await Promise.all([
    supabase.from("units").select("id, name").eq("id", unitId).single(),
    supabase.from("words").select("id, text").eq("id", wordId).single(),
  ]);
  if (!unit || !word) notFound();

  return <LessonClient unitId={unit.id} unitName={unit.name} wordId={word.id} wordText={word.text} />;
}
