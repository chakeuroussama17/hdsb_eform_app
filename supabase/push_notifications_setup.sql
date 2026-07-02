-- ═══════════════════════════════════════════════════════════════════════
-- HDSB e-Form — Push notification database setup
-- Run this ONCE in: Supabase Dashboard → SQL Editor → New query → Run
-- ═══════════════════════════════════════════════════════════════════════

-- 1) Table that stores each phone's FCM token ---------------------------
create table if not exists public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null unique,
  platform text default 'android',
  updated_at timestamptz default now()
);

alter table public.device_tokens enable row level security;

-- Users manage only their own device tokens (the edge function uses the
-- service-role key, which bypasses RLS to read recipients' tokens).
drop policy if exists "own tokens - select" on public.device_tokens;
create policy "own tokens - select" on public.device_tokens
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "own tokens - insert" on public.device_tokens;
create policy "own tokens - insert" on public.device_tokens
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "own tokens - update" on public.device_tokens;
create policy "own tokens - update" on public.device_tokens
  for update to authenticated using (user_id = auth.uid());

drop policy if exists "own tokens - delete" on public.device_tokens;
create policy "own tokens - delete" on public.device_tokens
  for delete to authenticated using (user_id = auth.uid());

create index if not exists device_tokens_user_id_idx on public.device_tokens (user_id);

-- 2) Trigger: call the push-dispatch edge function on form events --------
create extension if not exists pg_net;

create or replace function public.notify_push_dispatch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://rfaikvgsulpbpsyfccku.supabase.co/functions/v1/push-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJmYWlrdmdzdWxwYnBzeWZjY2t1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0NzIyMzgsImV4cCI6MjA5MDA0ODIzOH0.j1a0wbljVvILvuD3DVWom_0cRJS0mrlKpbc95TkFm5U'
    ),
    body := jsonb_build_object(
      'type', TG_OP,
      'record', to_jsonb(NEW),
      'old_record', case when TG_OP = 'UPDATE' then to_jsonb(OLD) else null end
    )
  );
  return NEW;
end;
$$;

drop trigger if exists submissions_push_dispatch on public.submissions;
create trigger submissions_push_dispatch
  after insert or update of status on public.submissions
  for each row execute function public.notify_push_dispatch();

-- Done! New submissions and status changes now trigger native push
-- notifications via the push-dispatch edge function.
