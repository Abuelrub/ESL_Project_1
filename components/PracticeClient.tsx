"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

interface Question {
  question_id: string;
  number: number;
  total: number;
  type: string;
  level: number;
  word: string;
  is_review: boolean;
  streak?: number;
  data: {
    question?: string;
    statement?: string;
    sentence?: string;
    instruction?: string;
    hint?: string;
    options?: string[];
    words?: string[];
    definitions?: string[];
  };
}

interface Result {
  is_correct: boolean;
  correct_display: string;
  feedback: string;
  mistake?: string; suggestion?: string; improved?: string;
  why_right?: string; why_wrong?: string; extra_example?: string;
}

type Phase = "starting" | "loading" | "question" | "checking" | "feedback" | "done" | "error";

export default function PracticeClient({
  unitId,
  unitName,
}: {
  unitId: string;
  unitName: string;
}) {
  const [phase, setPhase] = useState<Phase>("starting");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [q, setQ] = useState<Question | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [summary, setSummary] = useState<{ total: number; correct: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  // answer state
  const [selected, setSelected] = useState<number | null>(null);
  const [selectedMulti, setSelectedMulti] = useState<number[]>([]);
  const [selectedWord, setSelectedWord] = useState<string | null>(null);
  const [written, setWritten] = useState("");
  const [matchWordIdx, setMatchWordIdx] = useState<number | null>(null);
  const [matches, setMatches] = useState<(number | null)[]>([]);

  const startedRef = useRef(false);

  const fetchNext = useCallback(async (sid: string) => {
    setPhase("loading");
    setSelected(null);
    setSelectedMulti([]);
    setSelectedWord(null);
    setWritten("");
    setMatchWordIdx(null);
    setMatches([]);
    setResult(null);
    try {
      const res = await fetch("/api/questions/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sid }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong");
      if (data.done) {
        setSummary({ total: data.total, correct: data.correct });
        setPhase("done");
      } else {
        setQ(data);
        setPhase("question");
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Something went wrong");
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    (async () => {
      try {
        const res = await fetch("/api/practice/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ unit_id: unitId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not start");
        setSessionId(data.session_id);
        fetchNext(data.session_id);
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : "Could not start");
        setPhase("error");
      }
    })();
  }, [unitId, fetchNext]);

  async function submitAnswer() {
    if (!q) return;
    let answer: unknown = null;
    if (q.type === "multiple_choice" || q.type === "sentence_completion") answer = selected;
    else if (q.type === "true_false") answer = selected === 0;
    else if (q.type === "fill_blank") answer = selectedWord;
    else if (q.type === "multi_select") answer = selectedMulti;
    else if (q.type === "write_sentence") answer = written.trim();
    else if (q.type === "matching") answer = matches;

    setPhase("checking");
    try {
      const res = await fetch("/api/questions/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question_id: q.question_id, answer }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not check answer");
      setResult(data);
      setPhase("feedback");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Could not check answer");
      setPhase("error");
    }
  }

  const canSubmit =
    (q?.type === "multiple_choice" || q?.type === "sentence_completion" || q?.type === "true_false")
      ? selected !== null
      : q?.type === "fill_blank"
        ? selectedWord !== null
        : q?.type === "multi_select"
          ? selectedMulti.length > 0
          : q?.type === "write_sentence"
            ? written.trim().length > 2
            : q?.type === "matching"
              ? (q.data.words?.length ?? 0) > 0 &&
                matches.length === (q.data.words?.length ?? 0) &&
                matches.every((m) => m !== null)
              : false;

  const TYPE_LABELS: Record<string, string> = {
    multiple_choice: "Multiple choice",
    true_false: "True or false?",
    fill_blank: "Fill in the blank — tap a word",
    sentence_completion: "Complete the sentence",
    multi_select: "Select ALL correct answers",
    write_sentence: "Write your own sentence",
    matching: "Match each word to its meaning",
  };

  // ---------- SCREENS ----------

  if (phase === "starting" || (phase === "loading" && !q)) {
    return (
      <Center>
        <Spinner />
        <p className="mt-4 text-gray-500">Preparing your practice…</p>
      </Center>
    );
  }

  if (phase === "error") {
    return (
      <Center>
        <p className="mb-2 text-3xl">😕</p>
        <p className="mb-4 text-gray-600">{errorMsg}</p>
        <div className="flex gap-2">
          {sessionId && (
            <button onClick={() => fetchNext(sessionId)}
              className="rounded-xl bg-brand-500 px-5 py-3 font-semibold text-white">
              Try again
            </button>
          )}
          <Link href="/student" className="rounded-xl border border-gray-300 bg-white px-5 py-3 font-semibold">
            Go back
          </Link>
        </div>
      </Center>
    );
  }

  if (phase === "done" && summary) {
    const pct = summary.total > 0 ? Math.round((summary.correct / summary.total) * 100) : 0;
    return (
      <Center>
        <p className="mb-2 text-5xl">{pct >= 80 ? "🎉" : pct >= 50 ? "👏" : "💪"}</p>
        <h1 className="mb-1 text-2xl font-extrabold">Practice complete!</h1>
        <p className="mb-4 text-lg text-gray-600">
          You got <span className="font-bold text-brand-600">{summary.correct}</span> of{" "}
          <span className="font-bold">{summary.total}</span> correct ({pct}%)
        </p>
        <p className="mb-6 text-gray-500">
          {pct >= 80 ? "Amazing work! You're a superstar! 🌟"
            : pct >= 50 ? "Great job! Keep going! ✨"
            : "Every practice makes you stronger! 📚"}
        </p>
        <div className="flex gap-2">
          <button onClick={() => { startedRef.current = false; setPhase("starting"); setSummary(null);
              window.location.reload(); }}
            className="rounded-xl bg-brand-500 px-5 py-3 font-semibold text-white">
            🔄 Practice again
          </button>
          <Link href="/student" className="rounded-xl border border-gray-300 bg-white px-5 py-3 font-semibold">
            🏠 Home
          </Link>
        </div>
      </Center>
    );
  }

  if (!q) return null;
  const inFeedback = phase === "feedback";

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col p-4">
      <header className="mb-3 flex items-center justify-between">
        <Link href="/student" className="text-sm text-gray-500">✕ Exit</Link>
        <span className="text-sm text-gray-500">{unitName}</span>
      </header>

      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="text-gray-500">Question {q.number} of {q.total}</span>
        <span className="font-medium text-brand-600">
          {(q.streak ?? 0) >= 2 ? "🔥 " : ""}{"⭐".repeat(q.level)} Level {q.level}
          {q.is_review ? " · 🔁 Review" : ""}
        </span>
      </div>
      <div className="mb-4 h-2.5 rounded-full bg-gray-100">
        <div className="h-2.5 rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all"
          style={{ width: `${(q.number / q.total) * 100}%` }} />
      </div>

      <div className="flex-1">
        <p className="mb-1 text-sm font-medium text-gray-500">{TYPE_LABELS[q.type]}</p>

        {q.type === "fill_blank" ? (
          <>
            <p className="mb-4 text-lg leading-relaxed">
              {q.data.sentence?.split("___").map((part, i, arr) => (
                <span key={i}>
                  {part}
                  {i < arr.length - 1 && (
                    <span className="mx-1 inline-block min-w-20 rounded border-b-2 border-brand-500 text-center font-bold text-brand-600">
                      {selectedWord ?? "\u00A0"}
                    </span>
                  )}
                </span>
              ))}
            </p>
            <div className="flex flex-wrap gap-2">
              {q.data.options?.map((opt) => (
                <button key={opt} disabled={inFeedback}
                  onClick={() => setSelectedWord(opt)}
                  className={
                    "rounded-full border px-4 py-2.5 text-base font-medium transition active:scale-95 " +
                    (selectedWord === opt
                      ? "border-brand-500 bg-brand-50 text-brand-700"
                      : "border-gray-300 bg-white")
                  }>
                  {opt}
                </button>
              ))}
            </div>
          </>
        ) : q.type === "true_false" ? (
          <>
            <p className="mb-4 text-lg font-medium leading-relaxed">{q.data.statement}</p>
            <div className="grid grid-cols-2 gap-3">
              {["✅ True", "❌ False"].map((label, idx) => (
                <button key={label} disabled={inFeedback}
                  onClick={() => setSelected(idx)}
                  className={
                    "rounded-2xl border-2 py-5 text-lg font-bold transition active:scale-95 " +
                    (selected === idx
                      ? "border-brand-500 bg-brand-50 text-brand-700"
                      : "border-gray-200 bg-white")
                  }>
                  {label}
                </button>
              ))}
            </div>
          </>
        ) : q.type === "multi_select" ? (
          <>
            <p className="mb-4 text-lg font-medium leading-relaxed">{q.data.question}</p>
            <div className="grid gap-2.5">
              {q.data.options?.map((opt, idx) => {
                const on = selectedMulti.includes(idx);
                return (
                  <button key={idx} disabled={inFeedback}
                    onClick={() =>
                      setSelectedMulti((prev) =>
                        on ? prev.filter((i) => i !== idx) : [...prev, idx]
                      )
                    }
                    className={
                      "flex items-center gap-3 rounded-2xl border-2 px-4 py-3.5 text-left text-base transition active:scale-[0.98] " +
                      (on ? "border-brand-500 bg-brand-50" : "border-gray-200 bg-white")
                    }>
                    <span className={
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 text-sm font-bold " +
                      (on ? "border-brand-500 bg-brand-500 text-white" : "border-gray-300")
                    }>
                      {on ? "✓" : ""}
                    </span>
                    {opt}
                  </button>
                );
              })}
            </div>
          </>
        ) : q.type === "matching" ? (
          <>
            <p className="mb-3 text-base text-gray-600">
              Tap a word, then tap its meaning 👇
            </p>
            <div className="mb-4 flex flex-wrap gap-2">
              {q.data.words?.map((w, wi) => {
                const isActive = matchWordIdx === wi;
                const isMatched = matches[wi] !== null && matches[wi] !== undefined;
                return (
                  <button key={wi} disabled={inFeedback}
                    onClick={() => setMatchWordIdx(isActive ? null : wi)}
                    className={
                      "rounded-full border-2 px-4 py-2.5 text-base font-bold transition active:scale-95 " +
                      (isActive
                        ? "border-brand-500 bg-brand-500 text-white"
                        : isMatched
                          ? "border-green-300 bg-green-50 text-green-700"
                          : "border-gray-300 bg-white")
                    }>
                    {isMatched ? "✓ " : ""}{w}
                  </button>
                );
              })}
            </div>
            <div className="grid gap-2.5">
              {q.data.definitions?.map((def, di) => {
                const ownerIdx = matches.findIndex((m) => m === di);
                const owner = ownerIdx >= 0 ? q.data.words?.[ownerIdx] : null;
                return (
                  <button key={di} disabled={inFeedback}
                    onClick={() => {
                      if (owner) {
                        // tap an assigned definition -> unassign it
                        setMatches((prev) => prev.map((m) => (m === di ? null : m)));
                        return;
                      }
                      if (matchWordIdx === null) return;
                      setMatches((prev) => {
                        const base = q.data.words?.map((_, i) => prev[i] ?? null) ?? [];
                        base[matchWordIdx] = di;
                        return base;
                      });
                      setMatchWordIdx(null);
                    }}
                    className={
                      "flex items-center justify-between gap-2 rounded-2xl border-2 px-4 py-3.5 text-left text-base transition active:scale-[0.98] " +
                      (owner
                        ? "border-green-300 bg-green-50"
                        : matchWordIdx !== null
                          ? "border-brand-300 bg-brand-50"
                          : "border-gray-200 bg-white")
                    }>
                    <span>{def}</span>
                    {owner && (
                      <span className="shrink-0 rounded-full bg-green-600 px-2.5 py-0.5 text-xs font-bold text-white">
                        {owner} ✕
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </>
        ) : q.type === "write_sentence" ? (
          <>
            <p className="mb-1 text-lg font-medium leading-relaxed">{q.data.instruction}</p>
            {q.data.hint && <p className="mb-4 text-sm text-gray-500">💡 Hint: {q.data.hint}</p>}
            <textarea
              value={written}
              onChange={(e) => setWritten(e.target.value)}
              disabled={inFeedback}
              rows={3}
              placeholder="Write your sentence here…"
              className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-base outline-none focus:border-brand-500"
            />
          </>
        ) : (
          <>
            <p className="mb-4 text-lg font-medium leading-relaxed">{q.data.question}</p>
            <div className="grid gap-2.5">
              {q.data.options?.map((opt, idx) => (
                <button key={idx} disabled={inFeedback}
                  onClick={() => setSelected(idx)}
                  className={
                    "flex items-center gap-3 rounded-2xl border-2 px-4 py-3.5 text-left text-base transition active:scale-[0.98] " +
                    (selected === idx ? "border-brand-500 bg-brand-50" : "border-gray-200 bg-white")
                  }>
                  <span className={
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 " +
                    (selected === idx ? "border-brand-500" : "border-gray-300")
                  }>
                    {selected === idx && <span className="h-3 w-3 rounded-full bg-brand-500" />}
                  </span>
                  {opt}
                </button>
              ))}
            </div>
          </>
        )}

        {inFeedback && result && (
          <div className={
            "mt-4 rounded-2xl p-4 space-y-2 " +
            (result.is_correct ? "bg-green-50" : "bg-orange-50")
          }>
            <p className={
              "font-bold " + (result.is_correct ? "text-green-700" : "text-orange-700")
            }>
              {result.is_correct ? "✅ Correct! Great job!" : "Not quite — let\'s learn together!"}
            </p>
            {result.feedback && (
              <p className={
                "text-sm " + (result.is_correct ? "text-green-700" : "text-orange-800")
              }>{result.feedback}</p>
            )}
            {!result.is_correct && result.correct_display && (
              <p className="text-sm text-orange-800">
                <b>Correct answer:</b> {result.correct_display}
              </p>
            )}
            {result.why_wrong && (
              <p className="text-sm text-orange-800"><b>What went wrong:</b> {result.why_wrong}</p>
            )}
            {result.why_right && (
              <p className="text-sm text-orange-800"><b>Why it\'s right:</b> {result.why_right}</p>
            )}
            {result.mistake && (
              <p className="text-sm text-orange-800"><b>Notice:</b> {result.mistake}</p>
            )}
            {result.improved && (
              <p className="text-sm text-orange-800">
                <b>Better sentence:</b> <i>{result.improved}</i>
              </p>
            )}
            {result.suggestion && (
              <p className="text-sm text-orange-800"><b>Tip:</b> {result.suggestion}</p>
            )}
            {result.extra_example && (
              <p className="text-sm text-orange-800">
                <b>Another example:</b> {result.extra_example}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="sticky bottom-0 -mx-4 mt-4 border-t border-gray-100 bg-white/90 p-4 backdrop-blur">
        {inFeedback ? (
          <button onClick={() => sessionId && fetchNext(sessionId)}
            className="w-full rounded-2xl bg-brand-500 py-4 text-lg font-bold text-white transition active:scale-[0.98]">
            {q.number >= q.total ? "See my score 🏆" : "Next question →"}
          </button>
        ) : (
          <button onClick={submitAnswer}
            disabled={!canSubmit || phase === "checking" || phase === "loading"}
            className="w-full rounded-2xl bg-brand-500 py-4 text-lg font-bold text-white transition active:scale-[0.98] disabled:opacity-50">
            {phase === "checking" ? "Checking…" : phase === "loading" ? "Loading…" : "Check answer"}
          </button>
        )}
      </div>
    </main>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center p-6 text-center">
      {children}
    </main>
  );
}

function Spinner() {
  return (
    <div className="h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-brand-500" />
  );
}
