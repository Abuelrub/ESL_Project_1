"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  is_correct?: boolean;
  grammar_correction?: string;
  improved_sentence?: string;
}

type Screen = "loading" | "chat" | "done" | "error";

const SENTENCES_PER_SESSION = 5;

export default function WritingChatbot({
  unitId, unitName, wordId, wordText,
}: {
  unitId: string; unitName: string; wordId: string; wordText: string;
}) {
  const [screen, setScreen] = useState<Screen>("loading");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [turn, setTurn] = useState(0);
  const [sessionScore, setSessionScore] = useState(0);
  const [allTimeCorrect, setAllTimeCorrect] = useState(0);
  const [isEvaluated, setIsEvaluated] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const startedRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () =>
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });

  useEffect(() => { scrollToBottom(); }, [messages]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    (async () => {
      try {
        const res = await fetch("/api/writing/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ unit_id: unitId, word_id: wordId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not start");
        setSessionId(data.session_id);
        setAllTimeCorrect(data.all_time_correct);
        setIsEvaluated(data.is_evaluated);

        // Opening AI message
        const prior = data.all_time_correct as number;
        const opening =
          prior === 0
            ? `Hello! Let's practice the word **"${wordText}"**! 😊\n\nWrite me a sentence using this word. Any sentence — just show me how you understand it!`
            : `Welcome back! Let's practice **"${wordText}"** again. You've already written ${prior} correct sentence${prior === 1 ? "" : "s"} for this word. Keep going — write me a new one! 💪`;

        setMessages([{ role: "assistant", content: opening }]);
        setScreen("chat");
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : "Could not start");
        setScreen("error");
      }
    })();
  }, [unitId, wordId, wordText]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || !sessionId || sending) return;
    const sentence = input.trim();
    setInput("");
    setSending(true);

    const userMsg: ChatMessage = { role: "user", content: sentence };
    const newHistory = [...messages, userMsg];
    setMessages(newHistory);

    try {
      const res = await fetch("/api/writing/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          sentence,
          // Only pass role+content to the API (not our extra display fields)
          history: messages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong");

      const aiMsg: ChatMessage = {
        role: "assistant",
        content: data.ai_message,
        is_correct: data.is_correct,
        grammar_correction: data.grammar_correction,
        improved_sentence: data.improved_sentence,
      };
      setMessages((prev) => [...prev, aiMsg]);
      setTurn(data.turn);
      setSessionScore(data.session_score);
      setAllTimeCorrect(data.all_time_correct);
      setIsEvaluated(data.is_evaluated);
      if (data.is_done) setScreen("done");
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "⚠️ " + (e instanceof Error ? e.message : "Error") },
      ]);
    }
    setSending(false);
  }, [input, sessionId, sending, messages]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  if (screen === "loading") {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center p-4">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-brand-500" />
        <p className="mt-4 text-gray-500">Starting writing session…</p>
      </main>
    );
  }

  if (screen === "error") {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center p-4 text-center">
        <p className="mb-2 text-3xl">😕</p>
        <p className="mb-4 text-gray-600">{errorMsg}</p>
        <Link href={`/student/writing/${unitId}`}
          className="rounded-xl bg-brand-500 px-5 py-3 font-semibold text-white">
          Back to words
        </Link>
      </main>
    );
  }

  if (screen === "done") {
    const pct = Math.round(sessionScore * 100);
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center p-4 text-center">
        <p className="mb-2 text-5xl">{pct >= 80 ? "🎉" : pct >= 50 ? "👏" : "💪"}</p>
        <h1 className="mb-1 text-2xl font-extrabold">Session complete!</h1>
        <p className="mb-1 text-lg font-semibold text-brand-600">
          {wordText}
        </p>
        <p className="mb-1 text-gray-600">
          Score this session: <b>{pct}%</b>
        </p>
        <p className="mb-4 text-gray-600">
          All-time correct sentences: <b>{allTimeCorrect}</b> / 3 needed
          {isEvaluated && " ✅ Writing evaluated!"}
        </p>
        {isEvaluated && (
          <p className="mb-4 rounded-2xl bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700">
            ✅ You&apos;ve written 3+ correct sentences — this word is now writing-evaluated!
          </p>
        )}
        <div className="flex gap-2">
          <Link href={`/student/writing/${unitId}/${wordId}`}
            className="rounded-xl bg-brand-500 px-5 py-3 font-semibold text-white"
            onClick={() => { startedRef.current = false; }}>
            Practice again
          </Link>
          <Link href={`/student/writing/${unitId}`}
            className="rounded-xl border border-gray-300 bg-white px-5 py-3 font-semibold">
            Other words
          </Link>
          <Link href="/student"
            className="rounded-xl border border-gray-300 bg-white px-5 py-3 font-semibold">
            🏠 Home
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh max-w-lg flex-col mx-auto">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-gray-100 bg-white px-4 py-3">
        <Link href={`/student/writing/${unitId}`} className="text-sm text-gray-500">
          ✕
        </Link>
        <div className="text-center">
          <p className="text-sm font-bold">✍️ {wordText}</p>
          <p className="text-xs text-gray-400">{unitName}</p>
        </div>
        <div className="text-right">
          <p className="text-xs font-semibold text-brand-600">
            {turn}/{SENTENCES_PER_SESSION}
          </p>
          <p className="text-xs text-gray-400">sentences</p>
        </div>
      </header>

      {/* Progress bar */}
      <div className="h-1.5 bg-gray-100">
        <div
          className="h-1.5 bg-gradient-to-r from-indigo-500 to-purple-500 transition-all"
          style={{ width: `${(turn / SENTENCES_PER_SESSION) * 100}%` }}
        />
      </div>

      {/* All-time counter */}
      <div className="flex items-center justify-between bg-gray-50 px-4 py-2 text-xs">
        <span className="text-gray-500">
          All-time correct: <b className="text-emerald-700">{allTimeCorrect}</b>/3 needed
        </span>
        {isEvaluated && (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-700">
            ✅ Evaluated!
          </span>
        )}
      </div>

      {/* Chat messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map((m, i) => (
          <div key={i}
            className={"flex " + (m.role === "user" ? "justify-end" : "justify-start")}>
            <div className={
              "max-w-[85%] rounded-2xl px-4 py-3 text-sm " +
              (m.role === "user"
                ? "rounded-br-sm bg-brand-500 text-white"
                : "rounded-bl-sm bg-white border border-gray-200 text-gray-800")
            }>
              {m.role === "assistant" ? (
                <div className="space-y-1.5">
                  {/* Render markdown-style bold */}
                  <p className="whitespace-pre-wrap leading-relaxed">
                    {m.content.split(/(\*\*[^*]+\*\*)/).map((part, j) =>
                      part.startsWith("**") && part.endsWith("**")
                        ? <b key={j}>{part.slice(2, -2)}</b>
                        : <span key={j}>{part}</span>
                    )}
                  </p>
                  {m.grammar_correction && (
                    <div className="mt-2 rounded-xl bg-orange-50 px-3 py-2">
                      <p className="text-xs font-bold text-orange-700">✏️ Correction:</p>
                      <p className="text-xs text-orange-800 italic">{m.grammar_correction}</p>
                    </div>
                  )}
                  {m.improved_sentence && (
                    <div className="mt-1 rounded-xl bg-blue-50 px-3 py-2">
                      <p className="text-xs font-bold text-blue-700">💡 Improved version:</p>
                      <p className="text-xs text-blue-800 italic">{m.improved_sentence}</p>
                    </div>
                  )}
                  {m.is_correct === true && (
                    <p className="text-xs font-semibold text-emerald-600">✅ Correct!</p>
                  )}
                  {m.is_correct === false && (
                    <p className="text-xs font-semibold text-orange-600">Keep trying! 💪</p>
                  )}
                </div>
              ) : (
                <p className="leading-relaxed">{m.content}</p>
              )}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-sm border border-gray-200 bg-white px-4 py-3">
              <div className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <div key={i}
                    className="h-2 w-2 rounded-full bg-gray-400 animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-100 bg-white px-4 py-3">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            disabled={sending}
            rows={2}
            placeholder={`Write a sentence using "${wordText}"…`}
            className="flex-1 resize-none rounded-2xl border border-gray-300 px-4 py-2.5 text-base outline-none focus:border-brand-500"
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || sending}
            className="self-end rounded-2xl bg-brand-500 px-4 py-2.5 font-semibold text-white transition active:scale-95 disabled:opacity-50"
          >
            Send
          </button>
        </div>
        <p className="mt-1.5 text-center text-xs text-gray-400">
          Press Enter to send · Shift+Enter for a new line
        </p>
      </div>
    </main>
  );
}