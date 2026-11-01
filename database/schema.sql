-- Run once in Supabase SQL Editor.
-- Each owner signs in with the same email/password on their devices.
create table if not exists public.app_state (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.app_state enable row level security;

drop policy if exists "Owners can read their app state" on public.app_state;
create policy "Owners can read their app state"
  on public.app_state for select to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists "Owners can create their app state" on public.app_state;
create policy "Owners can create their app state"
  on public.app_state for insert to authenticated
  with check ((select auth.uid()) = owner_id);

drop policy if exists "Owners can update their app state" on public.app_state;
create policy "Owners can update their app state"
  on public.app_state for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

grant select, insert, update on public.app_state to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'app_state'
  ) then
    alter publication supabase_realtime add table public.app_state;
  end if;
end
$$;
