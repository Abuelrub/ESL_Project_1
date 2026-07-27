"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Word { id: string; text: string; }
interface Question {
  id: string;
  question_type: string;
  difficulty: string;
  question_data: Record<string, unknown>;
  word?: { text: string } | null;
  teacher_edited?: boolean;
}

const TYPE_LABELS: Record<string, string> = {
  true_false: "True / False",
  multiple_choice: "Multiple choice",
  fill_blank: "Fill in the blank",
  matching: "Matching",
  write_sentence: "Write a sentence",
};

const DIFF_COLORS: Record<string, string> = {
  easy: "border-green-200 bg-green-50 text-green-800",
  medium: "border-amber-200 bg-amber-50 text-amber-800",
  hard: "border-red-200 bg-red-50 text-red-800",
};

function QuestionCard({
  q, index, testId, words, onSaved,
}: {
  q: Question; index: number; testId: string;
  words: Word[]; onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState("");

  // Editable state
  const d = q.question_data;
  const [qType, setQType] = useState(q.question_type);
  const [diff, setDiff] = useState(q.difficulty);

  // True/false
  const [statement, setStatement] = useState(String(d.statement ?? ""));
  const [correctBool, setCorrectBool] = useState(Boolean(d.correct_answer));

  // Multiple choice / sentence completion
  const [question, setQuestion] = useState(String(d.question ?? ""));
  const [options, setOptions] = useState<string[]>(
    Array.isArray(d.options) ? (d.options as string[]) : ["", "", "", ""]
  );
  const [correctIndex, setCorrectIndex] = useState(Number(d.correct_index ?? 0));

  // Fill blank
  const [sentence, setSentence] = useState(String(d.sentence ?? ""));
  const [correctWord, setCorrectWord] = useState(String(d.correct_word ?? ""));

  // Matching
  const [pairs, setPairs] = useState<{ word: string; definition: string }[]>(
    Array.isArray(d.pairs)
      ? (d.pairs as { word: string; definition: string }[])
      : [{ word: "", definition: "" }, { word: "", definition: "" }, { word: "", definition: "" }]
  );

  // Write sentence
  const [instruction, setInstruction] = useState(String(d.instruction ?? ""));

  // Explanation / hint (shared)
  const [explanation, setExplanation] = useState(String(d.explanation ?? ""));
  const [hint, setHint] = useState(String(d.hint ?? ""));

  function buildQuestionData(): Record<string, unknown> {
    const base = { explanation, hint };
    switch (qType) {
      case "true_false":
        return { ...base, statement, correct_answer: correctBool };
      case "multiple_choice":
      case "sentence_completion":
        return { ...base, question, options, correct_index: correctIndex };
      case "fill_blank": {
        const opts = [...options];
        if (!opts.includes(correctWord)) opts[0] = correctWord;
        return { ...base, sentence, options: opts, correct_word: correctWord };
      }
      case "matching":
        return { ...base, pairs };
      case "write_sentence":
        return { ...base, instruction };
      default:
        return { ...base };
    }
  }

  async function save() {
    setSaving(true); setError("");
    try {
      const res = await fetch("/api/tests/question", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          test_id: testId, question_id: q.id,
          question_type: qType, difficulty: diff,
          question_data: buildQuestionData(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setEditing(false); onSaved();
    } catch(e) { setError(e instanceof Error ? e.message : "Save failed"); }
    setSaving(false);
  }

  async function regenerate() {
    setRegenerating(true); setError("");
    try {
      const res = await fetch("/api/tests/regenerate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test_id: testId, question_id: q.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onSaved();
    } catch(e) { setError(e instanceof Error ? e.message : "Regenerate failed"); }
    setRegenerating(false);
  }

  async function deleteQ() {
    if (!confirm("Delete this question?")) return;
    await fetch("/api/tests/question", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ test_id: testId, question_id: q.id }),
    });
    onSaved();
  }

  const word = q.word;

  return (
    <div className={`rounded-2xl border-2 bg-white p-4 ${editing ? "border-brand-400" : "border-gray-200"}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-sm text-gray-600">Q{index + 1}</span>
          <span className={`rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${DIFF_COLORS[q.difficulty]}`}>
            {q.difficulty}
          </span>
          <span className="text-xs text-gray-500">{TYPE_LABELS[q.question_type]}</span>
          {word && <span className="text-xs text-gray-400">— &ldquo;{word.text}&rdquo;</span>}
          {q.teacher_edited && (
            <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-bold text-purple-700">
              ✎ Edited
            </span>
          )}
        </div>
        <div className="flex gap-1.5 shrink-0">
          <button onClick={() => setEditing(!editing)}
            className="rounded-lg border border-brand-300 px-2.5 py-1.5 text-xs font-semibold text-brand-600">
            {editing ? "Cancel" : "✎ Edit"}
          </button>
          <button onClick={regenerate} disabled={regenerating}
            className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs text-gray-600 disabled:opacity-50">
            {regenerating ? "…" : "🔄"}
          </button>
          <button onClick={deleteQ}
            className="rounded-lg border border-red-200 px-2.5 py-1.5 text-xs text-red-600">
            ✕
          </button>
        </div>
      </div>

      {/* Question preview (when not editing) */}
      {!editing && (
        <div className="text-sm text-gray-700 space-y-1">
          {q.question_type === "true_false" && (
            <>
              <p><i>{String(d.statement ?? "")}</i></p>
              <p className="text-xs text-gray-500">Answer: <b>{d.correct_answer ? "True ✅" : "False ✅"}</b></p>
            </>
          )}
          {(q.question_type === "multiple_choice" || q.question_type === "sentence_completion") && (
            <>
              <p>{String(d.question ?? "")}</p>
              {(d.options as string[] ?? []).map((o, j) => (
                <p key={j} className={j === Number(d.correct_index) ? "font-bold text-green-700" : "text-gray-500"}>
                  {j === Number(d.correct_index) ? "✅ " : "○ "}{o}
                </p>
              ))}
            </>
          )}
          {q.question_type === "fill_blank" && (
            <>
              <p>{String(d.sentence ?? "")}</p>
              <p className="text-xs text-gray-500">Correct: <b>{String(d.correct_word ?? "")}</b></p>
              <p className="text-xs text-gray-400">Options: {(d.options as string[] ?? []).join(" · ")}</p>
            </>
          )}
          {q.question_type === "matching" && (
            ((d.pairs ?? []) as { word: string; definition: string }[]).map((p, j) => (
              <p key={j} className="text-gray-600">• <b>{p.word}</b> = {p.definition}</p>
            ))
          )}
          {q.question_type === "write_sentence" && <p><i>{String(d.instruction ?? "")}</i></p>}
          {d.hint && <p className="text-xs text-amber-700">💡 {String(d.hint)}</p>}
        </div>
      )}

      {/* Edit form */}
      {editing && (
        <div className="mt-3 space-y-3 border-t border-gray-100 pt-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-gray-600">Question type</label>
              <select value={qType} onChange={e => setQType(e.target.value)}
                className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm">
                {Object.entries(TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Difficulty</label>
              <select value={diff} onChange={e => setDiff(e.target.value)}
                className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm">
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </div>
          </div>

          {/* Type-specific fields */}
          {qType === "true_false" && (
            <>
              <div>
                <label className="text-xs font-medium text-gray-600">Statement</label>
                <textarea value={statement} onChange={e => setStatement(e.target.value)}
                  rows={2} className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-500"/>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Correct answer</label>
                <div className="mt-1 flex gap-3">
                  {[true, false].map(v => (
                    <label key={String(v)} className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <input type="radio" checked={correctBool === v} onChange={() => setCorrectBool(v)}/>
                      {v ? "✅ True" : "❌ False"}
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}

          {(qType === "multiple_choice" || qType === "sentence_completion") && (
            <>
              <div>
                <label className="text-xs font-medium text-gray-600">Question</label>
                <textarea value={question} onChange={e => setQuestion(e.target.value)}
                  rows={2} className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-500"/>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Options (tick the correct one)</label>
                <div className="mt-1 space-y-1.5">
                  {options.map((opt, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input type="radio" checked={correctIndex === i} onChange={() => setCorrectIndex(i)}
                        className="h-4 w-4 shrink-0"/>
                      <input value={opt} onChange={e => { const o=[...options]; o[i]=e.target.value; setOptions(o); }}
                        className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-brand-500"
                        placeholder={`Option ${i+1}`}/>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {qType === "fill_blank" && (
            <>
              <div>
                <label className="text-xs font-medium text-gray-600">Sentence (use ___ for the blank)</label>
                <textarea value={sentence} onChange={e => setSentence(e.target.value)}
                  rows={2} className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-500"/>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Correct word</label>
                <input value={correctWord} onChange={e => setCorrectWord(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-500"/>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Wrong options (distractors)</label>
                <div className="mt-1 space-y-1.5">
                  {options.filter(o => o !== correctWord || !options.includes(correctWord)).slice(0, 3).map((opt, i) => (
                    <input key={i} value={opt}
                      onChange={e => { const o=[...options]; const idx=o.indexOf(opt); if(idx>=0){o[idx]=e.target.value;setOptions(o);} }}
                      placeholder={`Distractor ${i+1}`}
                      className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-brand-500"/>
                  ))}
                </div>
              </div>
            </>
          )}

          {qType === "matching" && (
            <div>
              <label className="text-xs font-medium text-gray-600">Word–Definition pairs</label>
              <div className="mt-1 space-y-2">
                {pairs.map((pair, i) => (
                  <div key={i} className="flex gap-2">
                    <input value={pair.word} onChange={e => { const p=[...pairs]; p[i]={...p[i],word:e.target.value}; setPairs(p); }}
                      placeholder="Word" className="w-1/3 rounded-lg border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500"/>
                    <input value={pair.definition} onChange={e => { const p=[...pairs]; p[i]={...p[i],definition:e.target.value}; setPairs(p); }}
                      placeholder="Definition" className="flex-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500"/>
                  </div>
                ))}
                <button type="button" onClick={() => setPairs([...pairs, {word:"",definition:""}])}
                  className="text-xs text-brand-600 underline">+ Add pair</button>
              </div>
            </div>
          )}

          {qType === "write_sentence" && (
            <div>
              <label className="text-xs font-medium text-gray-600">Instruction</label>
              <textarea value={instruction} onChange={e => setInstruction(e.target.value)}
                rows={2} className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-500"/>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-gray-600">Hint (optional)</label>
              <input value={hint} onChange={e => setHint(e.target.value)}
                className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-500"/>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Explanation (optional)</label>
              <input value={explanation} onChange={e => setExplanation(e.target.value)}
                className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-500"/>
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button onClick={save} disabled={saving}
            className="w-full rounded-xl bg-brand-500 py-2.5 text-sm font-bold text-white active:scale-[0.98] disabled:opacity-50">
            {saving ? "Saving…" : "💾 Save changes"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── ADD MANUAL QUESTION ──
function AddQuestionForm({ testId, words, onSaved }: { testId: string; words: Word[]; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [qType, setQType] = useState("multiple_choice");
  const [diff, setDiff] = useState("easy");
  const [wordId, setWordId] = useState("");
  const [questionText, setQuestionText] = useState("");
  const [opts, setOpts] = useState(["", "", "", ""]);
  const [correctIdx, setCorrectIdx] = useState(0);
  const [statement, setStatement] = useState("");
  const [correctBool, setCorrectBool] = useState(true);
  const [sentence, setSentence] = useState("");
  const [correctWord, setCorrectWord] = useState("");
  const [distractors, setDistractors] = useState(["", "", ""]);
  const [pairs, setPairs] = useState([{word:"",definition:""},{word:"",definition:""},{word:"",definition:""}]);
  const [instruction, setInstruction] = useState("");
  const [hint, setHint] = useState("");
  const [explanation, setExplanation] = useState("");

  async function save() {
    setSaving(true); setError("");
    let question_data: Record<string,unknown> = { hint, explanation };
    switch (qType) {
      case "true_false": question_data = {...question_data, statement, correct_answer:correctBool}; break;
      case "multiple_choice":
      case "sentence_completion": question_data = {...question_data, question:questionText, options:opts, correct_index:correctIdx}; break;
      case "fill_blank": question_data = {...question_data, sentence, correct_word:correctWord, options:[correctWord,...distractors]}; break;
      case "matching": question_data = {...question_data, pairs}; break;
      case "write_sentence": question_data = {...question_data, instruction}; break;
    }
    try {
      const res = await fetch("/api/tests/question", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ test_id:testId, question_type:qType, difficulty:diff, question_data, word_id:wordId||null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setOpen(false); onSaved();
    } catch(e) { setError(e instanceof Error ? e.message : "Failed"); }
    setSaving(false);
  }

  if (!open) return (
    <button onClick={() => setOpen(true)}
      className="mt-3 w-full rounded-2xl border-2 border-dashed border-brand-300 py-3.5 text-sm font-semibold text-brand-600 hover:bg-brand-50 active:scale-[0.98]">
      + Add question manually
    </button>
  );

  return (
    <div className="mt-3 rounded-2xl border-2 border-brand-300 bg-white p-4 space-y-3">
      <p className="font-bold text-brand-700">Add question manually</p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs font-medium text-gray-600">Type</label>
          <select value={qType} onChange={e=>setQType(e.target.value)}
            className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm">
            {Object.entries(TYPE_LABELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600">Difficulty</label>
          <select value={diff} onChange={e=>setDiff(e.target.value)}
            className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm">
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-gray-600">Target word (optional)</label>
        <select value={wordId} onChange={e=>setWordId(e.target.value)}
          className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm">
          <option value="">— No specific word —</option>
          {words.map(w=><option key={w.id} value={w.id}>{w.text}</option>)}
        </select>
      </div>

      {qType==="true_false" && <>
        <div><label className="text-xs font-medium text-gray-600">Statement</label>
          <textarea value={statement} onChange={e=>setStatement(e.target.value)} rows={2}
            className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-500"/></div>
        <div className="flex gap-3">
          {[true,false].map(v=>(
            <label key={String(v)} className="flex items-center gap-1.5 text-sm cursor-pointer">
              <input type="radio" checked={correctBool===v} onChange={()=>setCorrectBool(v)}/>{v?"✅ True":"❌ False"}
            </label>))}
        </div>
      </>}

      {(qType==="multiple_choice"||qType==="sentence_completion") && <>
        <div><label className="text-xs font-medium text-gray-600">Question</label>
          <textarea value={questionText} onChange={e=>setQuestionText(e.target.value)} rows={2}
            className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-500"/></div>
        <div><label className="text-xs font-medium text-gray-600">Options (tick the correct one)</label>
          <div className="mt-1 space-y-1.5">
            {opts.map((o,i)=>(
              <div key={i} className="flex items-center gap-2">
                <input type="radio" checked={correctIdx===i} onChange={()=>setCorrectIdx(i)} className="h-4 w-4 shrink-0"/>
                <input value={o} onChange={e=>{const a=[...opts];a[i]=e.target.value;setOpts(a);}} placeholder={`Option ${i+1}`}
                  className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-brand-500"/>
              </div>))}
          </div>
        </div>
      </>}

      {qType==="fill_blank" && <>
        <div><label className="text-xs font-medium text-gray-600">Sentence (use ___ for blank)</label>
          <textarea value={sentence} onChange={e=>setSentence(e.target.value)} rows={2}
            className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-500"/></div>
        <div><label className="text-xs font-medium text-gray-600">Correct word</label>
          <input value={correctWord} onChange={e=>setCorrectWord(e.target.value)}
            className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-500"/></div>
        <div><label className="text-xs font-medium text-gray-600">Wrong options</label>
          {distractors.map((d,i)=>(
            <input key={i} value={d} onChange={e=>{const a=[...distractors];a[i]=e.target.value;setDistractors(a);}}
              placeholder={`Distractor ${i+1}`}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-brand-500"/>))}
        </div>
      </>}

      {qType==="matching" && (
        <div><label className="text-xs font-medium text-gray-600">Word–Definition pairs</label>
          {pairs.map((p,i)=>(
            <div key={i} className="mt-1 flex gap-2">
              <input value={p.word} onChange={e=>{const a=[...pairs];a[i]={...a[i],word:e.target.value};setPairs(a);}}
                placeholder="Word" className="w-1/3 rounded-lg border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500"/>
              <input value={p.definition} onChange={e=>{const a=[...pairs];a[i]={...a[i],definition:e.target.value};setPairs(a);}}
                placeholder="Definition" className="flex-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500"/>
            </div>))}
          <button type="button" onClick={()=>setPairs([...pairs,{word:"",definition:""}])}
            className="mt-1 text-xs text-brand-600 underline">+ Add pair</button>
        </div>
      )}

      {qType==="write_sentence" && (
        <div><label className="text-xs font-medium text-gray-600">Instruction</label>
          <textarea value={instruction} onChange={e=>setInstruction(e.target.value)} rows={2}
            className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-500"/></div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div><label className="text-xs font-medium text-gray-600">Hint</label>
          <input value={hint} onChange={e=>setHint(e.target.value)}
            className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-500"/></div>
        <div><label className="text-xs font-medium text-gray-600">Explanation</label>
          <input value={explanation} onChange={e=>setExplanation(e.target.value)}
            className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-500"/></div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button onClick={save} disabled={saving}
          className="flex-1 rounded-xl bg-brand-500 py-2.5 text-sm font-bold text-white disabled:opacity-50">
          {saving ? "Saving…" : "💾 Add question"}
        </button>
        <button onClick={() => setOpen(false)}
          className="rounded-xl border border-gray-300 px-4 py-2.5 text-sm text-gray-600">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── MAIN COMPONENT ──
export default function QuestionEditor({
  testId, initialQuestions, words,
}: {
  testId: string;
  initialQuestions: Question[];
  words: Word[];
}) {
  const router = useRouter();
  const [questions, setQuestions] = useState(initialQuestions);

  function refresh() { router.refresh(); }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="font-semibold">
          Questions ({questions.length})
          <span className="ml-1 text-xs font-normal text-gray-400">
            — edit any question inline, regenerate individually, or add manually
          </span>
        </p>
      </div>

      <div className="space-y-2.5">
        {questions.map((q, i) => (
          <QuestionCard
            key={q.id} q={q} index={i}
            testId={testId} words={words}
            onSaved={refresh}
          />
        ))}
      </div>

      <AddQuestionForm testId={testId} words={words} onSaved={refresh} />
    </div>
  );
}
