"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

function toEmail(username: string) {
  return `${username.trim().toLowerCase()}@esl.local`;
}

// ---------- CREATE TEACHER ----------
export async function createTeacher(formData: FormData) {
  await requireProfile("admin");
  const admin = createAdminClient();

  const username = String(formData.get("username") || "").trim();
  const fullName = String(formData.get("full_name") || "").trim();
  const password = String(formData.get("password") || "");

  if (!username || !fullName || password.length < 6) {
    redirect("/admin/teachers?msg=" + encodeURIComponent("Fill all fields. Password needs 6+ characters."));
  }

  const { error } = await admin.auth.admin.createUser({
    email: toEmail(username),
    password,
    email_confirm: true,
    user_metadata: { username, full_name: fullName, role: "teacher" },
  });

  const msg = error
    ? `Could not create teacher: ${error.message}`
    : `Teacher "${fullName}" created. Username: ${username}`;

  revalidatePath("/admin/teachers");
  redirect("/admin/teachers?msg=" + encodeURIComponent(msg));
}

// ---------- CREATE CLASS ----------
export async function createClass(formData: FormData) {
  await requireProfile("admin");
  const admin = createAdminClient();

  const name = String(formData.get("name") || "").trim();
  const teacherId = String(formData.get("teacher_id") || "");

  if (!name || !teacherId) {
    redirect("/admin/classes?msg=" + encodeURIComponent("Enter a class name and choose a teacher."));
  }

  const { data: newClass, error } = await admin
    .from("classes")
    .insert({ name, teacher_id: teacherId })
    .select("id")
    .single();

  // Auto-create the course so teachers can start adding words immediately
  if (newClass) {
    await admin.from("courses").insert({ class_id: newClass.id, name: "Vocabulary" });
  }

  const msg = error
    ? `Could not create class: ${error.message}`
    : `Class "${name}" created with its Vocabulary course — the teacher can start adding words right away.`;
  revalidatePath("/admin/classes");
  redirect("/admin/classes?msg=" + encodeURIComponent(msg));
}

// ---------- BULK ADD STUDENTS TO A CLASS ----------
// Roster format: one student per line ->  M00657654, Huda
export async function bulkAddStudents(formData: FormData) {
  await requireProfile("admin");
  const admin = createAdminClient();

  const classId = String(formData.get("class_id") || "");
  const password = String(formData.get("password") || "");
  const roster = String(formData.get("roster") || "");

  if (!classId || password.length < 6 || !roster.trim()) {
    redirect(`/admin/classes/${classId}?msg=` + encodeURIComponent("Paste a roster and set a password of 6+ characters."));
  }

  let created = 0, enrolled = 0;
  const problems: string[] = [];

  const lines = roster.split("\n").map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    const parts = line.split(/[,\t]/).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) {
      problems.push(`Skipped "${line}" (need: ID, Name)`);
      continue;
    }
    const username = parts[0];
    const fullName = parts.slice(1).join(" ");

    // Try to create the auth user; if it already exists we just enroll them
    let userId: string | null = null;
    const { data: createdUser, error: createErr } = await admin.auth.admin.createUser({
      email: toEmail(username),
      password,
      email_confirm: true,
      user_metadata: { username, full_name: fullName, role: "student" },
    });

    if (createErr) {
      const { data: existing } = await admin
        .from("profiles")
        .select("id")
        .ilike("username", username)
        .maybeSingle();
      if (existing) {
        userId = existing.id;
      } else {
        problems.push(`${username}: ${createErr.message}`);
        continue;
      }
    } else {
      userId = createdUser.user.id;
      created++;
    }

    const { error: enrollErr } = await admin
      .from("enrollments")
      .upsert({ class_id: classId, student_id: userId }, { onConflict: "class_id,student_id" });

    if (enrollErr) problems.push(`${username}: ${enrollErr.message}`);
    else enrolled++;
  }

  let msg = `Created ${created} account(s), enrolled ${enrolled} student(s).`;
  if (problems.length) msg += ` Issues: ${problems.slice(0, 3).join(" | ")}`;

  revalidatePath(`/admin/classes/${classId}`);
  redirect(`/admin/classes/${classId}?msg=` + encodeURIComponent(msg));
}

// ---------- CREATE COURSE ----------
export async function createCourse(formData: FormData) {
  await requireProfile("admin");
  const admin = createAdminClient();

  const classId = String(formData.get("class_id") || "");
  const name = String(formData.get("name") || "").trim();

  if (!classId || !name) {
    redirect(`/admin/classes/${classId}?msg=` + encodeURIComponent("Enter a course name."));
  }

  const { error } = await admin.from("courses").insert({ class_id: classId, name });
  const msg = error ? `Could not create course: ${error.message}` : `Course "${name}" created.`;

  revalidatePath(`/admin/classes/${classId}`);
  redirect(`/admin/classes/${classId}?msg=` + encodeURIComponent(msg));
}

// ---------- RESET A USER PASSWORD ----------
export async function resetPassword(formData: FormData) {
  await requireProfile("admin");
  const admin = createAdminClient();

  const userId = String(formData.get("user_id") || "");
  const password = String(formData.get("password") || "");
  const back = String(formData.get("back") || "/admin");

  if (!userId || password.length < 6) {
    redirect(back + "?msg=" + encodeURIComponent("Password needs 6+ characters."));
  }

  const { error } = await admin.auth.admin.updateUserById(userId, { password });
  const msg = error ? `Could not reset password: ${error.message}` : "Password updated.";
  redirect(back + "?msg=" + encodeURIComponent(msg));
}


// ---------- DELETE TEACHER (account) ----------
export async function deleteTeacher(formData: FormData) {
  await requireProfile("admin");
  const admin = createAdminClient();
  const userId = String(formData.get("user_id") || "");

  const { error } = await admin.auth.admin.deleteUser(userId);
  // profiles row cascades away; their classes stay but become unassigned
  const msg = error ? `Could not delete: ${error.message}` : "Teacher deleted. Their classes are now unassigned.";
  revalidatePath("/admin/teachers");
  redirect("/admin/teachers?msg=" + encodeURIComponent(msg));
}

// ---------- DELETE CLASS (and ALL its content/data) ----------
export async function deleteClass(formData: FormData) {
  await requireProfile("admin");
  const admin = createAdminClient();
  const classId = String(formData.get("class_id") || "");

  const { error } = await admin.from("classes").delete().eq("id", classId);
  const msg = error ? `Could not delete class: ${error.message}` : "Class deleted.";
  revalidatePath("/admin/classes");
  redirect("/admin/classes?msg=" + encodeURIComponent(msg));
}

// ---------- REMOVE STUDENT FROM A CLASS (keeps the account) ----------
export async function unenrollStudent(formData: FormData) {
  await requireProfile("admin");
  const admin = createAdminClient();
  const classId = String(formData.get("class_id") || "");
  const studentId = String(formData.get("student_id") || "");

  await admin.from("enrollments").delete()
    .eq("class_id", classId).eq("student_id", studentId);
  revalidatePath(`/admin/classes/${classId}`);
  redirect(`/admin/classes/${classId}?msg=` + encodeURIComponent("Student removed from class."));
}

// ---------- DELETE STUDENT ACCOUNT (and all their data) ----------
export async function deleteStudent(formData: FormData) {
  await requireProfile("admin");
  const admin = createAdminClient();
  const classId = String(formData.get("class_id") || "");
  const studentId = String(formData.get("student_id") || "");

  const { error } = await admin.auth.admin.deleteUser(studentId);
  const msg = error ? `Could not delete: ${error.message}` : "Student account and data deleted.";
  revalidatePath(`/admin/classes/${classId}`);
  redirect(`/admin/classes/${classId}?msg=` + encodeURIComponent(msg));
}


// ---------- DELETE STUDENT (from the global Students page) ----------
export async function deleteStudentGlobal(formData: FormData) {
  await requireProfile("admin");
  const admin = createAdminClient();
  const studentId = String(formData.get("student_id") || "");

  // Handle both real accounts and orphaned profiles (no login account)
  const { error } = await admin.auth.admin.deleteUser(studentId);
  if (error) {
    await admin.from("profiles").delete().eq("id", studentId);
  }
  revalidatePath("/admin/students");
  redirect("/admin/students?msg=" + encodeURIComponent("Student deleted (account and all data)."));
}
