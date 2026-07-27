"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Student { id: string; username: string; full_name: string; assigned: boolean; }

export default function AssignForm({
  testId, students,
}: { testId: string; students: Student[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(
    new Set(students.filter(s => s.assigned).map(s => s.id))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(students.map(s => s.id)) : new Set());
  }

  async function submit() {
    if (selected.size === 0) { setError("Select at least one student."); return; }
    setSaving(true); setError(""); setSuccess("");
    try {
      const res = await fetch("/api/tests/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test_id: testId, student_ids: [...selected] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setSuccess(`✅ Test is now active for ${data.assigned} student(s). Students can see it on their tests page.`);
      router.refresh();
    } catch(e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    }
    setSaving(false);
  }

  const allChecked = selected.size === students.length && students.length > 0;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold">Select students</h2>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-brand-600">
          <input type="checkbox" checked={allChecked}
            onChange={e => toggleAll(e.target.checked)} />
          Select all
        </label>
      </div>

      <div className="mb-4 grid gap-2">
        {students.map(s => (
          <label key={s.id}
            className="flex cursor-pointer items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 hover:bg-gray-50">
            <input type="checkbox" checked={selected.has(s.id)}
              onChange={e => {
                const next = new Set(selected);
                e.target.checked ? next.add(s.id) : next.delete(s.id);
                setSelected(next);
              }} />
            <div>
              <p className="font-medium">{s.full_name}</p>
              <p className="text-sm text-gray-500">
                {s.username}{s.assigned && " · ✓ already assigned"}
              </p>
            </div>
          </label>
        ))}
      </div>

      {error && (
        <p className="mb-3 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</p>
      )}
      {success && (
        <p className="mb-3 rounded-xl bg-green-50 px-4 py-2.5 text-sm text-green-700">{success}</p>
      )}

      <button onClick={submit} disabled={saving || selected.size === 0}
        className="w-full rounded-xl bg-green-600 py-3.5 font-semibold text-white active:scale-[0.98] disabled:opacity-50">
        {saving
          ? "Activating…"
          : `🚀 Activate & assign to ${selected.size} student(s)`}
      </button>
    </div>
  );
}
