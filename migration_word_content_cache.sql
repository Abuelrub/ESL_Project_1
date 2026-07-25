-- ============================================================
-- MIGRATION — Cache lesson content per word (speed improvement)
-- Run in Supabase Dashboard > SQL Editor > New query > Run
-- ============================================================

create table if not exists public.word_content (
  word_id uuid primary key references public.words(id) on delete cascade,
  content jsonb not null,
  generated_at timestamptz not null default now()
);
