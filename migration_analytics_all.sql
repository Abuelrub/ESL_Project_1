-- ============================================================
-- MIGRATION — ANALYTICS (run once; safe to re-run)
-- Supabase Dashboard > SQL Editor > New query > paste ALL > Run
-- ============================================================

-- 1) Per-student stats (used by Students page)
create or replace function public.class_student_stats(p_class_id uuid)
returns table (
  student_id uuid, total_questions bigint, correct_answers bigint,
  first_try_correct bigint, total_hints bigint, total_attempts bigint,
  practice_sessions bigint, quiz_sessions bigint
)
language sql stable security definer set search_path = public
as $$
  select
    e.student_id,
    count(q.id) filter (where q.answered_at is not null),
    count(q.id) filter (where q.is_correct),
    count(q.id) filter (where q.is_correct and q.attempts <= 1),
    coalesce(sum(q.hints_used), 0)::bigint,
    coalesce(sum(q.attempts), 0)::bigint,
    (select count(*) from public.practice_sessions s
       where s.student_id = e.student_id and s.mode = 'practice'),
    (select count(*) from public.practice_sessions s
       where s.student_id = e.student_id and s.mode = 'quiz')
  from public.enrollments e
  left join public.questions q
    on q.student_id = e.student_id and q.question_type <> 'lesson_content'
  where e.class_id = p_class_id
    and (exists (select 1 from public.classes c
                 where c.id = p_class_id and c.teacher_id = auth.uid())
      or exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.role = 'admin'))
  group by e.student_id;
$$;

-- 2) Per-word stats for a class
create or replace function public.class_word_stats(p_class_id uuid)
returns table (
  word_id uuid, word_text text, difficulty text, unit_name text,
  times_asked bigint, correct_count bigint, first_try_count bigint,
  total_hints bigint, avg_attempts numeric, students_mastered bigint
)
language sql stable security definer set search_path = public
as $$
  select
    w.id, w.text, w.difficulty::text, u.name,
    count(q.id) filter (where q.answered_at is not null),
    count(q.id) filter (where q.is_correct),
    count(q.id) filter (where q.is_correct and q.attempts <= 1),
    coalesce(sum(q.hints_used), 0)::bigint,
    round(coalesce(avg(q.attempts) filter (where q.answered_at is not null), 0), 2),
    (select count(*) from public.word_progress wp
       join public.enrollments e2
         on e2.student_id = wp.student_id and e2.class_id = p_class_id
      where wp.word_id = w.id and wp.practice_count >= 8)
  from public.words w
  join public.units u on u.id = w.unit_id
  join public.courses c on c.id = u.course_id and c.class_id = p_class_id
  left join public.questions q
    on q.word_id = w.id and q.question_type <> 'lesson_content'
   and q.student_id in (select student_id from public.enrollments
                        where class_id = p_class_id)
  where (exists (select 1 from public.classes cl
                 where cl.id = p_class_id and cl.teacher_id = auth.uid())
      or exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.role = 'admin'))
  group by w.id, w.text, w.difficulty, u.name;
$$;

-- 3) The full research grid: student x word x mode
create or replace function public.class_qword_stats(p_class_id uuid)
returns table (
  student_id uuid, word_id uuid, mode text,
  asked bigint, correct bigint, first_try bigint,
  hints bigint, attempts bigint
)
language sql stable security definer set search_path = public
as $$
  select
    q.student_id, q.word_id, s.mode,
    count(q.id) filter (where q.answered_at is not null),
    count(q.id) filter (where q.is_correct),
    count(q.id) filter (where q.is_correct and q.attempts <= 1),
    coalesce(sum(q.hints_used), 0)::bigint,
    coalesce(sum(q.attempts), 0)::bigint
  from public.questions q
  join public.practice_sessions s on s.id = q.session_id
  join public.enrollments e
    on e.student_id = q.student_id and e.class_id = p_class_id
  where q.question_type <> 'lesson_content'
    and (exists (select 1 from public.classes c
                 where c.id = p_class_id and c.teacher_id = auth.uid())
      or exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.role = 'admin'))
  group by q.student_id, q.word_id, s.mode;
$$;
