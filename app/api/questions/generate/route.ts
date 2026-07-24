import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  DEFAULT_QUIZ_QUESTIONS, WordCandidate, effectiveLevel, pickQuestionType,
  pickWord, shuffleWithMap, startingLevel,
} from "@/lib/adaptive";
import { generateQuestion } from "@/lib/ai";

export const maxDuration = 30;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const { session_id } = await request.json();
  const admin = createAdminClient();

  const { data: session } = await admin
    .from("practice_sessions")
    .select("id, student_id, unit_id, course_id, total_questions, correct_answers")
    .eq("id", session_id)
    .single();

  if (!session || session.student_id !== user.id) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const { data: askedRows } = await admin
    .from("questions")
    .select("id, word_id, is_correct, answered_at, created_at")
    .eq("session_id", session_id)
    .order("created_at");

  // Course settings: quiz length
  const { data: course } = await admin
    .from("courses").select("id, quiz_questions").eq("id", session.course_id).single();
  const quizLength = course?.quiz_questions ?? DEFAULT_QUIZ_QUESTIONS;

  const asked = askedRows ?? [];
  if (asked.length >= quizLength) {
    await admin
      .from("practice_sessions")
      .update({ completed_at: new Date().toISOString() })
      .eq("id", session_id);
    return NextResponse.json({
      done: true,
      total: session.total_questions,
      correct: session.correct_answers,
    });
  }

  // ---------- STREAK: consecutive correct answers, most recent first ----------
  const answered = asked
    .filter((q) => q.answered_at)
    .sort((a, b) => (a.answered_at! < b.answered_at! ? -1 : 1));
  let streak = 0;
  for (let i = answered.length - 1; i >= 0; i--) {
    if (answered[i].is_correct) streak++;
    else break;
  }

  // ---------- WORD POOL: current unit + all earlier units, honoring per-part assignments ----------
  const { data: units } = await admin
    .from("units")
    .select("id, order_index, part1_assigned, part2_assigned")
    .eq("course_id", session.course_id)
    .order("order_index");

  const currentUnit = (units ?? []).find((u) => u.id === session.unit_id);
  if (!currentUnit) return NextResponse.json({ error: "Unit missing" }, { status: 404 });

  // The current unit must have at least one part assigned
  if (!currentUnit.part1_assigned && !currentUnit.part2_assigned) {
    return NextResponse.json(
      { error: "This unit is not assigned yet by your teacher" }, { status: 403 });
  }

  const allowedUnitIds = (units ?? [])
    .filter((u) => u.order_index <= currentUnit.order_index)
    .map((u) => u.id);
  const unitById = new Map((units ?? []).map((u) => [u.id, u]));

  const { data: allWords } = await admin
    .from("words")
    .select("id, text, difficulty, unit_id, part")
    .in("unit_id", allowedUnitIds);

  // PART GATE: for each unit, include only parts that are currently assigned
  const words = (allWords ?? []).filter((w) => {
    const u = unitById.get(w.unit_id);
    if (!u) return false;
    const p = w.part ?? 1;
    return p === 1 ? !!u.part1_assigned : !!u.part2_assigned;
  });

  if (words.length === 0) {
    return NextResponse.json({ error: "No assigned words yet in this unit" }, { status: 400 });
  }

  const { data: progress } = await admin
    .from("word_progress")
    .select("word_id, practice_count, current_level")
    .eq("student_id", user.id)
    .in("word_id", words.map((w) => w.id));

  const progressMap = new Map((progress ?? []).map((p) => [p.word_id, p]));

  const unitOrder = new Map((units ?? []).map((u) => [u.id, u.order_index]));
  const wordPart = new Map(words.map((w) => [w.id, w.part ?? 1]));

  const candidates: WordCandidate[] = words.map((w) => {
    const p = progressMap.get(w.id);
    return {
      id: w.id,
      text: w.text,
      difficulty: w.difficulty as "easy" | "hard",
      unit_id: w.unit_id,
      isCurrentUnit: w.unit_id === session.unit_id,
      practice_count: p?.practice_count ?? 0,
      current_level: p?.current_level ?? startingLevel(w.difficulty as "easy" | "hard"),
    };
  });

  const usedIds = new Set(asked.map((q) => q.word_id));
  const word = pickWord(candidates, usedIds);
  if (!word) return NextResponse.json({ error: "No words available" }, { status: 400 });

  // ---------- LEVEL = word base level + streak bonus ----------
  const level = effectiveLevel(word.current_level, streak);
  const type = pickQuestionType(level);
  const desiredBool = Math.random() < 0.5; // balanced true/false

  const reviewNote = word.isCurrentUnit
    ? "This word is from the student's CURRENT unit."
    : "This is a REVIEW word from a previous unit — help the student remember it.";

  const distractors = candidates
    .filter((c) => c.id !== word.id)
    .map((c) => c.text)
    .sort(() => Math.random() - 0.5)
    .slice(0, 6);

  // CONTEXT REINFORCEMENT: previously learned words (earlier units, or earlier
  // part of the same unit) get woven INTO the question sentences — never as answers
  const wOrder = unitOrder.get(word.unit_id) ?? 0;
  const wPart = wordPart.get(word.id) ?? 1;
  const contextWords = candidates
    .filter((c) => {
      if (c.id === word.id) return false;
      const cOrder = unitOrder.get(c.unit_id) ?? 0;
      const cPart = wordPart.get(c.id) ?? 1;
      return cOrder < wOrder || (cOrder === wOrder && cPart < wPart);
    })
    .filter((c) => c.practice_count > 0)
    .map((c) => c.text)
    .sort(() => Math.random() - 0.5)
    .slice(0, 4);

  // WORD FORMS: at level 4+, fill-in-the-blank tests grammatical forms
  // of the word itself (bright / brighter / brightly / brightness)
  const useWordForms = type === "fill_blank" && level >= 4;

  let qData: Record<string, unknown>;
  try {
    qData = await generateQuestion(type, word.text, level, reviewNote, distractors, desiredBool, contextWords, useWordForms);
  } catch {
    return NextResponse.json({ error: "AI could not generate a question, try again" }, { status: 502 });
  }

  // ---------- SERVER-SIDE SHUFFLE (removes answer-position bias) ----------
  if (type === "multiple_choice" || type === "sentence_completion") {
    const options = qData.options as string[];
    const { shuffled, newIndexOf } = shuffleWithMap(options);
    qData.options = shuffled;
    qData.correct_index = newIndexOf[Number(qData.correct_index)];
  } else if (type === "fill_blank") {
    const { shuffled } = shuffleWithMap(qData.options as string[]);
    qData.options = shuffled;
  } else if (type === "multi_select") {
    const options = qData.options as string[];
    const { shuffled, newIndexOf } = shuffleWithMap(options);
    qData.options = shuffled;
    qData.correct_indices = (qData.correct_indices as number[]).map((i) => newIndexOf[i]);
  } else if (type === "matching") {
    // Shuffle definitions; def_map[k] = index of the word that definition k belongs to
    const pairs = qData.pairs as { word: string; definition: string }[];
    const defs = pairs.map((p) => p.definition);
    const { shuffled, newIndexOf } = shuffleWithMap(defs);
    const defMap: number[] = [];
    pairs.forEach((_, wordIdx) => { defMap[newIndexOf[wordIdx]] = wordIdx; });
    qData.shuffled_definitions = shuffled;
    qData.def_map = defMap;
  }

  const { data: saved, error: saveErr } = await admin
    .from("questions")
    .insert({
      session_id,
      student_id: user.id,
      word_id: word.id,
      question_type: type,
      difficulty_level: level,
      question_data: qData,
    })
    .select("id")
    .single();

  if (saveErr || !saved) {
    return NextResponse.json({ error: "Could not save question" }, { status: 500 });
  }

  // ---------- SANITIZE: never send correct answers to the browser ----------
  const publicData: Record<string, unknown> = { ...qData };
  delete publicData.correct_index;
  delete publicData.correct_answer;
  delete publicData.correct_word;
  delete publicData.correct_indices;
  delete publicData.explanation;
  delete publicData.def_map;
  if (type === "matching") {
    const pairs = qData.pairs as { word: string; definition: string }[];
    publicData.words = pairs.map((p) => p.word);
    publicData.definitions = qData.shuffled_definitions;
    delete publicData.pairs;
    delete publicData.shuffled_definitions;
  }

  return NextResponse.json({
    question_id: saved.id,
    number: asked.length + 1,
    total: quizLength,
    type,
    level,
    word: word.text,
    is_review: !word.isCurrentUnit,
    streak,
    data: publicData,
  });
}
