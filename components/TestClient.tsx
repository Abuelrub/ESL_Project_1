"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface TestQuestion {
  id: string; type: string; difficulty: string; word: string;
  data: {
    question?: string; statement?: string; sentence?: string; instruction?: string;
    hint?: string; options?: string[]; words?: string[]; definitions?: string[];
  };
}

type Screen = "intro" | "question" | "submitting" | "done" | "error";

const TYPE_LABELS: Record<string,string> = {
  true_false:"True or false?", multiple_choice:"Multiple choice",
  fill_blank:"Fill in the blank", matching:"Match the word",
  write_sentence:"Write a sentence",
};

export default function TestClient({
  assignmentId, testName, questions, studentName,
}: {
  assignmentId: string; testName: string;
  questions: TestQuestion[]; studentName: string;
}) {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>("intro");
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<Record<string,unknown>>({});
  const [selected, setSelected] = useState<number|null>(null);
  const [selectedWord, setSelectedWord] = useState<string|null>(null);
  const [selectedMulti, setSelectedMulti] = useState<number[]>([]);
  const [written, setWritten] = useState("");
  const [matchWordIdx, setMatchWordIdx] = useState<number|null>(null);
  const [matches, setMatches] = useState<(number|null)[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [finalData, setFinalData] = useState<{raw:number;total:number;immediate:boolean}|null>(null);

  const q = questions[current];
  const firstName = studentName.split(" ")[0];

  function resetAnswerState() {
    setSelected(null); setSelectedWord(null); setSelectedMulti([]);
    setWritten(""); setMatchWordIdx(null); setMatches([]);
  }

  function currentAnswer(): unknown {
    if (!q) return null;
    if (q.type==="multiple_choice"||q.type==="sentence_completion") return selected;
    if (q.type==="true_false") return selected===0;
    if (q.type==="fill_blank") return selectedWord;
    if (q.type==="multi_select") return selectedMulti;
    if (q.type==="write_sentence") return written.trim();
    if (q.type==="matching") return matches;
    return null;
  }

  const canProceed =
    q?.type==="fill_blank" ? selectedWord!==null :
    q?.type==="write_sentence" ? written.trim().length>2 :
    q?.type==="matching" ? matches.length===(q.data.words?.length??0)&&matches.every(m=>m!==null) :
    q?.type==="multi_select" ? selectedMulti.length>0 :
    selected!==null;

  function nextQuestion() {
    const ans = currentAnswer();
    setAnswers(prev => ({ ...prev, [q.id]: ans }));
    resetAnswerState();
    if (current < questions.length-1) setCurrent(c=>c+1);
  }

  async function submitTest() {
    const finalAnswers = { ...answers, [q.id]: currentAnswer() };
    setScreen("submitting");
    try {
      const payload = Object.entries(finalAnswers).map(([qid, ans]) => ({
        question_id: qid, answer: ans,
      }));
      const res = await fetch("/api/tests/submit", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ assignment_id: assignmentId, answers: payload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error||"Submit failed");
      setFinalData({ raw:data.score_raw, total:data.score_total, immediate:data.immediate });
      setScreen("done");
    } catch(e) {
      setErrorMsg(e instanceof Error ? e.message : "Could not submit");
      setScreen("error");
    }
  }

  if (screen==="intro") return (
    <main className="flex min-h-dvh flex-col items-center justify-center p-6 text-center max-w-lg mx-auto">
      <p className="text-3xl mb-3">📋</p>
      <h1 className="text-2xl font-extrabold mb-1">{testName}</h1>
      <p className="text-gray-600 mb-4">Hello {firstName}! This is a test with {questions.length} questions.</p>
      <div className="mb-6 rounded-2xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800 text-left w-full">
        <p className="font-bold mb-1">⚠️ Important:</p>
        <ul className="list-disc pl-4 space-y-1">
          <li>No hints or feedback during the test</li>
          <li>Answer every question — you cannot go back</li>
          <li>Your teacher will review your results</li>
        </ul>
      </div>
      <button onClick={()=>setScreen("question")}
        className="w-full rounded-2xl bg-brand-500 py-4 text-lg font-bold text-white active:scale-[0.98]">
        Start test →
      </button>
    </main>
  );

  if (screen==="submitting") return (
    <main className="flex min-h-dvh flex-col items-center justify-center p-4">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-brand-500"/>
      <p className="mt-4 text-gray-500">Submitting and grading writing questions…</p>
    </main>
  );

  if (screen==="done"&&finalData) return (
    <main className="flex min-h-dvh flex-col items-center justify-center p-6 text-center max-w-lg mx-auto">
      <p className="text-5xl mb-3">✅</p>
      <h1 className="text-2xl font-extrabold mb-2">Test submitted!</h1>
      {finalData.immediate ? (
        <>
          <p className="text-xl font-bold text-brand-600 mb-1">
            Score: {finalData.raw}/{finalData.total} ({Math.round(finalData.raw/finalData.total*100)}%)
          </p>
          <button onClick={()=>router.push(`/student/tests/${assignmentId}/results`)}
            className="mt-4 rounded-xl bg-brand-500 px-6 py-3 font-semibold text-white">
            See detailed results →
          </button>
        </>
      ) : (
        <p className="text-gray-600 mb-6">Your results will be visible when your teacher releases them.</p>
      )}
      <button onClick={()=>router.push("/student")}
        className="mt-3 rounded-xl border border-gray-300 bg-white px-6 py-3 font-semibold">
        🏠 Home
      </button>
    </main>
  );

  if (screen==="error") return (
    <main className="flex min-h-dvh flex-col items-center justify-center p-6 text-center">
      <p className="text-3xl mb-2">😕</p>
      <p className="text-gray-600 mb-4">{errorMsg}</p>
      <button onClick={()=>setScreen("question")}
        className="rounded-xl bg-brand-500 px-5 py-3 font-semibold text-white">
        Try again
      </button>
    </main>
  );

  if (!q) return null;

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col p-4">
      <div className="mb-3 flex items-center justify-between text-sm">
        <span className="text-gray-500">Question {current+1} of {questions.length}</span>
        <span className="font-medium text-brand-600 capitalize">{q.difficulty}</span>
      </div>
      <div className="mb-4 h-2 rounded-full bg-gray-100">
        <div className="h-2 rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all"
          style={{ width:`${((current)/(questions.length))*100}%` }}/>
      </div>

      <div className="flex-1">
        <p className="mb-1 text-sm font-medium text-gray-500">{TYPE_LABELS[q.type]}</p>

        {q.type==="true_false" && (
          <>
            <p className="mb-4 text-lg font-medium leading-relaxed">{q.data.statement}</p>
            <div className="grid grid-cols-2 gap-3">
              {["✅ True","❌ False"].map((l,i)=>(
                <button key={l} onClick={()=>setSelected(i)}
                  className={"rounded-2xl border-2 py-5 text-lg font-bold transition active:scale-95 "+(selected===i?"border-brand-500 bg-brand-50 text-brand-700":"border-gray-200 bg-white")}>
                  {l}
                </button>
              ))}
            </div>
          </>
        )}

        {(q.type==="multiple_choice"||q.type==="sentence_completion") && (
          <>
            <p className="mb-4 text-lg font-medium leading-relaxed">{q.data.question}</p>
            <div className="grid gap-2.5">
              {q.data.options?.map((opt,i)=>(
                <button key={i} onClick={()=>setSelected(i)}
                  className={"flex items-center gap-3 rounded-2xl border-2 px-4 py-3.5 text-left text-base transition active:scale-[0.98] "+(selected===i?"border-brand-500 bg-brand-50":"border-gray-200 bg-white")}>
                  <span className={"flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 "+(selected===i?"border-brand-500":"border-gray-300")}>
                    {selected===i&&<span className="h-3 w-3 rounded-full bg-brand-500"/>}
                  </span>
                  {opt}
                </button>
              ))}
            </div>
          </>
        )}

        {q.type==="fill_blank" && (
          <>
            <p className="mb-4 text-lg leading-relaxed">
              {q.data.sentence?.split("___").map((part,i,arr)=>(
                <span key={i}>{part}{i<arr.length-1&&(
                  <span className="mx-1 inline-block min-w-20 rounded border-b-2 border-brand-500 text-center font-bold text-brand-600">
                    {selectedWord??""}
                  </span>
                )}</span>
              ))}
            </p>
            <div className="flex flex-wrap gap-2">
              {q.data.options?.map(opt=>(
                <button key={opt} onClick={()=>setSelectedWord(opt)}
                  className={"rounded-full border px-4 py-2.5 text-base font-medium transition active:scale-95 "+(selectedWord===opt?"border-brand-500 bg-brand-50 text-brand-700":"border-gray-300 bg-white")}>
                  {opt}
                </button>
              ))}
            </div>
          </>
        )}

        {q.type==="write_sentence" && (
          <>
            <p className="mb-2 text-lg font-medium leading-relaxed">{q.data.instruction}</p>
            {q.data.hint&&<p className="mb-3 text-sm text-amber-700">💡 {q.data.hint}</p>}
            <textarea value={written} onChange={e=>setWritten(e.target.value)}
              rows={3} placeholder="Write your sentence here…"
              className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-base outline-none focus:border-brand-500"/>
          </>
        )}

        {q.type==="matching" && (
          <>
            <p className="mb-3 text-base text-gray-600">Tap a word, then tap its meaning.</p>
            <div className="mb-4 flex flex-wrap gap-2">
              {q.data.words?.map((w,wi)=>{
                const isActive=matchWordIdx===wi;
                const isMatched=matches[wi]!=null;
                return (
                  <button key={wi} onClick={()=>setMatchWordIdx(isActive?null:wi)}
                    className={"rounded-full border-2 px-4 py-2.5 text-base font-bold transition active:scale-95 "+(isActive?"border-brand-500 bg-brand-500 text-white":isMatched?"border-green-300 bg-green-50 text-green-700":"border-gray-300 bg-white")}>
                    {isMatched?"✓ ":""}{w}
                  </button>
                );
              })}
            </div>
            <div className="grid gap-2.5">
              {q.data.definitions?.map((def,di)=>{
                const ownerIdx=matches.findIndex(m=>m===di);
                const owner=ownerIdx>=0?q.data.words?.[ownerIdx]:null;
                return (
                  <button key={di}
                    onClick={()=>{
                      if (owner){setMatches(prev=>prev.map(m=>m===di?null:m));return;}
                      if (matchWordIdx===null) return;
                      setMatches(prev=>{const b=q.data.words?.map((_,i)=>prev[i]??null)??[];b[matchWordIdx]=di;return b;});
                      setMatchWordIdx(null);
                    }}
                    className={"flex items-center justify-between gap-2 rounded-2xl border-2 px-4 py-3.5 text-left text-base transition active:scale-[0.98] "+(owner?"border-green-300 bg-green-50":matchWordIdx!==null?"border-brand-300 bg-brand-50":"border-gray-200 bg-white")}>
                    <span>{def}</span>
                    {owner&&<span className="shrink-0 rounded-full bg-green-600 px-2 py-0.5 text-xs font-bold text-white">{owner} ✕</span>}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      <div className="sticky bottom-0 -mx-4 mt-4 border-t border-gray-100 bg-white/90 p-4 backdrop-blur">
        {current < questions.length-1 ? (
          <button onClick={nextQuestion} disabled={!canProceed}
            className="w-full rounded-2xl bg-brand-500 py-4 text-lg font-bold text-white active:scale-[0.98] disabled:opacity-50">
            Next →
          </button>
        ) : (
          <button onClick={submitTest} disabled={!canProceed}
            className="w-full rounded-2xl bg-green-600 py-4 text-lg font-bold text-white active:scale-[0.98] disabled:opacity-50">
            Submit test ✅
          </button>
        )}
      </div>
    </main>
  );
}
