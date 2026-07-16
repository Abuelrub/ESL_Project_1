import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteStudentGlobal, resetPassword } from "@/lib/actions/admin";

export const dynamic = "force-dynamic";

export default async function AdminStudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string }>;
}) {
  await requireProfile("admin");
  const { msg } = await searchParams;
  const admin = createAdminClient();

  const [{ data: students }, { data: enrollments }] = await Promise.all([
    admin.from("profiles")
      .select("id, username, full_name, created_at")
      .eq("role", "student")
      .order("full_name"),
    admin.from("enrollments").select("student_id, classes(name)"),
  ]);

  const classMap = new Map<string, string[]>();
  for (const e of enrollments ?? []) {
    const cls = Array.isArray(e.classes) ? e.classes[0] : e.classes;
    if (!cls) continue;
    if (!classMap.has(e.student_id)) classMap.set(e.student_id, []);
    classMap.get(e.student_id)!.push((cls as { name: string }).name);
  }

  return (
    <main className="mx-auto max-w-2xl p-4 pb-16">
      <header className="mb-6">
        <Link href="/admin" className="text-sm text-brand-600">&larr; Back to dashboard</Link>
        <h1 className="mt-1 text-xl font-bold">🧑‍🎓 All students ({students?.length ?? 0})</h1>
        <p className="text-sm text-gray-500">
          Every student in the system. To add students, open a class and paste a roster.
        </p>
      </header>

      {msg && (
        <p className="mb-4 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-700">{msg}</p>
      )}

      {students && students.length > 0 ? (
        <div className="grid gap-2.5">
          {students.map((s) => {
            const classes = classMap.get(s.id) ?? [];
            return (
              <div key={s.id} className="rounded-2xl border border-gray-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-bold">{s.full_name}</p>
                    <p className="text-sm text-gray-500">
                      ID: {s.username} ·{" "}
                      {classes.length > 0 ? (
                        <span>🏫 {classes.join(", ")}</span>
                      ) : (
                        <span className="text-amber-600">⚠️ Not enrolled in any class</span>
                      )}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <form action={resetPassword} className="flex gap-2">
                      <input type="hidden" name="user_id" value={s.id} />
                      <input type="hidden" name="back" value="/admin/students" />
                      <input name="password" type="text" placeholder="New password" minLength={6} required
                        className="w-32 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                      <button className="rounded-lg border border-gray-300 px-3 py-2 text-sm">Reset</button>
                    </form>
                    <details>
                      <summary className="cursor-pointer select-none list-none rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600 [&::-webkit-details-marker]:hidden">
                        Delete
                      </summary>
                      <form action={deleteStudentGlobal} className="mt-1">
                        <input type="hidden" name="student_id" value={s.id} />
                        <button className="rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white">
                          ⚠️ Confirm — deletes account &amp; all data
                        </button>
                      </form>
                    </details>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-200 bg-white p-6">
          <p className="text-gray-600">
            No students yet. Open a class and use &quot;Add students (bulk)&quot; to create them.
          </p>
        </div>
      )}
    </main>
  );
}
