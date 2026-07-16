import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createTeacher, deleteTeacher, resetPassword } from "@/lib/actions/admin";

export const dynamic = "force-dynamic";

export default async function TeachersPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string }>;
}) {
  await requireProfile("admin");
  const { msg } = await searchParams;
  const admin = createAdminClient();

  const { data: teachers } = await admin
    .from("profiles")
    .select("id, username, full_name, created_at")
    .eq("role", "teacher")
    .order("created_at");

  return (
    <main className="mx-auto max-w-2xl p-4">
      <header className="mb-6">
        <Link href="/admin" className="text-sm text-brand-600">&larr; Back to dashboard</Link>
        <h1 className="mt-1 text-xl font-bold">Teachers</h1>
      </header>

      {msg && (
        <p className="mb-4 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-700">{msg}</p>
      )}

      <section className="mb-6 rounded-2xl border border-gray-200 bg-white p-5">
        <h2 className="mb-3 font-semibold">Create a teacher</h2>
        <form action={createTeacher} className="grid gap-3">
          <input name="username" placeholder="Username (e.g. teacher1)" required
            autoCapitalize="none" autoCorrect="off"
            className="rounded-xl border border-gray-300 px-4 py-3 text-base outline-none focus:border-brand-500" />
          <input name="full_name" placeholder="Full name (e.g. Sarah Johnson)" required
            className="rounded-xl border border-gray-300 px-4 py-3 text-base outline-none focus:border-brand-500" />
          <input name="password" type="text" placeholder="Password (6+ characters)" required minLength={6}
            className="rounded-xl border border-gray-300 px-4 py-3 text-base outline-none focus:border-brand-500" />
          <button className="rounded-xl bg-brand-500 py-3 font-semibold text-white active:scale-[0.98]">
            Create teacher
          </button>
        </form>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <h2 className="mb-3 font-semibold">All teachers ({teachers?.length ?? 0})</h2>
        {teachers && teachers.length > 0 ? (
          <ul className="divide-y divide-gray-100">
            {teachers.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <p className="font-medium">{t.full_name}</p>
                  <p className="text-sm text-gray-500">Username: {t.username}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <form action={resetPassword} className="flex gap-2">
                    <input type="hidden" name="user_id" value={t.id} />
                    <input type="hidden" name="back" value="/admin/teachers" />
                    <input name="password" type="text" placeholder="New password" minLength={6} required
                      className="w-36 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                    <button className="rounded-lg border border-gray-300 px-3 py-2 text-sm">Reset</button>
                  </form>
                  <details className="relative">
                    <summary className="cursor-pointer select-none list-none rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600 [&::-webkit-details-marker]:hidden">
                      Delete
                    </summary>
                    <form action={deleteTeacher} className="mt-1">
                      <input type="hidden" name="user_id" value={t.id} />
                      <button className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white">
                        ⚠️ Confirm delete
                      </button>
                    </form>
                  </details>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-500">No teachers yet. Create the first one above.</p>
        )}
      </section>
    </main>
  );
}
