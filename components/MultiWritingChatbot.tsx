"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  word_results?: Record<string, boolean>;
  grammar_correction?: string;
  improved_sentence?: string;
}

type Screen = "loading" | "chat" | "done" | "error";
const SENTENCES_PER_SESSION = 5;

export default function MultiWritingChatbot({
  unitId, unitName, wordIds,
}: {
  unitId: string; unitName: string; wordIds: string[];
}) {
  const [screen, setScreen] = useState<Screen>("loading");
  const [sessionIds, setSessionIds] = useState<string[]>([]);
  const [words, setWords] = useState<string[]>([]);
  const [resolvedWordIds, setResolvedWordIds] = useState<string[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [turn, setTurn] = useState(1);
  const [errorMsg, setErrorMsg] = useState("");
  const startedRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    (async () => {
      try {
        const res = await fetch("/api/writing/multi-start", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ unit_id: unitId, word_ids: wordIds }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not start");
        setSessionIds(data.session_ids);
        setWords(data.words);
        setResolvedWordIds(data.word_ids);

        const wordList = data.words.join('", "');
        setMessages([{
          role: "assistant",
          content: `Hello! 😊 Let's practice using multiple words together!\n\nYour challenge: write **ONE sentence** using ALL of these words:\n\n${data.words.map((w: string) => `🔹 **"${w}"**`).join("\n")}\n\nThis is a great way to show you really understand each word. Try your best!`,
        }]);
        setScreen("chat");
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : "Could not start");
        setScreen("error");
      }
    })();
  }, [unitId, wordIds]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || sending) return;
    const sentence = input.trim();
    setInput("");
    setSending(true);

    const userMsg: ChatMessage = { role: "user", content: sentence };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const res = await fetch("/api/writing/multi-message", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_ids: sessionIds,
          word_ids: resolvedWordIds,
          words,
          sentence,
          history: messages.map((m) => ({ role: m.role, content: m.content })),
          turn,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error");

      setMessages((prev) => [...prev, {
        role: "assistant",
        content: data.ai_message,
        word_results: data.word_results,
        grammar_correction: data.grammar_correction,
        improved_sentence: data.improved_sentence,
      }]);
      setTurn(data.turn);
      if (data.is_done) setScreen("done");
    } catch (e) {
      setMessages((prev) => [...prev, {
        role: "assistant",
        content: "⚠️ " + (e instanceof Error ? e.message : "Error"),
      }]);
    }
    setSending(false);
  }, [input, sending, sessionIds, resolvedWordIds, words, messages, turn]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  if (screen === "loading") return (
    <main className="flex min-h-dvh flex-col items-center justify-center p-4">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-purple-500"/>
      <p className="mt-4 text-gray-500">Starting multi-word writing session…</p>
    </main>
  );

  if (screen === "error") return (
    <main className="flex min-h-dvh flex-col items-center justify-center p-4 text-center">
      <p className="text-3xl mb-2">😕</p>
      <p className="text-gray-600 mb-4">{errorMsg}</p>
      <Link href={`/student/writing/${unitId}`}
        className="rounded-xl bg-purple-500 px-5 py-3 font-semibold text-white">
        Back to words
      </Link>
    </main>
  );

  if (screen === "done") return (
    <main className="flex min-h-dvh flex-col items-center justify-center p-6 text-center max-w-lg mx-auto">
      <p className="text-5xl mb-3">🎉</p>
      <h1 className="text-2xl font-extrabold mb-2">Session complete!</h1>
      <div className="mb-4 flex flex-wrap justify-center gap-2">
        {words.map((w) => (
          <span key={w} className="rounded-full bg-purple-100 px-3 py-1 text-sm font-semibold text-purple-700">
            {w}
          </span>
        ))}
      </div>
      <p className="text-gray-600 mb-6">
        Great work combining {words.length} words in your sentences!
      </p>
      <div className="flex gap-2 flex-wrap justify-center">
        <Link href={`/student/writing/${unitId}`}
          className="rounded-xl bg-purple-500 px-5 py-3 font-semibold text-white">
          Practice other words
        </Link>
        <Link href="/student"
          className="rounded-xl border border-gray-300 bg-white px-5 py-3 font-semibold">
          🏠 Home
        </Link>
      </div>
    </main>
  );

  return (
    <main className="flex min-h-dvh max-w-lg flex-col mx-auto">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-gray-100 bg-white px-4 py-3">
        <Link href={`/student/writing/${unitId}`} className="text-sm text-gray-500">✕</Link>
        <div className="text-center">
          <p className="text-sm font-bold">✍️ Multi-word challenge</p>
          <p className="text-xs text-gray-400">{unitName}</p>
        </div>
        <div className="text-right">
          <p className="text-xs font-semibold text-purple-600">{turn - 1}/{SENTENCES_PER_SESSION}</p>
          <p className="text-xs text-gray-400">sentences</p>
        </div>
      </header>

      {/* Progress bar */}
      <div className="h-1.5 bg-gray-100">
        <div className="h-1.5 bg-gradient-to-r from-purple-500 to-pink-500 transition-all"
          style={{ width: `${((turn - 1) / SENTENCES_PER_SESSION) * 100}%` }}/>
      </div>

      {/* Word chips */}
      <div className="flex flex-wrap gap-1.5 bg-purple-50 px-4 py-2.5 border-b border-purple-100">
        <span className="text-xs font-medium text-purple-600 mr-1">Use all:</span>
        {words.map((w) => (
          <span key={w}
            className="rounded-full bg-purple-500 px-2.5 py-0.5 text-xs font-bold text-white">
            {w}
          </span>
        ))}
      </div>

      {/* Chat */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={"flex " + (m.role === "user" ? "justify-end" : "justify-start")}>
            <div className={
              "max-w-[85%] rounded-2xl px-4 py-3 text-sm " +
              (m.role === "user"
                ? "rounded-br-sm bg-purple-500 text-white"
                : "rounded-bl-sm border border-gray-200 bg-white text-gray-800")
            }>
              {m.role === "assistant" ? (
                <div className="space-y-2">
                  <p className="whitespace-pre-wrap leading-relaxed">
                    {m.content.split(/(\*\*[^*]+\*\*)/).map((part, j) =>
                      part.startsWith("**") && part.endsWith("**")
                        ? <b key={j}>{part.slice(2, -2)}</b>
                        : <span key={j}>{part}</span>
                    )}
                  </p>
                  {/* Per-word results */}
                  {m.word_results && Object.keys(m.word_results).length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {Object.entries(m.word_results).map(([w, ok]) => (
                        <span key={w}
                          className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                            ok ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                          }`}>
                          {ok ? "✅" : "❌"} {w}
                        </span>
                      ))}
                    </div>
                  )}
                  {m.grammar_correction && (
                    <div className="rounded-xl bg-orange-50 px-3 py-2">
                      <p className="text-xs font-bold text-orange-700">✏️ Correction:</p>
                      <p className="text-xs text-orange-800 italic">{m.grammar_correction}</p>
                    </div>
                  )}
                  {m.improved_sentence && (
                    <div className="rounded-xl bg-blue-50 px-3 py-2">
                      <p className="text-xs font-bold text-blue-700">💡 Improved:</p>
                      <p className="text-xs text-blue-800 italic">{m.improved_sentence}</p>
                    </div>
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
                {[0,1,2].map((i) => (
                  <div key={i} className="h-2 w-2 rounded-full bg-gray-400 animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }}/>
                ))}
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef}/>
      </div>

      {/* Input */}
      <div className="border-t border-gray-100 bg-white px-4 py-3">
        <div className="flex gap-2">
          <textarea value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey} disabled={sending} rows={2}
            placeholder={`Use all ${words.length} words in one sentence…`}
            className="flex-1 resize-none rounded-2xl border border-gray-300 px-4 py-2.5 text-base outline-none focus:border-purple-500"/>
          <button onClick={sendMessage} disabled={!input.trim() || sending}
            className="self-end rounded-2xl bg-purple-500 px-4 py-2.5 font-semibold text-white transition active:scale-95 disabled:opacity-50">
            Send
          </button>
        </div>
        <p className="mt-1.5 text-center text-xs text-gray-400">
          Enter to send · Shift+Enter for new line
        </p>
      </div>
    </main>
  );
}
