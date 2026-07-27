"use client";

interface Word { id: string; text: string; difficulty: string; }
interface Unit { id: string; name: string; words: Word[]; selectedIds?: string[]; }

export default function WordSelector({ units }: { units: Unit[] }) {
  function toggleUnit(unitId: string, checked: boolean) {
    document.querySelectorAll<HTMLInputElement>(`input[data-unit="${unitId}"]`)
      .forEach((b) => (b.checked = checked));
  }

  return (
    <div className="grid gap-3">
      {units.map((unit) => (
        <div key={unit.id} className="rounded-xl border border-gray-200 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold">{unit.name}</p>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-brand-600">
              <input type="checkbox" defaultChecked
                onChange={(e) => toggleUnit(unit.id, e.target.checked)} />
              All
            </label>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {unit.words.map((w) => (
              <label key={w.id}
                className={`flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${
                  w.difficulty === "easy"
                    ? "border-green-200 bg-green-50"
                    : "border-red-200 bg-red-50"
                }`}>
                <input type="checkbox" name="word_ids" value={w.id}
                  data-unit={unit.id}
                  defaultChecked={!unit.selectedIds?.length || unit.selectedIds.includes(w.id)}
                  className="h-3 w-3" />
                <span className={w.difficulty === "easy" ? "text-green-800" : "text-red-800"}>
                  {w.text}
                </span>
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
