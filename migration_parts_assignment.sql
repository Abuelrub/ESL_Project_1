-- ============================================================
-- MIGRATION — UNIT PARTS + TEACHER ASSIGNMENT + QUIZ LENGTH
-- Run in Supabase Dashboard > SQL Editor > New query > Run
-- ============================================================

-- Every word belongs to Part 1 or Part 2 of its unit
alter table public.words
  add column if not exists part int not null default 1 check (part in (1, 2));

-- The teacher's current assignment + quiz length, per course
alter table public.courses
  add column if not exists active_unit_id uuid references public.units(id) on delete set null,
  add column if not exists active_part int not null default 1 check (active_part in (1, 2)),
  add column if not exists quiz_questions int not null default 5 check (quiz_questions between 3 and 20);
