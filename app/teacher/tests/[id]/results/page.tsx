import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { releaseResults, saveTeacherComment } from "@/lib/actions/tests";

export const dynamic = "force-dynamic";

const pct = (n:number,d:number) => d>0 ? `${Math.round((n/d)*100)}%` : "—";

export default async function ResultsPage({
  params, searchParams,
}: { params:Promise<{id:string}>; searchParams:Promise<{msg?:string}> }) {
  await requireProfile("teacher");
  const { id } = await params;
  const { msg } = await searchParams;
  const supabase = await createClient();
  const admin    = createAdminClient();

  const { data: test } = await supabase
    .from("tests").select("*").eq("id",id).single();
  if (!test) notFound();

  const { data: questions } = await admin
    .from("test_questions")
    .select("id,question_type,difficulty,question_data,words(text)")
    .eq("test_id",id).order("order_index");

  const { data: assignments } = await admin
    .from("test_assignments")
    .select("id,student_id,started_at,completed_at,score_raw,score_total,results_visible,profiles!test_assignments_student_id_fkey(full_name,username)")
    .eq("test_id",id).order("completed_at");

  const qIds = (questions??[]).map(q=>q.id);
  const aIds = (assignments??[]).map(a=>a.id);

  const { data: allAnswers } = qIds.length&&aIds.length
    ? await admin.from("test_answers")
        .select("id,assignment_id,question_id,student_answer,is_correct,grammar_score,usage_score,naturalness_score,ai_feedback,teacher_score,teacher_comment")
        .in("assignment_id",aIds).in("question_id",qIds)
    : { data: [] };

  const ansMap = new Map<string,(typeof allAnswers)[0]>();
  for (const a of allAnswers??[]) ansMap.set(`${a.assignment_id}|${a.question_id}`,a);

  const completed = (assignments??[]).filter(a=>a.completed_at);
  const avgScore  = completed.length
    ? completed.reduce((s,a)=>(a.score_total?s+(a.score_raw??0)/a.score_total:s),0)/completed.length*100
    : null;

  const qMap = new Map((questions??[]).map(q=>[q.id,q]));

  return (
    <main className="mx-auto max-w-2xl p-4 pb-16">
      <header className="mb-5">
        <Link href="/teacher/tests" className="text-sm text-brand-600">← Tests</Link>
        <div className="flex items-center justify-between mt-1 gap-2">
          <h1 className="text-xl font-bold">{test.name} — Results</h1>
          <form action={releaseResults}>
            <input type="hidden" name="test_id" value={id}/>
            <button className="rounded-xl bg-green-600 px-3 py-2 text-sm font-semibold text-white">
              Release all results
            </button>
          </form>
        </div>
      </header>

      {msg && <p className="mb-4 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-700">{msg}</p>}

      {/* Class summary */}
      <div className="mb-5 grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 text-center">
          <p className="text-2xl font-extrabold text-brand-700">{completed.length}/{assignments?.length??0}</p>
          <p className="text-xs text-gray-500">Completed</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-4 text-center">
          <p className="text-2xl font-extrabold text-brand-700">{avgScore!=null?`${Math.round(avgScore)}%`:"—"}</p>
          <p className="text-xs text-gray-500">Class avg</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-4 text-center">
          <p className="text-2xl font-extrabold text-brand-700">{questions?.length??0}</p>
          <p className="text-xs text-gray-500">Questions</p>
        </div>
      </div>

      {/* Per question difficulty */}
      {completed.length>0 && (
        <div className="mb-5 rounded-2xl border border-gray-200 bg-white p-4">
          <p className="mb-3 font-semibold text-sm">Question difficulty (class performance)</p>
          <div className="grid gap-1.5">
            {(questions??[]).map((q,i) => {
              const word = Array.isArray(q.words)?q.words[0]:q.words;
              const correctCount = (allAnswers??[]).filter(a=>a.question_id===q.id&&a.is_correct).length;
              const totalAnswered = (allAnswers??[]).filter(a=>a.question_id===q.id&&a.is_correct!==null).length;
              const rate = totalAnswered>0 ? correctCount/totalAnswered : null;
              return (
                <div key={q.id} className="flex items-center gap-2 text-xs">
                  <span className="w-6 shrink-0 text-gray-400">Q{i+1}</span>
                  <span className="w-28 shrink-0 capitalize text-gray-600">
                    {q.question_type.replace(/_/g," ")} · {q.difficulty}
                  </span>
                  <div className="flex-1 rounded-full bg-gray-100 h-2">
                    <div className={`h-2 rounded-full ${rate!=null&&rate>=0.7?"bg-green-400":rate!=null&&rate>=0.4?"bg-amber-400":"bg-red-400"}`}
                      style={{width:rate!=null?`${Math.round(rate*100)}%`:"0%"}}/>
                  </div>
                  <span className="w-10 shrink-0 text-right text-gray-600">
                    {rate!=null?`${Math.round(rate*100)}%`:"—"}
                  </span>
                  <span className="text-gray-400">
                    {(word as {text?:string}|null)?.text}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Per student */}
      {(assignments??[]).map(assign => {
        const profile = Array.isArray(assign.profiles)?assign.profiles[0]:assign.profiles;
        const done = !!assign.completed_at;
        return (
          <details key={assign.id} className="mb-3 rounded-2xl border border-gray-200 bg-white">
            <summary className="cursor-pointer select-none list-none p-4 [&::-webkit-details-marker]:hidden">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="font-bold">{(profile as {full_name?:string}|null)?.full_name}</p>
                  <p className="text-sm text-gray-500">
                    {(profile as {username?:string}|null)?.username} ·{" "}
                    {done ? `Score: ${assign.score_raw??0}/${assign.score_total??0} (${pct(assign.score_raw??0,assign.score_total??0)})` : "Not completed"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {assign.results_visible
                    ? <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-bold text-green-700">Visible</span>
                    : <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">Hidden</span>
                  }
                  {!assign.results_visible && done && (
                    <form action={releaseResults}>
                      <input type="hidden" name="test_id" value={id}/>
                      <input type="hidden" name="student_id" value={assign.student_id}/>
                      <button className="rounded-lg bg-green-600 px-2.5 py-1.5 text-xs font-semibold text-white">
                        Release
                      </button>
                    </form>
                  )}
                </div>
              </div>
            </summary>

            {done && (
              <div className="border-t border-gray-100 p-4 space-y-3">
                {(questions??[]).map((q,i) => {
                  const ans = ansMap.get(`${assign.id}|${q.id}`);
                  const word = Array.isArray(q.words)?q.words[0]:q.words;
                  const d = q.question_data as Record<string,unknown>;
                  if (!ans) return null;

                  // Effective correctness: teacher override takes precedence
                  const correct = ans.teacher_score!=null ? ans.teacher_score===1 : ans.is_correct;

                  return (
                    <div key={q.id} className={
                      "rounded-xl border p-3 " + (correct ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50")
                    }>
                      <p className="text-xs font-bold text-gray-600 mb-1">
                        Q{i+1} · {q.question_type.replace(/_/g," ")} · {q.difficulty}
                        {word && ` · "${(word as {text?:string}).text}"`}
                        <span className="ml-1">{correct?"✅":"❌"}</span>
                      </p>
                      {/* Show the question */}
                      <p className="text-sm text-gray-700 mb-1">
                        {String(d.question??d.statement??d.sentence??d.instruction??"")}
                      </p>
                      {/* Student answer */}
                      <p className="text-sm font-medium">
                        Student answered: <span className={correct?"text-green-800":"text-red-800"}>
                          {ans.student_answer ?? "—"}
                        </span>
                      </p>
                      {!correct && (() => {
                        const opts = d.options as string[]|undefined;
                        const ci   = d.correct_index as number|undefined;
                        const cw   = d.correct_word as string|undefined;
                        const ca   = d.correct_answer;
                        const correct_display =
                          opts&&ci!=null ? opts[ci] :
                          cw ? cw :
                          ca!=null ? String(ca) : null;
                        return correct_display ? (
                          <p className="text-sm text-gray-600">Correct: <b>{correct_display}</b></p>
                        ) : null;
                      })()}
                      {ans.ai_feedback && (
                        <p className="text-xs text-gray-600 mt-1">AI: {ans.ai_feedback}</p>
                      )}
                      {(ans.grammar_score!=null||ans.usage_score!=null) && (
                        <div className="mt-1 flex gap-2 text-xs text-gray-500">
                          {ans.grammar_score!=null&&<span>Grammar:{Math.round(ans.grammar_score*100)}%</span>}
                          {ans.usage_score!=null&&<span>Usage:{Math.round(ans.usage_score*100)}%</span>}
                          {ans.naturalness_score!=null&&<span>Natural:{Math.round(ans.naturalness_score*100)}%</span>}
                        </div>
                      )}
                      {/* Teacher review */}
                      <form action={saveTeacherComment} className="mt-2 space-y-1.5">
                        <input type="hidden" name="answer_id" value={ans.id}/>
                        <input type="hidden" name="test_id" value={id}/>
                        <div className="flex items-center gap-2">
                          <label className="text-xs font-medium text-gray-600">Override score:</label>
                          <select name="teacher_score" defaultValue={ans.teacher_score??""} 
                            className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs">
                            <option value="">AI grade</option>
                            <option value="1">✅ Correct</option>
                            <option value="0">❌ Wrong</option>
                          </select>
                        </div>
                        <textarea name="comment" rows={2} defaultValue={ans.teacher_comment??""}
                          placeholder="Write a comment for this student…"
                          className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-xs outline-none focus:border-brand-500"/>
                        <button className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white">
                          Save
                        </button>
                      </form>
                    </div>
                  );
                })}
              </div>
            )}
          </details>
        );
      })}
    </main>
  );
}
