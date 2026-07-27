"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Word {
  id: string; text: string; difficulty: string;
  correct?: number; attempted?: number;
}

export default function WritingWordPicker({
  unitId, words,
}: { unitId: string; words: Word[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 5) next.add(id);
      return next;
    });
  }

  function start() {
    if (selected.size === 0) return;
    const ids = [...selected];
    if (ids.length === 1) {
      router.push(`/student/writing/${unitId}/${ids[0]}`);
    } else {
      router.push(`/student/writing/${unitId}/multi?words=${ids.join(",")}`);
    }
  }

  return (
    <div>
      {/* Instruction */}
      <div className="mb-4 rounded-2xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
        Tap words to select them, then press <b>Start Writing</b>.
        Select <b>1 word</b> to practise it alone, or <b>2–5 words</b> to use them all in one sentence.
      </div>

      {/* Word chips — tap to select/deselect */}
      <div className="mb-5 flex flex-wrap gap-2.5">
        {words.map((w) => {
          const isSelected = selected.has(w.id);
          const evaluated  = (w.correct ?? 0) >= 3;
          const attempted  = (w.attempted ?? 0) > 0;
          return (
            <button key={w.id} onClick={() => toggle(w.id)}
              className={`flex items-center gap-2 rounded-2xl border-2 px-3.5 py-2.5 text-sm font-semibold transition active:scale-95 ${
                isSelected
                  ? "border-purple-500 bg-purple-500 text-white shadow-md"
                  : evaluated
                    ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                    : attempted
                      ? "border-brand-200 bg-brand-50 text-brand-700"
                      : "border-gray-300 bg-white text-gray-800"
              }`}>
              <span className={`text-xs ${
                isSelected ? "text-white" :
                w.difficulty === "easy" ? "text-green-500" : "text-red-500"
              }`}>
                {isSelected ? "✓" : w.difficulty === "easy" ? "🟢" : "🔴"}
              </span>
              {w.text}
              {!isSelected && (
                <span className="text-xs font-normal opacity-60">
                  {evaluated ? "✅" : attempted ? `${w.correct ?? 0}/3` : ""}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Selection summary + Start button */}
      <div className={`rounded-2xl border-2 p-4 transition-all ${
        selected.size > 0
          ? "border-purple-300 bg-purple-50"
          : "border-gray-200 bg-white"
      }`}>
        {selected.size === 0 ? (
          <p className="text-center text-sm text-gray-400">
            No words selected yet — tap words above
          </p>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {[...selected].map((id) => {
                const w = words.find((x) => x.id === id);
                return (
                  <span key={id}
                    className="flex items-center gap-1 rounded-full bg-purple-500 pl-3 pr-1.5 py-1 text-sm font-semibold text-white">
                    {w?.text}
                    <button onClick={() => toggle(id)}
                      className="ml-0.5 rounded-full bg-white/20 px-1 text-xs font-bold hover:bg-white/40">
                      ✕
                    </button>
                  </span>
                );
              })}
            </div>
            <p className="mb-3 text-xs text-purple-700">
              {selected.size === 1
                ? "✏️ You will practice this word with the AI tutor."
                : `✏️ You will write sentences using all ${selected.size} words together.`}
            </p>
            <button onClick={start}
              className="w-full rounded-xl bg-purple-500 py-3.5 text-base font-bold text-white active:scale-[0.98]">
              {selected.size === 1
                ? `Start writing — "${words.find(w => w.id === [...selected][0])?.text}"`
                : `Start multi-word challenge (${selected.size} words) →`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
