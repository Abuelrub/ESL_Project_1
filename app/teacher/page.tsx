import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createTeacherCourse } from "@/lib/actions/teacher";

export const dynamic = "force-dynamic";

export default async function TeacherHome({
  searchParams,
}: {
  searchParams?: Promise<{ msg?: string }>;
}) {
  const profile = await requireProfile("teacher");
  const supabase = await createClient();
  const { msg } = (await searchParams) ?? {};

  const { data: classes, error: classesErr } = await supabase
    .from("classes")
    .select("id, name, enrollments(count), courses(id, name, units!units_course_id_fkey(id, words(count)))")
    .eq("teacher_id", profile.id)
    .order("created_at");

  const totalStudents = (classes ?? []).reduce(
    (sum, c) => sum + ((c.enrollments as { count: number }[] | null)?.[0]?.count ?? 0), 0);
  const allUnits = (classes ?? []).flatMap((c) => c.courses ?? []).flatMap((co) => co.units ?? []);
  const totalWords = allUnits.reduce(
    (sum, u) => sum + ((u.words as { count: number }[] | null)?.[0]?.count ?? 0), 0);

  const stats = [
    {
      label: "Students", value: totalStudents, icon: "🧑‍🎓",
      card: "bg-gradient-to-br from-indigo-50 to-indigo-100 border-indigo-200",
      number: "text-indigo-700", text: "text-indigo-600",
    },
    {
      label: "Units", value: allUnits.length, icon: "📖",
      card: "bg-gradient-to-br from-amber-50 to-amber-100 border-amber-200",
      number: "text-amber-700", text: "text-amber-600",
    },
    {
      label: "Words", value: totalWords, icon: "✏️",
      card: "bg-gradient-to-br from-emerald-50 to-emerald-100 border-emerald-200",
      number: "text-emerald-700", text: "text-emerald-600",
    },
  ];

  return (
    <main className="mx-auto max-w-2xl p-4 pb-16">
      <header className="mb-5 rounded-3xl bg-gradient-to-r from-indigo-500 via-purple-500 to-purple-600 p-6 text-white shadow-lg shadow-purple-200">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm text-indigo-100">Welcome back,</p>
            <h1 className="text-2xl font-extrabold tracking-tight">{profile.full_name} 👋</h1>
            <p className="mt-1 text-sm text-indigo-100">Teacher dashboard</p>
          </div>
          <form action="/logout" method="post">
            <button className="rounded-xl bg-white/20 px-4 py-2 text-sm font-semibold backdrop-blur transition hover:bg-white/30">
              Log out
            </button>
          </form>
        </div>
      </header>

      {msg && (
        <p className="mb-4 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-700">{msg}</p>
      )}

      {classesErr && (
        <div className="mb-4 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
          <p className="font-bold text-amber-800">⚠️ Could not load your classes</p>
          <p className="mt-1 font-mono text-xs text-amber-700">
            {JSON.stringify({ message: classesErr.message, details: classesErr.details, hint: classesErr.hint })}
          </p>
        </div>
      )}

      <div className="mb-5 grid grid-cols-3 gap-3">
        {stats.map((s) => (
          <div key={s.label}
            className={`rounded-2xl border p-4 text-center shadow-sm ${s.card}`}>
            <p className="text-2xl">{s.icon}</p>
            <p className={`mt-1 text-3xl font-extrabold sm:text-4xl ${s.number}`}>{s.value}</p>
            <p className={`text-sm font-medium ${s.text}`}>{s.label}</p>
          </div>
        ))}
      </div>

      <Link href="/teacher/analytics"
        className="mb-3 flex items-center justify-between rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition hover:border-brand-500 hover:shadow">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-xl">🔬</span>
          <div>
            <p className="text-lg font-bold">Class analytics</p>
            <p className="text-sm text-gray-500">Statistical analysis &amp; word-by-word evaluation</p>
          </div>
        </div>
        <span className="text-gray-400">&rarr;</span>
      </Link>

      <Link href="/teacher/students"
        className="mb-5 flex items-center justify-between rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition hover:border-brand-500 hover:shadow">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-xl">📊</span>
          <div>
            <p className="text-lg font-bold">Students &amp; reports</p>
            <p className="text-sm text-gray-500">Progress, practice counts, and accuracy</p>
          </div>
        </div>
        <span className="text-gray-400">&rarr;</span>
      </Link>

      <Link href="/teacher/evaluation"
        className="mb-3 flex items-center justify-between rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition hover:border-brand-500 hover:shadow">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-rose-50 text-xl">📋</span>
          <div>
            <p className="text-lg font-bold">Full evaluation</p>
            <p className="text-sm text-gray-500">Per student · per word · quiz + practice + writing</p>
          </div>
        </div>
        <span className="text-gray-400">→</span>
      </Link>
      
      <Link href="/teacher/tests"
        className="mb-3 flex items-center justify-between rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition hover:border-brand-500 hover:shadow">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-rose-50 text-xl">📋</span>
          <div>
            <p className="text-lg font-bold">Tests</p>
            <p className="text-sm text-gray-500">Pre-test, post-test, custom assessments</p>
          </div>
        </div>
        <span className="text-gray-400">→</span>
      </Link>

      {classes && classes.length > 0 ? (
        classes.map((cls) => {
          const studentCount = (cls.enrollments as { count: number }[] | null)?.[0]?.count ?? 0;
          return (
            <section key={cls.id} className="mb-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-purple-50 text-xl">🏫</span>
                <div>
                  <h2 className="text-lg font-bold">{cls.name}</h2>
                  <p className="text-sm text-gray-500">{studentCount} student(s)</p>
                </div>
              </div>
              {cls.courses && cls.courses.length > 0 ? (
                <div className="grid gap-2">
                  {cls.courses.map((course) => {
                    const wordCount = (course.units ?? []).reduce(
                      (sum, u) => sum + ((u.words as { count: number }[] | null)?.[0]?.count ?? 0), 0);
                    return (
                      <Link key={course.id} href={`/teacher/courses/${course.id}`}
                        className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50 px-4 py-3.5 transition hover:border-brand-200 hover:bg-brand-50">
                        <div>
                          <p className="font-semibold">📚 {course.name}</p>
                          <p className="text-sm text-gray-500">
                            {course.units?.length ?? 0} unit(s) · {wordCount} word(s)
                          </p>
                        </div>
                        <span className="text-sm font-semibold text-brand-600">Manage words &rarr;</span>
                      </Link>
                    );
                  })}
                </div>
              ) : (
                <p className="mb-2 text-sm text-gray-500">
                  No courses yet — create your first course below 👇
                </p>
              )}
              <form action={createTeacherCourse} className="mt-3 flex gap-2">
                <input type="hidden" name="class_id" value={cls.id} />
                <input name="name" placeholder="New course name (e.g. Vocabulary)" required
                  className="flex-1 rounded-xl border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-brand-500" />
                <button className="rounded-xl bg-brand-500 px-4 text-sm font-semibold text-white active:scale-[0.98]">
                  + Course
                </button>
              </form>
            </section>
          );
        })
      ) : (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <p className="text-gray-600">
            You don&apos;t have a class yet. Ask the admin to create one and assign you as the teacher.
          </p>
        </div>
      )}
    </main>
  );
}
