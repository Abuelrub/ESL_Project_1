import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import AssignForm from "@/components/AssignForm";
import { approveTest } from "@/lib/actions/tests";

export const dynamic = "force-dynamic";

export default async function AssignPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ msg?: string }>;
}) {
  const profile = await requireProfile("teacher");
  const { id } = await params;
  const { msg } = await searchParams;
  const supabase = await createClient();
  const admin    = createAdminClient();

  const { data: test } = await supabase
    .from("tests")
    .select("id, name, test_type, status, course_id, show_results, open_at, close_at")
    .eq("id", id).single();
  if (!test) notFound();

  // Get students in this course's class
  const { data: course } = await admin
    .from("courses").select("class_id").eq("id", test.course_id).single();

  const { data: enrollments } = course
    ? await admin
        .from("enrollments")
        .select("student:profiles!enrollments_student_id_fkey(id, username, full_name)")
        .eq("class_id", course.class_id)
    : { data: [] };

  const students = (enrollments ?? [])
    .map(e => Array.isArray(e.student) ? e.student[0] : e.student)
    .filter(Boolean) as { id: string; username: string; full_name: string }[];

  const { data: existing } = await admin
    .from("test_assignments").select("student_id").eq("test_id", id);
  const alreadyAssigned = new Set((existing ?? []).map(a => a.student_id));

  // Save schedule if posted (server action)
  async function saveSchedule(formData: FormData) {
    "use server";
    const s = await createClient();
    const openAt  = String(formData.get("open_at")  || "").trim() || null;
    const closeAt = String(formData.get("close_at") || "").trim() || null;
    await s.from("tests").update({ open_at: openAt, close_at: closeAt }).eq("id", id);
  }

  return (
    <main className="mx-auto max-w-2xl p-4 pb-16">
      <header className="mb-5">
        <Link href={`/teacher/tests/${id}/design`} className="text-sm text-brand-600">
          ← Design
        </Link>
        <h1 className="mt-1 text-xl font-bold">Assign: {test.name}</h1>
        <p className="text-sm text-gray-500 capitalize">{test.test_type}</p>
      </header>

      {msg && (
        <p className="mb-4 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-700">{msg}</p>
      )}

      {/* ── Visibility schedule ── */}
      <section className="mb-5 rounded-2xl border border-gray-200 bg-white p-5">
        <h2 className="mb-1 font-semibold">⏰ When can students take this test?</h2>
        <p className="mb-3 text-sm text-gray-500">
          Leave blank to make it available immediately when you activate it.
          Students will only see the test between these dates.
        </p>
        <form action={saveSchedule} className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-gray-600">
                Opens on (date &amp; time)
              </label>
              <input type="datetime-local" name="open_at"
                defaultValue={test.open_at
                  ? new Date(test.open_at).toISOString().slice(0, 16) : ""}
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-brand-500"/>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-gray-600">
                Closes on (date &amp; time)
              </label>
              <input type="datetime-local" name="close_at"
                defaultValue={test.close_at
                  ? new Date(test.close_at).toISOString().slice(0, 16) : ""}
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-brand-500"/>
            </div>
          </div>
          <div className="rounded-xl bg-gray-50 p-3 text-xs text-gray-600 space-y-1">
            <p>
              <b>Results visibility:</b>{" "}
              {test.show_results === "immediate"
                ? "Students see their score immediately after submitting."
                : "You control when each student sees their results (from the Results page)."}
            </p>
            <p>
              <b>Tip:</b> For a pre-test, set close_at to the first week of class.
              For a post-test, set open_at to the last week.
            </p>
          </div>
          <button className="rounded-xl bg-gray-700 px-4 py-2.5 text-sm font-semibold text-white active:scale-[0.98]">
            Save schedule
          </button>
        </form>
      </section>

      {/* ── Student selection ── */}
      {students.length > 0 ? (
        <AssignForm
          testId={id}
          students={students.map(s => ({
            ...s,
            assigned: alreadyAssigned.has(s.id),
          }))}
        />
      ) : (
        <div className="rounded-2xl border border-gray-200 bg-white p-6">
          <p className="text-gray-600">No students enrolled in this course yet.</p>
        </div>
      )}

      <div className="mt-4">
        <Link href={`/teacher/tests/${id}/results`}
          className="text-sm text-brand-600 underline-offset-2 hover:underline">
          → View results page
        </Link>
      </div>
    </main>
  );
}
