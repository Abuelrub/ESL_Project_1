import { notFound, redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import TestClient from "@/components/TestClient";

export const dynamic = "force-dynamic";

export default async function StudentTestPage({
  params,
}: { params: Promise<{id:string}> }) {
  const profile = await requireProfile("student");
  const { id } = await params;
  const supabase = await createClient();
  const admin    = createAdminClient();

  const { data: assignment } = await supabase
    .from("test_assignments")
    .select("id,student_id,started_at,completed_at,test_id,tests(id,name,instructions,status)")
    .eq("id", id).eq("student_id", profile.id).single();

  if (!assignment) notFound();
  const test = Array.isArray(assignment.tests) ? assignment.tests[0] : assignment.tests;
  if (!test || test.status==="draft") notFound();
  if (assignment.completed_at) redirect(`/student/tests/${id}/results`);

  // Mark started if first time
  if (!assignment.started_at) {
    await admin.from("test_assignments")
      .update({ started_at: new Date().toISOString() }).eq("id", id);
  }

  const { data: questions } = await admin
    .from("test_questions")
    .select("id,question_type,difficulty,question_data,word_id,words(text)")
    .eq("test_id", test.id).order("order_index");

  // Strip correct answers before sending to client
  const clientQuestions = (questions??[]).map(q => {
    const d = { ...(q.question_data as Record<string,unknown>) };

    // For matching: convert pairs array into separate words/definitions arrays
    // and Fisher-Yates shuffle the definitions so they don't match by position
    if (q.question_type === "matching" && Array.isArray(d.pairs)) {
      const pairs = d.pairs as { word: string; definition: string }[];
      const words = pairs.map(p => p.word);
      // Shuffle definitions
      const defs = pairs.map(p => p.definition);
      for (let i = defs.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [defs[i], defs[j]] = [defs[j], defs[i]];
      }
      d.words = words;
      d.definitions = defs;
    }

    delete d.correct_index; delete d.correct_answer;
    delete d.correct_word; delete d.correct_indices;
    delete d.explanation; delete d.def_map; delete d.pairs;
    return { id:q.id, type:q.question_type, difficulty:q.difficulty,
             word:(Array.isArray(q.words)?q.words[0]:q.words as {text?:string}|null)?.text??"",
             data:d };
  });

  return (
    <TestClient
      assignmentId={assignment.id}
      testName={(test as {name?:string}).name ?? "Test"}
      questions={clientQuestions}
      studentName={profile.full_name}
    />
  );
}
