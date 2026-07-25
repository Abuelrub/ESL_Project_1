"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface LessonContent {
  definition: string;
  part_of_speech: string;
  example: string;
  examples_in_action: string[];
  hint: string;
}

interface StepQuestion {
  question_id: string;
  type: string;
  hint: string;
  data: {
    question?: string;
    statement?: string;
    sentence?: string;
    instruction?: string;
    hint?: string;
    options?: string[];
  };
}

type Screen =
  | "loading" | "flashcard" | "examples"
  | "check" | "checking" | "feedback" | "done" | "error";

export default function LessonClient({
  unitId, unitName, wordId, wordText,
}: {
  unitId: string; unitName: string; wordId: string; wordText: string;
}) {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>("loading");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [content, setContent] = useState<LessonContent | null>(null);
  const [shortLesson, setShortLesson] = useState(false);
  const [sentenceRequired, setSentenceRequired] = useState(false);
  const [step, setStep] = useState(1); // 1 flashcard, 2 examples, 3 check, 4 fill, 5 sentence
  const [q, setQ] = useState<StepQuestion | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [teach, setTeach] = useState<string | null>(null);
  const [finalResult, setFinalResult] = useState<{
    is_correct: boolean; correct_display: string; feedback: string;
    mistake?: string; suggestion?: string; why_right?: string; why_wrong?: string;
    extra_example?: string; improved?: string;
  } | null>(null);
  const [teachExtras, setTeachExtras] = useState<{
    mistake?: string; suggestion?: string; why_right?: string;
    extra_example?: string; correct_display?: string;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [practicesEarned, setPracticesEarned] = useState(0);
  const [firstTries, setFirstTries] = useState(0);

  const [selected, setSelected] = useState<number | null>(null);
  const [selectedWord, setSelectedWord] = useState<string | null>(null);
  const [written, setWritten] = useState("");

  const startedRef = useRef(false);
  const totalSteps = shortLesson ? 3 : 5;
  const doneSteps = shortLesson ? step - 2 : step;

  const speak = useCallback((text: string) => {
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "en-US";
      u.rate = 0.85;
      window.speechSynthesis.speak(u);
    } catch { /* not supported */ }
  }, []);

  const loadStepQuestion = useCallback(async (sid: string, stepNum: number) => {
    setScreen("loading");
    setSelected(null); setSelectedWord(null); setWritten("");
    setShowHint(false); setTeach(null); setFinalResult(null); setTeachExtras(null);
    try {
      const res = await fetch("/api/lesson/step", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sid, word_id: wordId, step: stepNum }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong");
      setQ(data);
      setStep(stepNum);
      setScreen("check");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Something went wrong");
      setScreen("error");
    }
  }, [wordId]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    (async () => {
      try {
        const res = await fetch("/api/lesson/start", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ unit_id: unitId, word_id: wordId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not start");
        setSessionId(data.session_id);
        setShortLesson(data.short_lesson);
        setSentenceRequired(data.sentence_required);

        if (data.short_lesson) {
          // Returning student: jump straight to the checks
          loadStepQuestion(data.session_id, 3);
        } else {
          const cRes = await fetch("/api/lesson/content", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session_id: data.session_id, word_id: wordId }),
          });
          const cData = await cRes.json();
          if (!cRes.ok) throw new Error(cData.error || "Could not load lesson");
          setContent(cData.content);
          setStep(1);
          setScreen("flashcard");
        }
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : "Could not start");
        setScreen("error");
      }
    })();
  }, [unitId, wordId, loadStepQuestion]);

  async function tapHint() {
    setShowHint(true);
    if (q) {
      fetch("/api/lesson/hint", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question_id: q.question_id }),
      }).catch(() => {});
    }
  }

  async function submit() {
    if (!q) return;
    let answer: unknown = null;
    if (q.type === "multiple_choice") answer = selected;
    else if (q.type === "true_false") answer = selected === 0;
    else if (q.type === "fill_blank") answer = selectedWord;
    else if (q.type === "write_sentence") answer = written.trim();

    setScreen("checking");
    try {
      const res = await fetch("/api/lesson/answer", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question_id: q.question_id, answer }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not check");

      if (data.retry) {
        setTeach(data.teach);
        setTeachExtras({
          mistake: data.mistake, suggestion: data.suggestion,
          why_right: data.why_right, extra_example: data.extra_example,
          correct_display: data.correct_display,
        });
        setSelected(null); setSelectedWord(null);
        setScreen("check");
      } else {
        setPracticesEarned((n) => n + 1);
        if (data.first_try) setFirstTries((n) => n + 1);
        setFinalResult(data);
        setScreen("feedback");
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Could not check");
      setScreen("error");
    }
  }

  function nextAfterFeedback() {
    if (!sessionId) return;
    if (step === 3) loadStepQuestion(sessionId, 4);
    else if (step === 4) loadStepQuestion(sessionId, 5);
    else setScreen("done");
  }

  const canSubmit =
    q?.type === "fill_blank" ? selectedWord !== null
      : q?.type === "write_sentence" ? written.trim().length > 2
        : selected !== null;

  // ---------- SCREENS ----------

  if (screen === "loading") {
    return (
      <Center>
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-brand-500" />
        <p className="mt-4 text-gray-500">Preparing your lesson…</p>
      </Center>
    );
  }

  if (screen === "error") {
    return (
      <Center>
        <p className="mb-2 text-3xl">😕</p>
        <p className="mb-4 text-gray-600">{errorMsg}</p>
        <Link href={`/student/learn/${unitId}`}
          className="rounded-xl bg-brand-500 px-5 py-3 font-semibold text-white">
          Back to word list
        </Link>
      </Center>
    );
  }

  if (screen === "done") {
    return (
      <Center>
        <p className="mb-2 text-5xl">🎉</p>
        <h1 className="mb-1 text-2xl font-extrabold">Great practice!</h1>
        <p className="mb-1 text-lg">
          You practiced <span className="font-bold text-brand-600">{wordText}</span>
        </p>
        <p className="mb-6 text-gray-500">
          +{practicesEarned} practice{practicesEarned !== 1 ? "s" : ""} earned
          {firstTries > 0 ? ` · ${firstTries} first-try ⚡` : ""}
        </p>
        <div className="flex gap-2">
          <button onClick={() => router.push(`/student/learn/${unitId}`)}
            className="rounded-xl bg-brand-500 px-5 py-3 font-semibold text-white">
            ✨ Next word
          </button>
          <Link href="/student"
            className="rounded-xl border border-gray-300 bg-white px-5 py-3 font-semibold">
            🏠 Home
          </Link>
        </div>
      </Center>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col p-4">
      <header className="mb-3 flex items-center justify-between">
        <Link href={`/student/learn/${unitId}`} className="text-sm text-gray-500">✕ Exit</Link>
        <span className="text-sm text-gray-500">{unitName}</span>
      </header>

      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="text-gray-500">
          Practicing: <b className="text-gray-800">{wordText}</b>
        </span>
        <span className="font-medium text-brand-600">
          Step {Math.max(1, doneSteps)} of {totalSteps}
        </span>
      </div>
      <div className="mb-4 flex gap-1">
        {Array.from({ length: totalSteps }).map((_, i) => (
          <div key={i} className={
            "h-2 flex-1 rounded-full " +
            (i < doneSteps ? "bg-gradient-to-r from-indigo-500 to-purple-500" : "bg-gray-100")
          } />
        ))}
      </div>

      <div className="flex-1">
        {screen === "flashcard" && content && (
          <div className="rounded-3xl border-2 border-brand-100 bg-gradient-to-b from-white to-brand-50 p-6 text-center shadow-sm">
            <p className="mb-1 text-sm font-medium text-gray-500">Meet the word 👋</p>
            <p className="mb-1 text-4xl font-extrabold text-brand-700">{wordText}</p>
            {content.part_of_speech && (
              <p className="mb-3 text-sm italic text-gray-400">{content.part_of_speech}</p>
            )}
            <button onClick={() => speak(wordText)}
              className="mb-4 rounded-full border border-brand-200 bg-white px-4 py-2 text-sm font-semibold text-brand-600 active:scale-95">
              🔊 Say it
            </button>
            <p className="mb-3 text-lg font-medium">{content.definition}</p>
            <div className="rounded-2xl bg-white p-4 text-left">
              <p className="text-sm text-gray-500">Example:</p>
              <p className="text-base">{content.example}</p>
              <button onClick={() => speak(content.example)}
                className="mt-2 text-sm font-semibold text-brand-600">
                🔊 Listen
              </button>
            </div>
          </div>
        )}

        {screen === "examples" && content && (
          <div>
            <p className="mb-3 text-lg font-bold">See it in action 🎬</p>
            <div className="grid gap-3">
              {content.examples_in_action.map((ex, i) => (
                <div key={i} className="rounded-2xl border border-gray-200 bg-white p-4">
                  <p className="text-base leading-relaxed">
                    {highlight(ex, wordText)}
                  </p>
                  <button onClick={() => speak(ex)}
                    className="mt-2 text-sm font-semibold text-brand-600">
                    🔊 Listen
                  </button>
                </div>
              ))}
            </div>
            {content.hint && (
              <div className="mt-4 rounded-2xl bg-amber-50 p-4">
                <p className="text-sm text-amber-800">💡 <b>Memory tip:</b> {content.hint}</p>
              </div>
            )}
          </div>
        )}

        {(screen === "check" || screen === "checking" || screen === "feedback") && q && (
          <div>
            <p className="mb-1 text-sm font-medium text-gray-500">
              {step === 3 ? "Quick check ✅" : step === 4 ? "Try it ✏️" : "Use it 🌟"}
            </p>

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
                    <button key={opt} disabled={screen === "feedback"}
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
                    <button key={label} disabled={screen === "feedback"}
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
            ) : q.type === "write_sentence" ? (
              <>
                <p className="mb-1 text-lg font-medium leading-relaxed">{q.data.instruction}</p>
                <textarea value={written} onChange={(e) => setWritten(e.target.value)}
                  disabled={screen === "feedback"} rows={3}
                  placeholder="Write your sentence here…"
                  className="mt-3 w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-base outline-none focus:border-brand-500" />
              </>
            ) : (
              <>
                <p className="mb-4 text-lg font-medium leading-relaxed">{q.data.question}</p>
                <div className="grid gap-2.5">
                  {q.data.options?.map((opt, idx) => (
                    <button key={idx} disabled={screen === "feedback"}
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

            {teach && screen !== "feedback" && (
              <div className="mt-4 rounded-2xl bg-orange-50 p-4 space-y-2">
                <p className="text-sm font-bold text-orange-700">Let&apos;s learn it again 🧡</p>
                <p className="text-sm text-orange-700">{teach}</p>
                {teachExtras?.mistake && (
                  <p className="text-sm text-orange-800"><b>What happened:</b> {teachExtras.mistake}</p>
                )}
                {teachExtras?.suggestion && (
                  <p className="text-sm text-orange-800"><b>Try this:</b> {teachExtras.suggestion}</p>
                )}
                {teachExtras?.extra_example && (
                  <p className="text-sm text-orange-800"><b>Example:</b> {teachExtras.extra_example}</p>
                )}
              </div>
            )}

            {screen !== "feedback" && (
              <div className="mt-4">
                {!showHint ? (
                  <button onClick={tapHint}
                    className="rounded-full bg-amber-100 px-4 py-2 text-sm font-semibold text-amber-800 active:scale-95">
                    💡 Show hint
                  </button>
                ) : (
                  <div className="rounded-2xl bg-amber-50 p-4">
                    <p className="text-sm text-amber-800">💡 <b>Hint:</b> {q.hint}</p>
                  </div>
                )}
              </div>
            )}

            {screen === "feedback" && finalResult && (
              <div className={
                "mt-4 rounded-2xl p-4 space-y-2 " +
                (finalResult.is_correct ? "bg-green-50" : "bg-orange-50")
              }>
                <p className={
                  "font-bold " + (finalResult.is_correct ? "text-green-700" : "text-orange-700")
                }>
                  {finalResult.is_correct ? "✅ Correct! Great job!" : "Not quite — that\'s okay! 💪"}
                </p>
                {finalResult.feedback && (
                  <p className={
                    "text-sm " +
                    (finalResult.is_correct ? "text-green-700" : "text-orange-800")
                  }>
                    {finalResult.feedback}
                  </p>
                )}
                {!finalResult.is_correct && finalResult.correct_display && (
                  <p className="text-sm text-orange-800">
                    <b>Correct answer:</b> {finalResult.correct_display}
                  </p>
                )}
                {finalResult.why_wrong && (
                  <p className="text-sm text-orange-800">
                    <b>What went wrong:</b> {finalResult.why_wrong}
                  </p>
                )}
                {finalResult.why_right && (
                  <p className="text-sm text-orange-800">
                    <b>Why it\'s right:</b> {finalResult.why_right}
                  </p>
                )}
                {finalResult.mistake && (
                  <p className="text-sm text-orange-800">
                    <b>Notice:</b> {finalResult.mistake}
                  </p>
                )}
                {finalResult.improved && (
                  <p className="text-sm text-orange-800">
                    <b>Better sentence:</b> <i>{finalResult.improved}</i>
                  </p>
                )}
                {finalResult.suggestion && (
                  <p className="text-sm text-orange-800">
                    <b>Tip:</b> {finalResult.suggestion}
                  </p>
                )}
                {finalResult.extra_example && (
                  <p className="text-sm text-orange-800">
                    <b>Another example:</b> {finalResult.extra_example}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="sticky bottom-0 -mx-4 mt-4 border-t border-gray-100 bg-white/90 p-4 backdrop-blur">
        {screen === "flashcard" && (
          <button onClick={() => { setStep(2); setScreen("examples"); }}
            className="w-full rounded-2xl bg-brand-500 py-4 text-lg font-bold text-white active:scale-[0.98]">
            Continue →
          </button>
        )}
        {screen === "examples" && (
          <button onClick={() => sessionId && loadStepQuestion(sessionId, 3)}
            className="w-full rounded-2xl bg-brand-500 py-4 text-lg font-bold text-white active:scale-[0.98]">
            Let&apos;s try it! →
          </button>
        )}
        {(screen === "check" || screen === "checking") && (
          <div className="flex gap-2">
            {step === 5 && !sentenceRequired && (
              <button onClick={() => setScreen("done")}
                className="rounded-2xl border border-gray-300 bg-white px-5 py-4 font-bold text-gray-600">
                Skip
              </button>
            )}
            <button onClick={submit} disabled={!canSubmit || screen === "checking"}
              className="flex-1 rounded-2xl bg-brand-500 py-4 text-lg font-bold text-white active:scale-[0.98] disabled:opacity-50">
              {screen === "checking" ? "Checking…" : "Check answer"}
            </button>
          </div>
        )}
        {screen === "feedback" && (
          <button onClick={nextAfterFeedback}
            className="w-full rounded-2xl bg-brand-500 py-4 text-lg font-bold text-white active:scale-[0.98]">
            {step >= 5 ? "Finish 🎉" : "Next step →"}
          </button>
        )}
      </div>
    </main>
  );
}

function highlight(sentence: string, word: string) {
  const parts = sentence.split(new RegExp(`(${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "i"));
  return parts.map((p, i) =>
    p.toLowerCase() === word.toLowerCase()
      ? <b key={i} className="text-brand-600">{p}</b>
      : <span key={i}>{p}</span>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center p-6 text-center">
      {children}
    </main>
  );
}
