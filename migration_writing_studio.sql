-- ============================================================
-- MIGRATION — Writing Studio
-- Run in Supabase Dashboard > SQL Editor > New query > Run
-- ============================================================

alter table public.word_progress
  add column if not exists writing_attempts int not null default 0,
  add column if not exists writing_correct  int not null default 0,
  add column if not exists writing_score    numeric(3,2) default null;

create table if not exists public.writing_sessions (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references public.profiles(id)  on delete cascade,
  word_id       uuid not null references public.words(id)     on delete cascade,
  unit_id       uuid           references public.units(id)    on delete set null,
  started_at    timestamptz not null default now(),
  completed_at  timestamptz,
  sentences_attempted int not null default 0,
  sentences_correct   int not null default 0,
  final_score   numeric(3,2)
);

create table if not exists public.writing_sentences (
  id                uuid primary key default gen_random_uuid(),
  session_id        uuid not null references public.writing_sessions(id) on delete cascade,
  student_id        uuid not null references public.profiles(id) on delete cascade,
  word_id           uuid not null references public.words(id)    on delete cascade,
  sentence          text not null,
  is_correct        boolean not null,
  grammar_score     numeric(3,2),
  usage_score       numeric(3,2),
  naturalness_score numeric(3,2),
  ai_feedback       text not null,
  grammar_correction text,
  improved_sentence  text,
  turn_number       int not null default 1,
  created_at        timestamptz not null default now()
);

create index if not exists idx_ws_student  on public.writing_sessions(student_id);
create index if not exists idx_wse_session on public.writing_sentences(session_id);
create index if not exists idx_wse_word    on public.writing_sentences(word_id, student_id);

alter table public.writing_sessions  enable row level security;
alter table public.writing_sentences enable row level security;

create policy if not exists "student owns writing sessions"
  on public.writing_sessions for all using (student_id = auth.uid());
create policy if not exists "teacher reads writing sessions"
  on public.writing_sessions for select using (
    exists (select 1 from public.enrollments e
            join public.classes c on c.id = e.class_id
            where e.student_id = writing_sessions.student_id
              and c.teacher_id = auth.uid()));
create policy if not exists "student owns writing sentences"
  on public.writing_sentences for all using (student_id = auth.uid());
create policy if not exists "teacher reads writing sentences"
  on public.writing_sentences for select using (
    exists (select 1 from public.enrollments e
            join public.classes c on c.id = e.class_id
            where e.student_id = writing_sentences.student_id
              and c.teacher_id = auth.uid()));
