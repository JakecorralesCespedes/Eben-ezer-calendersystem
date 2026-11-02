-- Run in the Supabase SQL Editor. The administrator and authorized staff share one workspace.
create table if not exists public.app_state (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.team_memberships (
  user_id uuid primary key references auth.users (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  username text not null,
  email text not null,
  display_name text not null,
  role text not null default 'staff' check (role in ('admin', 'staff')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_memberships_username_format check (username ~ '^[a-z0-9._-]{3,32}$')
);

create unique index if not exists team_memberships_username_unique on public.team_memberships (lower(username));
create unique index if not exists team_memberships_email_unique on public.team_memberships (lower(email));

create or replace function public.current_workspace_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select owner_id from public.team_memberships where user_id = auth.uid() limit 1
$$;

create or replace function public.current_workspace_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.team_memberships
    where user_id = auth.uid() and role = 'admin'
  )
$$;

revoke all on function public.current_workspace_id() from public, anon;
revoke all on function public.current_workspace_is_admin() from public, anon;
grant execute on function public.current_workspace_id() to authenticated;
grant execute on function public.current_workspace_is_admin() to authenticated;

alter table public.team_memberships enable row level security;
drop policy if exists "Team members can read their own membership" on public.team_memberships;
create policy "Team members can read their own membership"
  on public.team_memberships for select to authenticated
  using (
    user_id = (select auth.uid())
    or (owner_id = (select public.current_workspace_id()) and (select public.current_workspace_is_admin()))
  );
revoke all on public.team_memberships from anon, authenticated;
grant select on public.team_memberships to authenticated;

alter table public.app_state enable row level security;

drop policy if exists "Owners can read their app state" on public.app_state;
drop policy if exists "Workspace members can read app state" on public.app_state;
create policy "Workspace members can read app state"
  on public.app_state for select to authenticated
  using ((select public.current_workspace_id()) = owner_id);

drop policy if exists "Owners can create their app state" on public.app_state;
drop policy if exists "Workspace members can create app state" on public.app_state;
create policy "Workspace members can create app state"
  on public.app_state for insert to authenticated
  with check ((select public.current_workspace_id()) = owner_id);

drop policy if exists "Owners can update their app state" on public.app_state;
drop policy if exists "Workspace members can update app state" on public.app_state;
create policy "Workspace members can update app state"
  on public.app_state for update to authenticated
  using ((select public.current_workspace_id()) = owner_id)
  with check ((select public.current_workspace_id()) = owner_id);

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

-- Tokens OAuth y vínculos con eventos: solo Edge Functions acceden a estas tablas.
create table if not exists public.google_calendar_connections (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  refresh_token text not null,
  calendar_id text not null default 'primary',
  email text not null default '',
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.google_calendar_oauth_states (
  state text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.google_calendar_events (
  owner_id uuid not null references auth.users (id) on delete cascade,
  booking_id text not null,
  event_id text not null,
  payload_hash text,
  updated_at timestamptz not null default now(),
  primary key (owner_id, booking_id),
  unique (owner_id, event_id)
);

alter table public.google_calendar_events add column if not exists payload_hash text;

-- Solicitudes públicas de reserva: el portal muestra solo disponibilidad y no expone pagos ni contactos.
create table if not exists public.booking_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  phone text not null default '',
  booking_date date not null,
  booking_time time not null,
  duration integer not null check (duration in (60, 90, 120)),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now()
);

create index if not exists booking_requests_pending_idx
  on public.booking_requests (owner_id, booking_date, booking_time)
  where status = 'pending';

-- Serializa las solicitudes por cancha y fecha para que dos personas no reserven el mismo horario a la vez.
create or replace function public.submit_public_booking_request(
  p_owner_id uuid,
  p_name text,
  p_phone text,
  p_date date,
  p_time time,
  p_duration integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_data jsonb;
  created_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text || p_date::text, 0));
  select data into current_data from public.app_state where owner_id = p_owner_id for update;
  if current_data is null then raise exception 'COURT_NOT_READY'; end if;

  if exists (
    select 1 from jsonb_array_elements(coalesce(current_data->'bookings', '[]'::jsonb)) as item
    where item->>'date' = p_date::text
      and coalesce(item->>'status', 'confirmed') <> 'cancelled'
      and p_time < ((item->>'time')::time + make_interval(mins => coalesce((item->>'duration')::integer, 60)))
      and p_time + make_interval(mins => p_duration) > (item->>'time')::time
  ) then raise exception 'SLOT_BUSY'; end if;

  if exists (
    select 1 from public.booking_requests r
    where r.owner_id = p_owner_id and r.status = 'pending' and r.booking_date = p_date
      and p_time < (r.booking_time + make_interval(mins => r.duration))
      and p_time + make_interval(mins => p_duration) > r.booking_time
  ) then raise exception 'SLOT_BUSY'; end if;

  insert into public.booking_requests (owner_id, name, phone, booking_date, booking_time, duration)
  values (p_owner_id, p_name, coalesce(p_phone, ''), p_date, p_time, p_duration)
  returning id into created_id;
  return created_id;
end;
$$;

revoke all on function public.submit_public_booking_request(uuid, text, text, date, time, integer) from public, anon, authenticated;
grant execute on function public.submit_public_booking_request(uuid, text, text, date, time, integer) to service_role;

alter table public.google_calendar_connections enable row level security;
alter table public.google_calendar_oauth_states enable row level security;
alter table public.google_calendar_events enable row level security;
alter table public.booking_requests enable row level security;

revoke all on public.google_calendar_connections from anon, authenticated;
revoke all on public.google_calendar_oauth_states from anon, authenticated;
revoke all on public.google_calendar_events from anon, authenticated;
revoke all on public.booking_requests from anon, authenticated;
grant all on public.google_calendar_connections to service_role;
grant all on public.google_calendar_oauth_states to service_role;
grant all on public.google_calendar_events to service_role;
grant all on public.booking_requests to service_role;
