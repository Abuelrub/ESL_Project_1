"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// All these actions use the teacher's own session, so Row Level Security
// guarantees a teacher can only touch courses/units/words in their own classes.

function back(courseId: string, msg?: string) {
  revalidatePath(`/teacher/courses/${courseId}`);
  redirect(`/teacher/courses/${courseId}` + (msg ? `?msg=${encodeURIComponent(msg)}` : ""));
}

// ---------- CREATE UNIT ----------
export async function createUnit(formData: FormData) {
  await requireProfile("teacher");
  const supabase = await createClient();

  const courseId = String(formData.get("course_id") || "");
  const name = String(formData.get("name") || "").trim();
  if (!courseId || !name) back(courseId, "Enter a unit name.");

  const { count } = await supabase
    .from("units")
    .select("*", { count: "exact", head: true })
    .eq("course_id", courseId);

  const { error } = await supabase
    .from("units")
    .insert({ course_id: courseId, name, order_index: count ?? 0 });

  back(courseId, error ? `Could not create unit: ${error.message}` : `Unit "${name}" created.`);
}

// ---------- ADD ONE WORD ----------
export async function createWord(formData: FormData) {
  await requireProfile("teacher");
  const supabase = await createClient();

  const courseId = String(formData.get("course_id") || "");
  const unitId = String(formData.get("unit_id") || "");
  const text = String(formData.get("text") || "").trim().toLowerCase();
  const difficulty = formData.get("difficulty") === "hard" ? "hard" : "easy";
  const part = Number(formData.get("part")) === 2 ? 2 : 1;
  if (!unitId || !text) back(courseId, "Enter a word.");

  const { error } = await supabase.from("words").insert({ unit_id: unitId, text, difficulty, part });
  back(courseId, error ? `Could not add word: ${error.message}` : `Added "${text}".`);
}

// ---------- BULK ADD WORDS ----------
export async function bulkAddWords(formData: FormData) {
  await requireProfile("teacher");
  const supabase = await createClient();

  const courseId = String(formData.get("course_id") || "");
  const unitId = String(formData.get("unit_id") || "");
  const blob = String(formData.get("words") || "");
  const difficulty = formData.get("difficulty") === "hard" ? "hard" : "easy";

  const words = Array.from(
    new Set(
      blob
        .split(/[\n,]/)
        .map((w) => w.trim().toLowerCase())
        .filter((w) => w.length > 0)
    )
  );
  const part = Number(formData.get("part")) === 2 ? 2 : 1;
  if (!unitId || words.length === 0) back(courseId, "Paste at least one word.");

  const rows = words.map((text) => ({ unit_id: unitId, text, difficulty, part }));
  const { error } = await supabase.from("words").insert(rows);

  back(
    courseId,
    error
      ? `Could not add words: ${error.message}`
      : `Added ${words.length} word(s) as "${difficulty}".`
  );
}

// ---------- TOGGLE EASY / HARD ----------
export async function toggleWordDifficulty(formData: FormData) {
  await requireProfile("teacher");
  const supabase = await createClient();

  const courseId = String(formData.get("course_id") || "");
  const wordId = String(formData.get("word_id") || "");
  const current = String(formData.get("current") || "easy");
  const next = current === "easy" ? "hard" : "easy";

  await supabase.from("words").update({ difficulty: next }).eq("id", wordId);
  back(courseId);
}

// ---------- DELETE WORD ----------
export async function deleteWord(formData: FormData) {
  await requireProfile("teacher");
  const supabase = await createClient();

  const courseId = String(formData.get("course_id") || "");
  const wordId = String(formData.get("word_id") || "");

  await supabase.from("words").delete().eq("id", wordId);
  back(courseId, "Word deleted.");
}

// ---------- DELETE UNIT ----------
export async function deleteUnit(formData: FormData) {
  await requireProfile("teacher");
  const supabase = await createClient();

  const courseId = String(formData.get("course_id") || "");
  const unitId = String(formData.get("unit_id") || "");

  await supabase.from("units").delete().eq("id", unitId);
  back(courseId, "Unit deleted.");
}


// ---------- MOVE WORD BETWEEN PART 1 AND PART 2 ----------
export async function moveWordPart(formData: FormData) {
  await requireProfile("teacher");
  const supabase = await createClient();

  const courseId = String(formData.get("course_id") || "");
  const wordId = String(formData.get("word_id") || "");
  const current = Number(formData.get("current_part")) === 2 ? 2 : 1;

  await supabase.from("words").update({ part: current === 1 ? 2 : 1 }).eq("id", wordId);
  back(courseId);
}

// ---------- SET THE CURRENT ASSIGNMENT (unit + part) ----------
export async function assignPart(formData: FormData) {
  await requireProfile("teacher");
  const supabase = await createClient();

  const courseId = String(formData.get("course_id") || "");
  const unitId = String(formData.get("unit_id") || "");
  const part = Number(formData.get("part")) === 2 ? 2 : 1;

  const { error } = await supabase
    .from("courses")
    .update({ active_unit_id: unitId, active_part: part })
    .eq("id", courseId);

  back(courseId, error
    ? `Could not set assignment: ${error.message} — did you run migration_parts_assignment.sql?`
    : `📌 Assignment updated: students now work up to Part ${part} of this unit.`);
}

// ---------- SET QUIZ LENGTH ----------
export async function updateQuizCount(formData: FormData) {
  await requireProfile("teacher");
  const supabase = await createClient();

  const courseId = String(formData.get("course_id") || "");
  const n = Math.min(20, Math.max(3, Number(formData.get("quiz_questions")) || 5));

  const { error } = await supabase
    .from("courses").update({ quiz_questions: n }).eq("id", courseId);

  back(courseId, error
    ? `Could not save: ${error.message} — did you run migration_parts_assignment.sql?`
    : `Quiz length set to ${n} questions.`);
}


// ---------- CREATE COURSE (teacher, own class only via RLS) ----------
export async function createTeacherCourse(formData: FormData) {
  await requireProfile("teacher");
  const supabase = await createClient();

  const classId = String(formData.get("class_id") || "");
  const name = String(formData.get("name") || "").trim();
  if (!classId || !name) redirect("/teacher");

  const { error } = await supabase.from("courses").insert({ class_id: classId, name });
  revalidatePath("/teacher");
  redirect("/teacher" + (error ? `?msg=${encodeURIComponent("Could not create course: " + error.message)}` : ""));
}
