-- ============================================================
-- MIGRATION — Part names + multi-part assignment
-- Run in Supabase Dashboard > SQL Editor > New query > Run
-- ============================================================

-- Custom names for each part inside a unit
alter table public.units
  add column if not exists part1_name text not null default 'Part 1',
  add column if not exists part2_name text not null default 'Part 2';

-- Per part: is it currently assigned to students?
alter table public.units
  add column if not exists part1_assigned boolean not null default false,
  add column if not exists part2_assigned boolean not null default false;

-- One-time migration: if a course had the old-style single assignment,
-- carry it over so nothing gets lost.
update public.units u
   set part1_assigned = true
  from public.courses c
 where c.active_unit_id = u.id and c.active_part >= 1;

update public.units u
   set part1_assigned = true, part2_assigned = true
  from public.courses c
 where c.active_unit_id = u.id and c.active_part = 2;
