"use client";

import { useState } from "react";

export default function DeleteWordButton({
  wordId,
  wordText,
  courseId,
}: {
  wordId: string;
  wordText: string;
  courseId: string;
}) {
  const [state, setState] = useState<"idle" | "checking" | "confirm" | "deleting">("idle");
  const [studentCount, setStudentCount] = useState(0);

  async function handleClick() {
    setState("checking");
    try {
      const res = await fetch(`/api/words/usage?word_id=${wordId}`);
      const data = await res.json();
      setStudentCount(data.count ?? 0);
      setState("confirm");
    } catch {
      setState("confirm"); // show confirm anyway
    }
  }

  async function confirmDelete() {
    setState("deleting");
    const form = new FormData();
    form.append("word_id", wordId);
    form.append("course_id", courseId);
    const { deleteWord } = await import("@/lib/actions/teacher");
    await deleteWord(form);
  }

  if (state === "idle") {
    return (
      <button
        onClick={handleClick}
        className="px-1 text-gray-400 hover:text-red-600"
        title="Delete word">
        ✕
      </button>
    );
  }

  if (state === "checking") {
    return (
      <span className="px-1 text-xs text-gray-400">...</span>
    );
  }

  if (state === "confirm") {
    return (
      <span className="inline-flex items-center gap-1">
        {studentCount > 0 ? (
          <span className="rounded-lg bg-red-50 border border-red-200 px-2 py-1 text-xs text-red-700">
            ⚠️ {studentCount} student{studentCount > 1 ? "s" : ""} practiced &quot;{wordText}&quot;.
            Deleting removes their progress permanently.
          </span>
        ) : null}
        <button
          onClick={confirmDelete}
          disabled={state === "deleting"}
          className="rounded-lg bg-red-500 px-2 py-1 text-xs font-bold text-white">
          {state === "deleting" ? "..." : "Delete"}
        </button>
        <button
          onClick={() => setState("idle")}
          className="rounded-lg border border-gray-300 px-2 py-1 text-xs text-gray-600">
          Cancel
        </button>
      </span>
    );
  }

  return <span className="px-1 text-xs text-gray-400">Deleting...</span>;
}
