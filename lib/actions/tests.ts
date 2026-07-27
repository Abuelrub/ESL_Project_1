"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import Anthropic from "@anthropic-ai/sdk";

const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const MODEL = "claude-sonnet-4-5-20250929";

type QType = "true_false"|"multiple_choice"|"fill_blank"|"matching"|"write_sentence";
const LEVEL_FOR: Record<string,number> = { easy:2, medium:3, hard:4 };

// ---------- CREATE TEST ----------
export async function createTest(formData: FormData) {
  const profile = await requireProfile("teacher");
  const supabase = await createClient();

  const courseId   = String(formData.get("course_id")||"");
  const name       = String(formData.get("name")||"New Test").trim();
  const testType   = String(formData.get("test_type")||"custom");
  const showResults= String(formData.get("show_results")||"manual");
  const instructions = String(formData.get("instructions")||"").trim();

  const { data: test, error } = await supabase
    .from("tests")
    .insert({ course_id: courseId, teacher_id: profile.id, name, test_type: testType,
              show_results: showResults, instructions: instructions||null,
              composition: {}, difficulty_mix: {} })
    .select("id").single();

  if (error || !test) {
    redirect(`/teacher/tests?msg=${encodeURIComponent("Could not create test: "+(error?.message??"")+
      " — did you run migration_tests.sql?")}`);
  }
  redirect(`/teacher/tests/${test.id}/design`);
}

// ---------- GENERATE QUESTIONS WITH AI ----------
export async function generateTestQuestions(formData: FormData) {
  await requireProfile("teacher");
  const supabase = await createClient();
  const admin = createAdminClient();

  const testId   = String(formData.get("test_id")||"");
  const courseId = String(formData.get("course_id")||"");

  // ── 1. Parse question-type composition ──
  const types: QType[] = ["true_false","multiple_choice","fill_blank","matching","write_sentence"];
  const composition: Record<string,number> = {};
  for (const t of types) {
    const n = parseInt(String(formData.get(t)||"0"),10);
    if (n>0) composition[t] = n;
  }
  const total = Object.values(composition).reduce((a,b)=>a+b,0);
  if (total===0) {
    redirect(`/teacher/tests/${testId}/design?msg=`+
      encodeURIComponent("Enter at least 1 question for any type."));
  }

  // ── 2. Parse difficulty mix ──
  const difficultyMix: Record<string,number> = {};
  for (const d of ["easy","medium","hard"]) {
    const n = parseInt(String(formData.get(d)||"0"),10);
    if (n>0) difficultyMix[d] = n;
  }
  // Build a flat deck of difficulties to assign across all questions
  const diffDeck = Object.entries(difficultyMix)
    .flatMap(([d,n]) => Array(n).fill(d));
  // If teacher left difficulty blank, default to "easy" for everything
  const getDiff = (idx:number) =>
    diffDeck.length ? (diffDeck[idx % diffDeck.length] as string) : "easy";

  // ── 3. Get selected words ──
  const selectedWordIds = formData.getAll("word_ids").map(String).filter(Boolean);

  let words: {id:string; text:string; difficulty:string}[] = [];
  if (selectedWordIds.length > 0) {
    const { data } = await admin
      .from("words").select("id,text,difficulty").in("id", selectedWordIds);
    words = data ?? [];
  } else {
    // Fallback: all words in the course
    const { data: units } = await admin
      .from("units").select("id").eq("course_id",courseId);
    const { data } = await admin
      .from("words").select("id,text,difficulty")
      .in("unit_id",(units??[]).map(u=>u.id));
    words = data ?? [];
  }

  if (!words.length) {
    redirect(`/teacher/tests/${testId}/design?msg=`+
      encodeURIComponent("No words found. Add words to this course first."));
  }

  // ── 4. Build the slot list: all question slots with type + difficulty ──
  // e.g. 3 true_false + 2 fill_blank with mix easy:3, medium:2
  // → we interleave types then assign difficulties round-robin
  const slots: { qType:QType; diff:string }[] = [];
  for (const [qType, count] of Object.entries(composition)) {
    for (let i=0; i<count; i++) {
      slots.push({ qType: qType as QType, diff: getDiff(slots.length) });
    }
  }

  // ── 5. Fisher-Yates shuffle the SLOTS so question types are mixed ──
  for (let i=slots.length-1; i>0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [slots[i],slots[j]] = [slots[j],slots[i]];
  }

  // ── 6. Delete old questions for this test ──
  await admin.from("test_questions").delete().eq("test_id",testId);

  const fisherYates = <T>(a:T[]) => {
    const arr=[...a];
    for(let i=arr.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];}
    return arr;
  };

  const questions: {test_id:string;word_id:string;question_type:string;
                    difficulty:string;question_data:object;order_index:number}[] = [];

  const usedWordIds = new Set<string>();

  // ── 7. Generate each question ──
  for (let i=0; i<slots.length; i++) {
    const { qType, diff } = slots[i];

    // Pick a word — prefer not repeating, prefer matching teacher-difficulty
    const preferPool = words.filter(w =>
      !usedWordIds.has(w.id) &&
      (diff==="easy" ? w.difficulty==="easy" :
       diff==="hard" ? w.difficulty==="hard" : true)
    );
    const fallback = words.filter(w => !usedWordIds.has(w.id));
    const pool = preferPool.length ? preferPool : fallback.length ? fallback : words;
    const word = fisherYates(pool)[0];
    usedWordIds.add(word.id);

    const distractors = fisherYates(words.filter(w=>w.id!==word.id))
      .slice(0,6).map(w=>w.text);
    const level = LEVEL_FOR[diff] ?? 2;

    try {
      const qData = await generateOneQuestion(qType, word.text, level, distractors);
      questions.push({
        test_id:testId, word_id:word.id, question_type:qType,
        difficulty:diff, question_data:qData, order_index:i,
      });
    } catch { /* skip this slot */ }
  }

  if (questions.length > 0) {
    await admin.from("test_questions").insert(questions);
  }

  await supabase.from("tests")
    .update({ composition, difficulty_mix:difficultyMix }).eq("id",testId);

  revalidatePath(`/teacher/tests/${testId}/design`);
  redirect(`/teacher/tests/${testId}/design?msg=`+
    encodeURIComponent(
      `Generated ${questions.length} of ${total} questions — types shuffled randomly. Review and approve.`
    ));
}

async function generateOneQuestion(type:QType, word:string, level:number, distractors:string[]) {
  const schemas: Record<QType,string> = {
    true_false:    `{"statement":"...","correct_answer":true,"explanation":"...","hint":"..."}`,
    multiple_choice:`{"question":"What does '${word}' mean?","options":["opt1","opt2","opt3","opt4"],"correct_index":0,"explanation":"...","hint":"..."}`,
    fill_blank:    `{"sentence":"A sentence with ___ where the word goes.","options":["${word}","w2","w3","w4"],"correct_word":"${word}","explanation":"...","hint":"..."}`,
    matching:      `{"pairs":[{"word":"${word}","definition":"..."},{"word":"other1","definition":"..."},{"word":"other2","definition":"..."}],"explanation":"...","hint":"..."}`,
    write_sentence:`{"instruction":"Write a sentence using the word '${word}'.","hint":"Think about what ${word} means."}`,
  };
  const desiredBool = Math.random()<0.5;
  const typeNote = type==="true_false"
    ? `The statement MUST be ${desiredBool}. Set correct_answer to ${desiredBool}.`
    : type==="fill_blank"
    ? `Wrong options must come from: ${distractors.join(", ")}.`
    : type==="matching"
    ? `Other words: ${distractors.slice(0,2).join(", ")}.`
    : "";

  const prompt = `Create ONE vocabulary test question for a Novice 2 ESL student.
Word: "${word}", Type: ${type}, Level: ${level}/5
${typeNote}
Simple English only. Respond with ONLY this JSON: ${schemas[type]}`;

  const res = await ai.messages.create({
    model:MODEL, max_tokens:400,
    messages:[{role:"user",content:prompt}]
  });
  const text = res.content.filter(b=>b.type==="text").map(b=>(b as {text:string}).text).join("");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("No JSON");
  const data = JSON.parse(m[0]);

  // Server-side shuffle for MC and fill_blank
  if ((type==="multiple_choice"||type==="fill_blank") && Array.isArray(data.options)) {
    const opts = data.options as string[];
    const correctVal = type==="multiple_choice" ? opts[data.correct_index] : data.correct_word;
    for (let i=opts.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[opts[i],opts[j]]=[opts[j],opts[i]];}
    if (type==="multiple_choice") data.correct_index = opts.indexOf(correctVal);
    else data.correct_word = correctVal;
  }
  return data;
}

// ---------- APPROVE TEST ----------
export async function approveTest(formData: FormData) {
  await requireProfile("teacher");
  const supabase = await createClient();
  const testId = String(formData.get("test_id")||"");

  await supabase.from("tests")
    .update({ status:"approved", approved_at:new Date().toISOString() })
    .eq("id",testId);
  revalidatePath(`/teacher/tests/${testId}/design`);
  redirect(`/teacher/tests/${testId}/assign?msg=`+encodeURIComponent("Test approved! Now assign it to students."));
}

// ---------- ACTIVATE / ASSIGN ----------
export async function assignTest(formData: FormData) {
  await requireProfile("teacher");
  const admin = createAdminClient();
  const testId     = String(formData.get("test_id")||"");
  const studentIds = formData.getAll("student_ids").map(String).filter(Boolean);

  if (studentIds.length===0) {
    redirect(`/teacher/tests/${testId}/assign?msg=`+encodeURIComponent("Select at least one student."));
  }

  await admin.from("tests").update({status:"active"}).eq("id",testId);

  const rows = studentIds.map(sid=>({ test_id:testId, student_id:sid, results_visible:false }));
  await admin.from("test_assignments").upsert(rows,{onConflict:"test_id,student_id"});

  revalidatePath(`/teacher/tests`);
  redirect(`/teacher/tests/${testId}/results?msg=`+
    encodeURIComponent(`Test is live for ${studentIds.length} student(s).`));
}

// ---------- RELEASE RESULTS (per student or all) ----------
export async function releaseResults(formData: FormData) {
  await requireProfile("teacher");
  const admin = createAdminClient();
  const testId    = String(formData.get("test_id")||"");
  const studentId = String(formData.get("student_id")||"");

  if (studentId) {
    await admin.from("test_assignments")
      .update({results_visible:true})
      .eq("test_id",testId).eq("student_id",studentId);
  } else {
    await admin.from("test_assignments")
      .update({results_visible:true}).eq("test_id",testId);
  }
  revalidatePath(`/teacher/tests/${testId}/results`);
  redirect(`/teacher/tests/${testId}/results?msg=`+encodeURIComponent("Results released."));
}

// ---------- SAVE TEACHER COMMENT/SCORE ----------
export async function saveTeacherComment(formData: FormData) {
  await requireProfile("teacher");
  const supabase = await createClient();
  const answerId      = String(formData.get("answer_id")||"");
  const comment       = String(formData.get("comment")||"").trim();
  const teacherScore  = formData.get("teacher_score");

  const update: Record<string,unknown> = { teacher_comment: comment||null };
  if (teacherScore!==null && teacherScore!=="") update.teacher_score = Number(teacherScore);

  await supabase.from("test_answers").update(update).eq("id",answerId);

  const testId = String(formData.get("test_id")||"");
  revalidatePath(`/teacher/tests/${testId}/results`);
  redirect(`/teacher/tests/${testId}/results?msg=`+encodeURIComponent("Comment saved."));
}

// ---------- CLOSE TEST ----------
export async function closeTest(formData: FormData) {
  await requireProfile("teacher");
  const supabase = await createClient();
  const testId = String(formData.get("test_id")||"");
  await supabase.from("tests").update({status:"closed"}).eq("id",testId);
  revalidatePath(`/teacher/tests`);
  redirect(`/teacher/tests?msg=`+encodeURIComponent("Test closed."));
}

// ---------- CREATE + GENERATE IN ONE STEP (used by the all-in-one form) ----------
export async function createAndGenerate(formData: FormData) {
  const profile = await requireProfile("teacher");
  const supabase = await createClient();
  const admin = createAdminClient();

  // ── 1. Create the test record ──
  const name         = String(formData.get("name") || "New Test").trim();
  const testType     = String(formData.get("test_type") || "custom");
  const showResults  = String(formData.get("show_results") || "manual");
  const instructions = String(formData.get("instructions") || "").trim();
  const courseId     = String(formData.get("course_id") || "");

  if (!courseId) {
    redirect("/teacher/tests?msg=" + encodeURIComponent("Please choose a course."));
  }

  // ── 2. Parse composition ──
  const types: QType[] = ["true_false","multiple_choice","fill_blank","matching","write_sentence"];
  const composition: Record<string,number> = {};
  for (const t of types) {
    const n = parseInt(String(formData.get(t) || "0"), 10);
    if (n > 0) composition[t] = n;
  }
  const total = Object.values(composition).reduce((a, b) => a + b, 0);
  if (total === 0) {
    redirect("/teacher/tests?msg=" + encodeURIComponent("Enter at least 1 question for any type."));
  }

  const difficultyMix: Record<string,number> = {};
  for (const d of ["easy","medium","hard"]) {
    const n = parseInt(String(formData.get(d) || "0"), 10);
    if (n > 0) difficultyMix[d] = n;
  }

  // ── 3. Insert the test ──
  const { data: test, error: testErr } = await admin
    .from("tests")
    .insert({
      course_id: courseId,
      teacher_id: profile.id,
      name,
      test_type: testType,
      show_results: showResults,
      instructions: instructions || null,
      composition,
      difficulty_mix: difficultyMix,
      status: "draft",
    })
    .select("id")
    .single();

  if (testErr || !test) {
    redirect("/teacher/tests?msg=" + encodeURIComponent(
      "Could not create test: " + (testErr?.message ?? "unknown") +
      " — did you run migration_tests.sql and the RLS fix?"
    ));
  }

  const testId = test.id;

  // ── 4. Get selected words ──
  const selectedWordIds = formData.getAll("word_ids").map(String).filter(Boolean);
  let words: {id:string; text:string; difficulty:string}[] = [];
  if (selectedWordIds.length > 0) {
    const { data } = await admin
      .from("words").select("id,text,difficulty").in("id", selectedWordIds);
    words = data ?? [];
  } else {
    const { data: units } = await admin
      .from("units").select("id").eq("course_id", courseId);
    const { data } = await admin
      .from("words").select("id,text,difficulty")
      .in("unit_id", (units ?? []).map(u => u.id));
    words = data ?? [];
  }

  if (!words.length) {
    redirect("/teacher/tests?msg=" + encodeURIComponent("No words found. Add words to this course first."));
  }

  // ── 5. Build slots and shuffle ──
  const diffDeck = Object.entries(difficultyMix)
    .flatMap(([d, n]) => Array(n).fill(d));
  const getDiff = (idx: number) =>
    diffDeck.length ? (diffDeck[idx % diffDeck.length] as string) : "easy";

  const slots: { qType: QType; diff: string }[] = [];
  for (const [qType, count] of Object.entries(composition)) {
    for (let i = 0; i < count; i++) {
      slots.push({ qType: qType as QType, diff: getDiff(slots.length) });
    }
  }

  // Fisher-Yates shuffle
  const fisherYates = <T>(a: T[]) => {
    const arr = [...a];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };
  const shuffledSlots = fisherYates(slots);

  // ── 6. Generate questions ──
  const questions: {test_id:string; word_id:string; question_type:string;
                    difficulty:string; question_data:object; order_index:number}[] = [];
  const usedWordIds = new Set<string>();

  for (let i = 0; i < shuffledSlots.length; i++) {
    const { qType, diff } = shuffledSlots[i];
    const preferPool = words.filter(w =>
      !usedWordIds.has(w.id) &&
      (diff === "easy" ? w.difficulty === "easy" :
       diff === "hard" ? w.difficulty === "hard" : true)
    );
    const fallback = words.filter(w => !usedWordIds.has(w.id));
    const pool = preferPool.length ? preferPool : fallback.length ? fallback : words;
    const word = fisherYates(pool)[0];
    usedWordIds.add(word.id);

    const distractors = fisherYates(words.filter(w => w.id !== word.id))
      .slice(0, 6).map(w => w.text);
    const level = LEVEL_FOR[diff] ?? 2;

    try {
      const qData = await generateOneQuestion(qType, word.text, level, distractors);
      questions.push({
        test_id: testId, word_id: word.id, question_type: qType,
        difficulty: diff, question_data: qData, order_index: i,
      });
    } catch { /* skip this slot */ }
  }

  if (questions.length > 0) {
    await admin.from("test_questions").insert(questions);
  }

  revalidatePath("/teacher/tests");
  redirect("/teacher/tests?msg=" + encodeURIComponent(
    `✅ Test "${name}" created with ${questions.length} questions — shuffled randomly. Review below, then approve.`
  ));
}
