import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { bulkAddStudents, createCourse, deleteClass, deleteStudent, resetPassword, unenrollStudent } from "@/lib/actions/admin";

export const dynamic = "force-dynamic";

export default async function ClassDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ msg?: string }>;
}) {
  await requireProfile("admin");
  const { id } = await params;
  const { msg } = await searchParams;
  const admin = createAdminClient();

  const { data: cls } = await admin
    .from("classes")
    .select("id, name, teacher:profiles!classes_teacher_id_fkey(full_name)")
    .eq("id", id)
    .single();

  if (!cls) notFound();
  const teacher = Array.isArray(cls.teacher) ? cls.teacher[0] : cls.teacher;

  const [{ data: students }, { data: courses }] = await Promise.all([
    admin
      .from("enrollments")
      .select("student:profiles!enrollments_student_id_fkey(id, username, full_name)")
      .eq("class_id", id),
    admin.from("courses").select("id, name, units!units_course_id_fkey(count)").eq("class_id", id).order("created_at"),
  ]);

  const studentList = (students ?? [])
    .map((row) => (Array.isArray(row.student) ? row.student[0] : row.student))
    .filter(Boolean)
    .sort((a, b) => (a!.full_name > b!.full_name ? 1 : -1));

  return (
    <main className="mx-auto max-w-2xl p-4">
      <header className="mb-6 flex items-start justify-between gap-2">
        <div>
          <Link href="/admin/classes" className="text-sm text-brand-600">&larr; All classes</Link>
          <h1 className="mt-1 text-xl font-bold">{cls.name}</h1>
          <p className="text-sm text-gray-500">Teacher: {teacher?.full_name ?? "—"}</p>
        </div>
        <details>
          <summary className="cursor-pointer select-none list-none rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600 [&::-webkit-details-marker]:hidden">
            Delete class
          </summary>
          <form action={deleteClass} className="mt-1">
            <input type="hidden" name="class_id" value={cls.id} />
            <button className="rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white">
              ⚠️ Confirm — deletes all words &amp; data
            </button>
          </form>
        </details>
      </header>

      {msg && (
        <p className="mb-4 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-700">{msg}</p>
      )}

      <section className="mb-6 rounded-2xl border border-gray-200 bg-white p-5">
        <h2 className="mb-1 font-semibold">Add students (bulk)</h2>
        <p className="mb-3 text-sm text-gray-500">
          One student per line: <span className="font-mono">ID, Name</span> — existing students are just enrolled.
        </p>
        <form action={bulkAddStudents} className="grid gap-3">
          <input type="hidden" name="class_id" value={cls.id} />
          <textarea name="roster" rows={6} required
            placeholder={"M00657654, Huda\nM00652623, Raquel\nM00674429, Bala"}
            className="rounded-xl border border-gray-300 px-4 py-3 font-mono text-sm outline-none focus:border-brand-500" />
          <input name="password" type="text" required minLength={6}
            placeholder="Starting password for these students (6+ characters)"
            className="rounded-xl border border-gray-300 px-4 py-3 text-base outline-none focus:border-brand-500" />
          <button className="rounded-xl bg-brand-500 py-3 font-semibold text-white active:scale-[0.98]">
            Add students
          </button>
        </form>
      </section>

      <section className="mb-6 rounded-2xl border border-gray-200 bg-white p-5">
        <h2 className="mb-3 font-semibold">Students ({studentList.length})</h2>
        {studentList.length > 0 ? (
          <ul className="divide-y divide-gray-100">
            {studentList.map((s) => (
              <li key={s!.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <p className="font-medium">{s!.full_name}</p>
                  <p className="text-sm text-gray-500">ID: {s!.username}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <form action={resetPassword} className="flex gap-2">
                    <input type="hidden" name="user_id" value={s!.id} />
                    <input type="hidden" name="back" value={`/admin/classes/${cls.id}`} />
                    <input name="password" type="text" placeholder="New password" minLength={6} required
                      className="w-32 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                    <button className="rounded-lg border border-gray-300 px-3 py-2 text-sm">Reset</button>
                  </form>
                  <details>
                    <summary className="cursor-pointer select-none list-none rounded-lg border border-red-200 px-2.5 py-2 text-sm text-red-600 [&::-webkit-details-marker]:hidden">
                      ✕
                    </summary>
                    <div className="mt-1 flex gap-1.5">
                      <form action={unenrollStudent}>
                        <input type="hidden" name="class_id" value={cls.id} />
                        <input type="hidden" name="student_id" value={s!.id} />
                        <button className="rounded-lg border border-red-300 px-2.5 py-1.5 text-xs font-semibold text-red-600">
                          Remove from class
                        </button>
                      </form>
                      <form action={deleteStudent}>
                        <input type="hidden" name="class_id" value={cls.id} />
                        <input type="hidden" name="student_id" value={s!.id} />
                        <button className="rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-semibold text-white">
                          ⚠️ Delete account
                        </button>
                      </form>
                    </div>
                  </details>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-500">No students enrolled yet. Paste a roster above.</p>
        )}
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <h2 className="mb-3 font-semibold">Courses ({courses?.length ?? 0})</h2>
        <form action={createCourse} className="mb-4 flex gap-2">
          <input type="hidden" name="class_id" value={cls.id} />
          <input name="name" placeholder="Course name (e.g. Vocabulary Level 2)" required
            className="flex-1 rounded-xl border border-gray-300 px-4 py-3 text-base outline-none focus:border-brand-500" />
          <button className="rounded-xl bg-brand-500 px-4 font-semibold text-white active:scale-[0.98]">
            Add
          </button>
        </form>
        {courses && courses.length > 0 ? (
          <ul className="divide-y divide-gray-100">
            {courses.map((c) => {
              const unitCount = (c.units as { count: number }[] | null)?.[0]?.count ?? 0;
              return (
                <li key={c.id} className="py-3">
                  <p className="font-medium">{c.name}</p>
                  <p className="text-sm text-gray-500">
                    {unitCount} unit(s) — the teacher adds units and words in their dashboard
                  </p>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-gray-500">No courses yet.</p>
        )}
      </section>
    </main>
  );
}
