-- ============================================================
-- MIGRATION: Practice mode + research tracking columns
-- Run this in Supabase Dashboard > SQL Editor > New query > Run
-- ============================================================

-- Which mode a session was: 'quiz' (10-question evaluation) or 'practice' (guided lessons)
alter table public.practice_sessions
  add column if not exists mode text not null default 'quiz';

-- Research tracking per question
alter table public.questions
  add column if not exists hints_used int not null default 0,   -- how many times the student tapped Hint
  add column if not exists attempts int not null default 0;     -- how many tries before finishing
-- Note: attempts > 0 with is_correct = true means the student needed retries
-- (first-try correctness = is_correct AND attempts = 1)
