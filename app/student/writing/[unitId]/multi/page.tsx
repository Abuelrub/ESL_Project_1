import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import MultiWritingChatbot from "@/components/MultiWritingChatbot";

export const dynamic = "force-dynamic";

export default async function MultiWritingPage({
  params, searchParams,
}: {
  params: Promise<{ unitId: string }>;
  searchParams: Promise<{ words?: string }>;
}) {
  await requireProfile("student");
  const { unitId } = await params;
  const { words: wordsParam } = await searchParams;

  const supabase = await createClient();
  const { data: unit } = await supabase
    .from("units").select("id, name").eq("id", unitId).single();
  if (!unit) notFound();

  const wordIds = (wordsParam ?? "").split(",").filter(Boolean);
  if (wordIds.length < 2) notFound();

  return (
    <MultiWritingChatbot
      unitId={unit.id}
      unitName={unit.name}
      wordIds={wordIds}
    />
  );
}
