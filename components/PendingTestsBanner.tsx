"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface TestItem {
  id: string;
  test_name: string;
  test_type: string;
  status: "pending" | "results_ready";
  score_pct?: number;
}

export default function PendingTestsBanner({ studentId }: { studentId: string }) {
  const [items, setItems] = useState<TestItem[]>([]);

  useEffect(() => {
    fetch("/api/student/pending-tests")
      .then((r) => r.json())
      .then((d) => setItems(d.items ?? []))
      .catch(() => {});
  }, [studentId]);

  if (items.length === 0) return null;

  const pending = items.filter((i) => i.status === "pending");
  const ready   = items.filter((i) => i.status === "results_ready");

  return (
    <div className="mb-5 space-y-3">
      {pending.length > 0 && (
        <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
          <p className="mb-2 font-bold text-amber-800">
            📋 {pending.length} test{pending.length > 1 ? "s" : ""} waiting for you!
          </p>
          <div className="grid gap-2">
            {pending.map((t) => (
              <Link key={t.id} href={`/student/tests/${t.id}`}
                className="flex items-center justify-between rounded-xl bg-white px-4 py-3 shadow-sm transition hover:shadow">
                <div>
                  <p className="font-semibold text-gray-800">{t.test_name}</p>
                  <p className="text-xs capitalize text-gray-500">{t.test_type}</p>
                </div>
                <span className="rounded-xl bg-amber-400 px-3 py-1.5 text-xs font-bold text-white">
                  Start →
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {ready.length > 0 && (
        <div className="rounded-2xl border-2 border-green-300 bg-green-50 p-4">
          <p className="mb-2 font-bold text-green-800">
            🎉 {ready.length} test result{ready.length > 1 ? "s" : ""} available!
          </p>
          <div className="grid gap-2">
            {ready.map((t) => (
              <Link key={t.id} href={`/student/tests/${t.id}/results`}
                className="flex items-center justify-between rounded-xl bg-white px-4 py-3 shadow-sm transition hover:shadow">
                <div>
                  <p className="font-semibold text-gray-800">{t.test_name}</p>
                  <p className="text-xs capitalize text-gray-500">{t.test_type}</p>
                </div>
                <div className="text-right">
                  {t.score_pct != null && (
                    <p className={`text-xl font-extrabold ${
                      t.score_pct >= 80 ? "text-green-600" :
                      t.score_pct >= 60 ? "text-amber-600" : "text-indigo-600"
                    }`}>{t.score_pct}%</p>
                  )}
                  <p className="text-xs font-semibold text-green-700">See results →</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <Link href="/student/tests"
        className="block text-center text-xs text-gray-400 hover:text-gray-600 hover:underline underline-offset-2">
        See all my tests →
      </Link>
    </div>
  );
}
