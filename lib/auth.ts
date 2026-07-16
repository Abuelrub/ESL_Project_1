import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type UserRole = "admin" | "teacher" | "student";

export interface Profile {
  id: string;
  username: string;
  full_name: string;
  role: UserRole;
}

// Get the logged-in user's profile, or redirect to /login.
// If requiredRole is given, redirect users with a different role
// to their own home page.
export async function requireProfile(requiredRole?: UserRole): Promise<Profile> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, username, full_name, role")
    .eq("id", user.id)
    .single();

  if (!profile) redirect("/login");

  if (requiredRole && profile.role !== requiredRole) {
    redirect(`/${profile.role}`);
  }
  return profile as Profile;
}
