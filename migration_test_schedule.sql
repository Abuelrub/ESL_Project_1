-- Add scheduling columns to tests table
alter table public.tests
  add column if not exists open_at  timestamptz default null,
  add column if not exists close_at timestamptz default null;
