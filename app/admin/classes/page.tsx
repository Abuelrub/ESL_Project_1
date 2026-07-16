import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClass } from "@/lib/actions/admin";

export const dynamic = "force-dynamic";

export default async function ClassesPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string }>;
}) {
  await requireProfile("admin");
  const { msg } = await searchParams;
  const admin = createAdminClient();

  const [{ data: classes }, { data: teachers }] = await Promise.all([
    admin
      .from("classes")
      .select("id, name, created_at, teacher:profiles!classes_teacher_id_fkey(full_name), enrollments(count)")
      .order("created_at"),
    admin.from("profiles").select("id, full_name").eq("role", "teacher").order("full_name"),
  ]);

  return (
    <main className="mx-auto max-w-2xl p-4">
      <header className="mb-6">
        <Link href="/admin" className="text-sm text-brand-600">&larr; Back to dashboard</Link>
        <h1 className="mt-1 text-xl font-bold">Classes</h1>
      </header>

      {msg && (
        <p className="mb-4 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-700">{msg}</p>
      )}

      <section className="mb-6 rounded-2xl border border-gray-200 bg-white p-5">
        <h2 className="mb-3 font-semibold">Create a class</h2>
        {teachers && teachers.length > 0 ? (
          <form action={createClass} className="grid gap-3">
            <input name="name" placeholder="Class name (e.g. ESL Class A)" required
              className="rounded-xl border border-gray-300 px-4 py-3 text-base outline-none focus:border-brand-500" />
            <select name="teacher_id" required defaultValue=""
              className="rounded-xl border border-gray-300 bg-white px-4 py-3 text-base outline-none focus:border-brand-500">
              <option value="" disabled>Choose a teacher…</option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>{t.full_name}</option>
              ))}
            </select>
            <button className="rounded-xl bg-brand-500 py-3 font-semibold text-white active:scale-[0.98]">
              Create class
            </button>
          </form>
        ) : (
          <p className="text-sm text-gray-500">
            Create a <Link href="/admin/teachers" className="text-brand-600 underline">teacher</Link> first,
            then come back to create a class.
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <h2 className="mb-3 font-semibold">All classes ({classes?.length ?? 0})</h2>
        {classes && classes.length > 0 ? (
          <ul className="divide-y divide-gray-100">
            {classes.map((c) => {
              const teacher = Array.isArray(c.teacher) ? c.teacher[0] : c.teacher;
              const count = (c.enrollments as { count: number }[] | null)?.[0]?.count ?? 0;
              return (
                <li key={c.id}>
                  <Link href={`/admin/classes/${c.id}`}
                    className="flex items-center justify-between py-3 transition hover:opacity-70">
                    <div>
                      <p className="font-medium">{c.name}</p>
                      <p className="text-sm text-gray-500">
                        Teacher: {teacher?.full_name ?? "—"} · {count} student(s)
                      </p>
                    </div>
                    <span className="text-gray-400">&rarr;</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-gray-500">No classes yet.</p>
        )}
      </section>
    </main>
  );
}
