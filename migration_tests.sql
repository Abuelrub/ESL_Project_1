-- ============================================================
-- MIGRATION — Pre/Post Test System
-- Run in Supabase Dashboard > SQL Editor > New query > Run
-- ============================================================

-- A test designed by the teacher
create table if not exists public.tests (
  id              uuid primary key default gen_random_uuid(),
  course_id       uuid references public.courses(id) on delete cascade,
  teacher_id      uuid references public.profiles(id) on delete set null,
  name            text not null,
  test_type       text not null default 'custom',  -- pretest|posttest|midterm|custom
  status          text not null default 'draft',   -- draft|approved|active|closed
  instructions    text,
  show_results    text not null default 'manual',  -- 'immediate'|'manual'
  composition     jsonb not null default '{}',     -- {true_false:5,fill_blank:3,...}
  difficulty_mix  jsonb not null default '{}',     -- {easy:6,medium:8,hard:6}
  created_at      timestamptz not null default now(),
  approved_at     timestamptz
);

-- Individual questions inside a test
create table if not exists public.test_questions (
  id              uuid primary key default gen_random_uuid(),
  test_id         uuid not null references public.tests(id) on delete cascade,
  word_id         uuid references public.words(id) on delete set null,
  question_type   text not null,
  difficulty      text not null default 'easy',   -- easy|medium|hard
  question_data   jsonb not null,
  order_index     int not null default 0,
  teacher_edited  boolean not null default false,
  created_at      timestamptz not null default now()
);

-- Which students are assigned a test
create table if not exists public.test_assignments (
  id              uuid primary key default gen_random_uuid(),
  test_id         uuid not null references public.tests(id) on delete cascade,
  student_id      uuid not null references public.profiles(id) on delete cascade,
  assigned_at     timestamptz not null default now(),
  started_at      timestamptz,
  completed_at    timestamptz,
  score_raw       int,
  score_total     int,
  results_visible boolean not null default false,
  unique(test_id, student_id)
);

-- Every student answer to every test question
create table if not exists public.test_answers (
  id                  uuid primary key default gen_random_uuid(),
  assignment_id       uuid not null references public.test_assignments(id) on delete cascade,
  question_id         uuid not null references public.test_questions(id) on delete cascade,
  student_id          uuid not null references public.profiles(id) on delete cascade,
  student_answer      text,
  is_correct          boolean,
  grammar_score       numeric(3,2),
  usage_score         numeric(3,2),
  naturalness_score   numeric(3,2),
  ai_feedback         text,
  teacher_score       int,        -- teacher override: 0 or 1
  teacher_comment     text,       -- teacher's written comment
  answered_at         timestamptz not null default now()
);

-- Indexes
create index if not exists idx_tests_course    on public.tests(course_id);
create index if not exists idx_tq_test         on public.test_questions(test_id);
create index if not exists idx_ta_student      on public.test_assignments(student_id);
create index if not exists idx_ta_test         on public.test_assignments(test_id);
create index if not exists idx_tan_assignment  on public.test_answers(assignment_id);

-- RLS
alter table public.tests           enable row level security;
alter table public.test_questions  enable row level security;
alter table public.test_assignments enable row level security;
alter table public.test_answers    enable row level security;

create policy "teacher manages own tests" on public.tests
  for all using (teacher_id = auth.uid());
create policy "student reads active tests" on public.tests
  for select using (
    status in ('active','closed') and
    exists (select 1 from public.test_assignments ta
            where ta.test_id = tests.id and ta.student_id = auth.uid()));

create policy "teacher manages test questions" on public.test_questions
  for all using (
    exists (select 1 from public.tests t
            where t.id = test_questions.test_id and t.teacher_id = auth.uid()));
create policy "student reads test questions" on public.test_questions
  for select using (
    exists (select 1 from public.tests t
            join public.test_assignments ta on ta.test_id = t.id
            where t.id = test_questions.test_id
              and ta.student_id = auth.uid()
              and t.status in ('active','closed')));

create policy "teacher manages assignments" on public.test_assignments
  for all using (
    exists (select 1 from public.tests t
            where t.id = test_assignments.test_id and t.teacher_id = auth.uid()));
create policy "student reads own assignment" on public.test_assignments
  for select using (student_id = auth.uid());
create policy "student updates own assignment" on public.test_assignments
  for update using (student_id = auth.uid());

create policy "teacher manages answers" on public.test_answers
  for all using (
    exists (select 1 from public.test_assignments ta
            join public.tests t on t.id = ta.test_id
            where ta.id = test_answers.assignment_id and t.teacher_id = auth.uid()));
create policy "student manages own answers" on public.test_answers
  for all using (student_id = auth.uid());
