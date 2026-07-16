import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const profile = await requireProfile("admin");
  const admin = createAdminClient();

  const [{ count: teachers }, { count: students }, { count: classes }, { count: questions }] =
    await Promise.all([
      admin.from("profiles").select("*", { count: "exact", head: true }).eq("role", "teacher"),
      admin.from("profiles").select("*", { count: "exact", head: true }).eq("role", "student"),
      admin.from("classes").select("*", { count: "exact", head: true }),
      admin.from("questions").select("*", { count: "exact", head: true }),
    ]);

  const stats = [
    { label: "Teachers", value: teachers ?? 0 },
    { label: "Students", value: students ?? 0 },
    { label: "Classes", value: classes ?? 0 },
    { label: "Questions asked", value: questions ?? 0 },
  ];

  return (
    <main className="mx-auto max-w-2xl p-4">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Admin dashboard</h1>
          <p className="text-sm text-gray-500">Welcome, {profile.full_name}</p>
        </div>
        <form action="/logout" method="post">
          <button className="rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-medium">
            Log out
          </button>
        </form>
      </header>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-2xl border border-gray-200 bg-white p-4">
            <p className="text-2xl font-bold">{s.value}</p>
            <p className="text-sm text-gray-500">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Link
          href="/admin/teachers"
          className="rounded-2xl border border-gray-200 bg-white p-5 transition hover:border-brand-500"
        >
          <p className="text-lg font-semibold">👩‍🏫 Teachers</p>
          <p className="text-sm text-gray-500">Create and manage teacher accounts</p>
        </Link>
        <Link
          href="/admin/classes"
          className="rounded-2xl border border-gray-200 bg-white p-5 transition hover:border-brand-500"
        >
          <p className="text-lg font-semibold">🏫 Classes</p>
          <p className="text-sm text-gray-500">Classes, student rosters, and courses</p>
        </Link>
        <Link
          href="/admin/students"
          className="rounded-2xl border border-gray-200 bg-white p-5 transition hover:border-brand-500"
        >
          <p className="text-lg font-semibold">🧑‍🎓 Students</p>
          <p className="text-sm text-gray-500">All students — reset passwords, delete accounts</p>
        </Link>
      </div>
    </main>
  );
}
