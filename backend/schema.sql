-- GDGoC NDU Arcade Challenge
-- Run this whole file in Supabase SQL Editor before deploying Edge Functions.
-- The only browser key is the Supabase anon/publishable key. NEVER place service_role here.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.event_config (
  id boolean primary key default true check (id = true),
  event_name text not null default 'GDGoC NDU Arcade Challenge',
  registration_open boolean not null default false,
  event_ended boolean not null default false,
  queue_paused boolean not null default false,
  turn_duration_seconds integer not null default 60 check (turn_duration_seconds between 15 and 180),
  start_countdown_seconds integer not null default 3 check (start_countdown_seconds between 0 and 10),
  ready_window_seconds integer not null default 15 check (ready_window_seconds between 5 and 90),
  require_ready boolean not null default false,
  repeat_attempts_enabled boolean not null default true,
  maintenance_message text not null default '',
  updated_at timestamptz not null default now()
);
insert into public.event_config (id) values (true) on conflict (id) do nothing;

create table if not exists public.event_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  added_at timestamptz not null default now()
);

create table if not exists public.queue_entries (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null,
  nickname text not null check (char_length(nickname) between 2 and 18),
  status text not null default 'waiting' check (status in ('waiting','called','active','played','skipped','removed')),
  ready_deadline timestamptz,
  ready_confirmed boolean not null default false,
  score integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists queue_entries_order_idx on public.queue_entries(status, created_at);
create index if not exists queue_entries_participant_idx on public.queue_entries(participant_id, created_at desc);
create unique index if not exists only_one_live_entry_per_participant on public.queue_entries(participant_id) where status in ('waiting','called','active');

-- Controller credentials live separately and are never readable by anon/authenticated clients.
create table if not exists public.participant_secrets (
  queue_entry_id uuid primary key references public.queue_entries(id) on delete cascade,
  token_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.game_sessions (
  id uuid primary key default gen_random_uuid(),
  queue_entry_id uuid not null references public.queue_entries(id),
  status text not null check (status in ('countdown','active','finished','expired','cancelled')),
  started_at timestamptz not null,
  expires_at timestamptz not null,
  duration_seconds integer not null check (duration_seconds between 15 and 180),
  current_score integer not null default 0,
  deaths integer not null default 0,
  completed boolean not null default false,
  final_score integer,
  started_by uuid,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists one_live_arcade_session on public.game_sessions ((1)) where status in ('countdown','active');
create index if not exists game_sessions_entry_idx on public.game_sessions(queue_entry_id, created_at desc);

create table if not exists public.arcade_state (
  id boolean primary key default true check (id = true),
  active_session_id uuid references public.game_sessions(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.arcade_state (id) values (true) on conflict (id) do nothing;

create table if not exists public.score_records (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references public.game_sessions(id),
  queue_entry_id uuid not null references public.queue_entries(id),
  participant_id uuid not null,
  nickname text not null,
  score integer not null check (score >= 0),
  completed boolean not null default false,
  deaths integer not null default 0 check (deaths >= 0),
  furthest_x integer not null default 0,
  checkpoints integer[] not null default '{}',
  remaining_seconds integer not null default 0,
  created_at timestamptz not null default now(),
  invalidated_at timestamptz,
  invalidated_by uuid,
  invalidation_reason text
);
create index if not exists score_records_rank_idx on public.score_records(score desc, created_at asc);
create index if not exists score_records_participant_idx on public.score_records(participant_id, score desc, created_at asc);

create table if not exists public.voucher_rules (
  id uuid primary key default gen_random_uuid(),
  label text not null check (char_length(label) between 1 and 80),
  reward_type text not null check (reward_type in ('score','complete','top3')),
  threshold integer not null default 0 check (threshold >= 0),
  quantity integer not null default 1 check (quantity between 1 and 500),
  enabled boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.voucher_awards (
  id uuid primary key default gen_random_uuid(),
  reward_id uuid not null references public.voucher_rules(id),
  score_record_id uuid not null references public.score_records(id),
  participant_id uuid not null,
  nickname text not null,
  score integer not null,
  status text not null default 'eligible' check (status in ('eligible','awarded','claimed','revoked')),
  voucher_code text unique,
  created_at timestamptz not null default now(),
  awarded_at timestamptz,
  claimed_at timestamptz,
  updated_by uuid,
  unique (reward_id, participant_id)
);

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Public views intentionally omit bearer tokens, participant secrets, and admin metadata.
create or replace view public.queue_public with (security_invoker = false) as
  select id, nickname, status, created_at, updated_at, score
  from public.queue_entries;

create or replace view public.score_records_public with (security_invoker = false) as
  select id, queue_entry_id, participant_id, nickname, score, completed, deaths, created_at
  from public.score_records where invalidated_at is null;


create or replace view public.voucher_rules_public with (security_invoker = false) as
  select id, label, reward_type, threshold, quantity, enabled
  from public.voucher_rules where enabled = true;

create or replace view public.leaderboard_public with (security_invoker = false) as
  with best_by_player as (
    select distinct on (participant_id)
      participant_id, nickname, score, completed, created_at, queue_entry_id, id as score_record_id
    from public.score_records
    where invalidated_at is null
    order by participant_id, score desc, created_at asc, id asc
  )
  select row_number() over (order by score desc, created_at asc, nickname collate "C" asc) as rank,
         participant_id, nickname, score, completed, created_at, queue_entry_id, score_record_id
  from best_by_player;

alter table public.event_config enable row level security;
alter table public.event_admins enable row level security;
alter table public.queue_entries enable row level security;
alter table public.participant_secrets enable row level security;
alter table public.game_sessions enable row level security;
alter table public.arcade_state enable row level security;
alter table public.score_records enable row level security;
alter table public.voucher_rules enable row level security;
alter table public.voucher_awards enable row level security;
alter table public.audit_log enable row level security;

drop policy if exists "public can read event config" on public.event_config;
create policy "public can read event config" on public.event_config for select to anon, authenticated using (true);
drop policy if exists "public can read queue entries" on public.queue_entries;
create policy "public can read queue entries" on public.queue_entries for select to anon, authenticated using (true);
drop policy if exists "public can read game sessions" on public.game_sessions;
create policy "public can read game sessions" on public.game_sessions for select to anon, authenticated using (true);
drop policy if exists "public can read arcade state" on public.arcade_state;
create policy "public can read arcade state" on public.arcade_state for select to anon, authenticated using (true);
drop policy if exists "public can read valid scores" on public.score_records;
create policy "public can read valid scores" on public.score_records for select to anon, authenticated using (invalidated_at is null);
drop policy if exists "admin can read own row" on public.event_admins;
create policy "admin can read own row" on public.event_admins for select to authenticated using (user_id = auth.uid());
-- No anon/authenticated policies on participant_secrets, voucher_rules, voucher_awards, or audit_log.

revoke all on public.participant_secrets from anon, authenticated;
revoke all on public.voucher_awards from anon, authenticated;
revoke all on public.audit_log from anon, authenticated;
revoke all on public.voucher_rules from anon, authenticated;
grant select on public.event_config, public.queue_entries, public.game_sessions, public.arcade_state, public.score_records to anon, authenticated;
grant select on public.queue_public, public.score_records_public, public.leaderboard_public, public.voucher_rules_public to anon, authenticated;

create or replace function public.arcade_is_admin(p_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists(select 1 from public.event_admins where user_id = p_user_id)
$$;

create or replace function public.arcade_activate_entry(p_entry_id uuid, p_actor uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare cfg public.event_config%rowtype; q public.queue_entries%rowtype; active_id uuid; session_id uuid; start_at timestamptz; expires_at timestamptz;
begin
  select * into cfg from public.event_config where id = true for update;
  select active_session_id into active_id from public.arcade_state where id = true for update;
  if active_id is not null then
    raise exception 'A player already has an active game session';
  end if;
  select * into q from public.queue_entries where id = p_entry_id for update;
  if not found or q.status not in ('waiting','called') then raise exception 'Participant is not eligible to start'; end if;
  if cfg.event_ended then raise exception 'The event has ended'; end if;
  if cfg.queue_paused then raise exception 'The queue is paused'; end if;
  update public.queue_entries set status='active', ready_deadline=null, updated_at=now() where id=q.id;
  start_at := now() + make_interval(secs => cfg.start_countdown_seconds);
  expires_at := start_at + make_interval(secs => cfg.turn_duration_seconds);
  insert into public.game_sessions(queue_entry_id,status,started_at,expires_at,duration_seconds,started_by)
  values(q.id,'active',start_at,expires_at,cfg.turn_duration_seconds,p_actor) returning id into session_id;
  update public.arcade_state set active_session_id=session_id,updated_at=now() where id=true;
  insert into public.audit_log(actor_id,action,details) values(p_actor,'turn_started',jsonb_build_object('entry_id',q.id,'session_id',session_id,'nickname',q.nickname));
  return jsonb_build_object('status','active','session_id',session_id,'entry_id',q.id,'nickname',q.nickname,'started_at',start_at,'expires_at',expires_at);
end $$;

create or replace function public.arcade_start_next(p_actor uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare cfg public.event_config%rowtype; q public.queue_entries%rowtype; active_id uuid; deadline timestamptz;
begin
  select * into cfg from public.event_config where id=true for update;
  if cfg.event_ended then raise exception 'The event has ended'; end if;
  if cfg.queue_paused then raise exception 'The queue is paused'; end if;
  select active_session_id into active_id from public.arcade_state where id=true for update;
  if active_id is not null then
    if exists(select 1 from public.game_sessions where id=active_id and expires_at <= now()) then
      update public.game_sessions set status='expired',ended_at=now() where id=active_id and status in ('active','countdown');
      update public.queue_entries set status='played',updated_at=now() where id=(select queue_entry_id from public.game_sessions where id=active_id);
      update public.arcade_state set active_session_id=null,updated_at=now() where id=true;
    else raise exception 'A player already has an active game session'; end if;
  end if;
  select * into q from public.queue_entries where status='waiting' order by created_at asc,id asc for update skip locked limit 1;
  if not found then return jsonb_build_object('status','empty','message','No participants are waiting'); end if;
  if cfg.require_ready then
    deadline := now() + make_interval(secs => cfg.ready_window_seconds);
    update public.queue_entries set status='called',ready_deadline=deadline,ready_confirmed=false,updated_at=now() where id=q.id;
    insert into public.audit_log(actor_id,action,details) values(p_actor,'participant_called',jsonb_build_object('entry_id',q.id,'deadline',deadline));
    return jsonb_build_object('status','called','entry_id',q.id,'nickname',q.nickname,'ready_deadline',deadline);
  end if;
  return public.arcade_activate_entry(q.id,p_actor);
end $$;

create or replace function public.arcade_advance_stale(p_actor uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare cfg public.event_config%rowtype; q public.queue_entries%rowtype; active_id uuid; called_id uuid;
begin
  select * into cfg from public.event_config where id=true for update;
  select active_session_id into active_id from public.arcade_state where id=true for update;
  if active_id is not null and exists(select 1 from public.game_sessions where id=active_id and expires_at<=now() and status in ('active','countdown')) then
    update public.game_sessions set status='expired',ended_at=now() where id=active_id;
    update public.queue_entries set status='played',updated_at=now() where id=(select queue_entry_id from public.game_sessions where id=active_id);
    update public.arcade_state set active_session_id=null,updated_at=now() where id=true;
    insert into public.audit_log(actor_id,action,details) values(p_actor,'turn_expired_without_host',jsonb_build_object('session_id',active_id));
    active_id:=null;
  end if;
  select id into called_id from public.queue_entries where status='called' and ready_deadline <= now() order by created_at asc for update skip locked limit 1;
  if called_id is not null then
    update public.queue_entries set status='skipped',updated_at=now() where id=called_id;
    insert into public.audit_log(actor_id,action,details) values(p_actor,'no_show_skipped',jsonb_build_object('entry_id',called_id));
    if active_id is null and not cfg.queue_paused and not cfg.event_ended then return public.arcade_start_next(p_actor); end if;
    return jsonb_build_object('status','skipped','entry_id',called_id);
  end if;
  return jsonb_build_object('status','no_change');
end $$;

create or replace function public.arcade_confirm_ready(p_entry_id uuid, p_actor uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare q public.queue_entries%rowtype;
begin
  select * into q from public.queue_entries where id=p_entry_id for update;
  if not found or q.status <> 'called' then raise exception 'This participant is not being called'; end if;
  if q.ready_deadline is null or q.ready_deadline < now() then
    update public.queue_entries set status='skipped',updated_at=now() where id=q.id;
    raise exception 'The readiness window expired';
  end if;
  update public.queue_entries set ready_confirmed=true,updated_at=now() where id=q.id;
  return public.arcade_activate_entry(q.id,p_actor);
end $$;

create or replace function public.arcade_finish_turn(p_session_id uuid, p_result jsonb, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare sess public.game_sessions%rowtype; q public.queue_entries%rowtype; max_x integer; complete_run boolean; seconds_left integer; checkpoint_list integer[]; distance_points integer; checkpoint_points integer; finish_points integer; time_points integer; total_score integer; score_id uuid; item public.voucher_rules%rowtype; awards_for_rule integer;
begin
  select * into sess from public.game_sessions where id=p_session_id for update;
  if not found then raise exception 'Game session not found'; end if;
  if sess.status='finished' then return jsonb_build_object('status','already_finished','score',sess.final_score); end if;
  if sess.status not in ('active','countdown') then raise exception 'This game session is no longer active'; end if;
  select * into q from public.queue_entries where id=sess.queue_entry_id for update;
  max_x := greatest(0,least(4280,floor(coalesce((p_result->>'furthestX')::numeric,0))::integer));
  complete_run := coalesce((p_result->>'completed')::boolean,false) and max_x >= 4254;
  seconds_left := greatest(0,least(sess.duration_seconds,coalesce((p_result->>'timeRemaining')::integer,0)));
  select coalesce(array_agg(distinct x::integer),array[]::integer[]) into checkpoint_list
    from jsonb_array_elements_text(coalesce(p_result->'checkpoints','[]'::jsonb)) as cp(value)
    where cp.value in ('1480','2820') and cp.value::integer <= max_x;
  distance_points := floor(max_x::numeric/8)::integer;
  checkpoint_points := coalesce(array_length(checkpoint_list,1),0)*75;
  finish_points := case when complete_run then 500 else 0 end;
  time_points := case when complete_run then least(60,seconds_left)*10 else 0 end;
  total_score := distance_points+checkpoint_points+finish_points+time_points;
  update public.game_sessions set status='finished',ended_at=now(),current_score=total_score,final_score=total_score,deaths=greatest(0,coalesce((p_result->>'deaths')::integer,0)),completed=complete_run where id=sess.id;
  insert into public.score_records(session_id,queue_entry_id,participant_id,nickname,score,completed,deaths,furthest_x,checkpoints,remaining_seconds)
  values(sess.id,q.id,q.participant_id,q.nickname,total_score,complete_run,greatest(0,coalesce((p_result->>'deaths')::integer,0)),max_x,checkpoint_list,seconds_left)
  on conflict(session_id) do update set score=excluded.score returning id into score_id;
  update public.queue_entries set status='played',score=greatest(coalesce(score,0),total_score),updated_at=now() where id=q.id;
  update public.arcade_state set active_session_id=null,updated_at=now() where id=true and active_session_id=sess.id;
  insert into public.audit_log(actor_id,action,details) values(p_actor,'turn_finished',jsonb_build_object('session_id',sess.id,'entry_id',q.id,'score',total_score,'completed',complete_run,'deaths',sess.deaths));
  -- Eligibility rows are recorded server-side. Prize award/claim remains an organizer action.
  for item in select * from public.voucher_rules where enabled=true and reward_type in ('score','complete') loop
    select count(*) into awards_for_rule from public.voucher_awards where reward_id=item.id and status <> 'revoked';
    if awards_for_rule < item.quantity and ((item.reward_type='score' and total_score>=item.threshold) or (item.reward_type='complete' and complete_run)) then
      insert into public.voucher_awards(reward_id,score_record_id,participant_id,nickname,score,status)
      values(item.id,score_id,q.participant_id,q.nickname,total_score,'eligible') on conflict do nothing;
    end if;
  end loop;
  -- Top-three rewards are evaluated only when the organizer ends the event.
  return jsonb_build_object('status','finished','score',total_score,'score_record_id',score_id,'completed',complete_run,'furthest_x',max_x,'checkpoints',checkpoint_list);
end $$;

create or replace function public.arcade_host_state()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare cfg jsonb; q jsonb; session_data jsonb; scores jsonb; active_id uuid; active_entry uuid;
begin
  if not public.arcade_is_admin(auth.uid()) then raise exception 'Not an event admin'; end if;
  select to_jsonb(e) into cfg from public.event_config e where id=true;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at asc),'[]'::jsonb) into q from public.queue_entries x where x.status in ('waiting','called','active');
  select active_session_id into active_id from public.arcade_state where id=true;
  if active_id is not null then
    select jsonb_build_object('id',s.id,'entryId',s.queue_entry_id,'nickname',e.nickname,'startedAt',s.started_at,'expiresAt',s.expires_at,'status',s.status,'duration',s.duration_seconds,'current_score',s.current_score,'deaths',s.deaths,'controller_token_hash',ps.token_hash)
      into session_data from public.game_sessions s join public.queue_entries e on e.id=s.queue_entry_id left join public.participant_secrets ps on ps.queue_entry_id=e.id where s.id=active_id;
  end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) into scores from public.score_records x where x.invalidated_at is null;
  return jsonb_build_object('event',cfg,'queue',q,'activeSession',session_data,'scores',scores);
end $$;

-- Create queue entries through Edge Functions only; these DB operations are transactional.
create or replace function public.arcade_join_queue(p_nickname text, p_participant_id uuid, p_token_hash text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare cfg public.event_config%rowtype; q public.queue_entries%rowtype;
begin
  select * into cfg from public.event_config where id=true;
  if cfg.event_ended or not cfg.registration_open then raise exception 'Registration is closed'; end if;
  if cfg.maintenance_message <> '' then raise exception '%', cfg.maintenance_message; end if;
  if p_nickname is null or char_length(btrim(p_nickname)) not between 2 and 18 or p_nickname ~ '[[:cntrl:]<>]' then raise exception 'Nickname must be 2–18 safe characters'; end if;
  if exists(select 1 from public.queue_entries where participant_id=p_participant_id and status in ('waiting','called','active')) then raise exception 'This browser already has an active queue entry. Return to its existing queue tab.'; end if;
  if not cfg.repeat_attempts_enabled and exists(select 1 from public.queue_entries where participant_id=p_participant_id and status='played') then raise exception 'Repeat attempts are disabled for this event'; end if;
  insert into public.queue_entries(participant_id,nickname,status) values(p_participant_id,btrim(p_nickname),'waiting') returning * into q;
  insert into public.participant_secrets(queue_entry_id,token_hash) values(q.id,p_token_hash);
  return jsonb_build_object('id',q.id,'nickname',q.nickname,'status',q.status,'created_at',q.created_at);
end $$;

-- Host/controller telemetry is deliberately not authoritative for score persistence.
create or replace function public.arcade_update_progress(p_session_id uuid, p_score integer, p_deaths integer)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.arcade_is_admin(auth.uid()) then raise exception 'Not an event admin'; end if;
  update public.game_sessions set current_score=greatest(0,least(100000,coalesce(p_score,0))),deaths=greatest(0,least(10000,coalesce(p_deaths,0)))
  where id=p_session_id and status in ('active','countdown') and expires_at>now();
end $$;

revoke all on function public.arcade_is_admin(uuid) from public, anon;
revoke all on function public.arcade_activate_entry(uuid,uuid) from public, anon, authenticated;
revoke all on function public.arcade_start_next(uuid) from public, anon, authenticated;
revoke all on function public.arcade_advance_stale(uuid) from public, anon, authenticated;
revoke all on function public.arcade_confirm_ready(uuid,uuid) from public, anon, authenticated;
revoke all on function public.arcade_finish_turn(uuid,jsonb,uuid) from public, anon, authenticated;
revoke all on function public.arcade_join_queue(text,uuid,text) from public, anon, authenticated;
revoke all on function public.arcade_update_progress(uuid,integer,integer) from public, anon, authenticated;
revoke all on function public.arcade_host_state() from public, anon;
grant execute on function public.arcade_host_state() to authenticated;
-- Edge Functions use the service_role key and call the remaining functions. Never ship that key to a browser.
grant execute on function public.arcade_activate_entry(uuid,uuid) to service_role;
grant execute on function public.arcade_start_next(uuid) to service_role;
grant execute on function public.arcade_advance_stale(uuid) to service_role;
grant execute on function public.arcade_confirm_ready(uuid,uuid) to service_role;
grant execute on function public.arcade_finish_turn(uuid,jsonb,uuid) to service_role;
grant execute on function public.arcade_join_queue(text,uuid,text) to service_role;
grant execute on function public.arcade_update_progress(uuid,integer,integer) to service_role;

-- Realtime row changes are used as notifications; private secrets stay outside subscribed tables.
do $$ begin
  alter publication supabase_realtime add table public.queue_entries;
exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.event_config;
exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.game_sessions;
exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.score_records;
exception when duplicate_object then null; when undefined_object then null; end $$;


create table if not exists public.request_rate_limits (
  rate_key text not null,
  bucket_start timestamptz not null,
  attempts integer not null default 0,
  primary key(rate_key,bucket_start)
);
alter table public.request_rate_limits enable row level security;
revoke all on public.request_rate_limits from anon, authenticated;

create or replace function public.arcade_consume_rate_limit(p_key text,p_max integer default 12,p_window_seconds integer default 60)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare bucket timestamptz; tries integer;
begin
  bucket := to_timestamp(floor(extract(epoch from now())/greatest(1,p_window_seconds))*greatest(1,p_window_seconds));
  insert into public.request_rate_limits(rate_key,bucket_start,attempts) values(p_key,bucket,1)
  on conflict(rate_key,bucket_start) do update set attempts=public.request_rate_limits.attempts+1 returning attempts into tries;
  delete from public.request_rate_limits where bucket_start < now() - interval '2 days';
  return tries <= greatest(1,p_max);
end $$;

create or replace function public.arcade_cancel_active_turn(p_actor uuid,p_reason text default 'Organizer ended turn')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare active_id uuid; entry_id uuid;
begin
  select active_session_id into active_id from public.arcade_state where id=true for update;
  if active_id is null then return jsonb_build_object('status','no_active_turn'); end if;
  select queue_entry_id into entry_id from public.game_sessions where id=active_id for update;
  update public.game_sessions set status='cancelled',ended_at=now() where id=active_id;
  update public.queue_entries set status='played',updated_at=now() where id=entry_id;
  update public.arcade_state set active_session_id=null,updated_at=now() where id=true;
  insert into public.audit_log(actor_id,action,details) values(p_actor,'active_turn_cancelled',jsonb_build_object('session_id',active_id,'entry_id',entry_id,'reason',left(p_reason,300)));
  return jsonb_build_object('status','cancelled','session_id',active_id,'entry_id',entry_id);
end $$;

create or replace function public.arcade_clear_queue(p_actor uuid)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare changed integer;
begin
  update public.queue_entries set status='removed',updated_at=now() where status in ('waiting','called');
  get diagnostics changed = row_count;
  insert into public.audit_log(actor_id,action,details) values(p_actor,'queue_cleared',jsonb_build_object('removed_count',changed));
  return changed;
end $$;

create or replace function public.arcade_reset_leaderboard(p_actor uuid,p_reason text)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare changed integer;
begin
  if p_reason is null or length(btrim(p_reason))<3 then raise exception 'A reset reason is required'; end if;
  update public.score_records set invalidated_at=now(),invalidated_by=p_actor,invalidation_reason=left(btrim(p_reason),300) where invalidated_at is null;
  get diagnostics changed = row_count;
  insert into public.audit_log(actor_id,action,details) values(p_actor,'leaderboard_reset',jsonb_build_object('invalidated_count',changed,'reason',left(btrim(p_reason),300)));
  return changed;
end $$;

create or replace function public.arcade_end_event(p_actor uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare active_id uuid; reward public.voucher_rules%rowtype; rec record; awards_created integer:=0;
begin
  select active_session_id into active_id from public.arcade_state where id=true for update;
  if active_id is not null then perform public.arcade_cancel_active_turn(p_actor,'Event ended by organizer'); end if;
  update public.event_config set registration_open=false,event_ended=true,queue_paused=true,updated_at=now() where id=true;
  for reward in select * from public.voucher_rules where enabled=true and reward_type='top3' loop
    for rec in
      select score_record_id,participant_id,nickname,score from public.leaderboard_public order by rank asc limit least(3,reward.quantity)
    loop
      insert into public.voucher_awards(reward_id,score_record_id,participant_id,nickname,score,status)
      values(reward.id,rec.score_record_id,rec.participant_id,rec.nickname,rec.score,'eligible') on conflict do nothing;
      if found then awards_created:=awards_created+1; end if;
    end loop;
  end loop;
  insert into public.audit_log(actor_id,action,details) values(p_actor,'event_ended',jsonb_build_object('top3_awards_created',awards_created));
  return jsonb_build_object('status','ended','top3_awards_created',awards_created);
end $$;

revoke all on function public.arcade_consume_rate_limit(text,integer,integer) from public, anon, authenticated;
revoke all on function public.arcade_cancel_active_turn(uuid,text) from public, anon, authenticated;
revoke all on function public.arcade_clear_queue(uuid) from public, anon, authenticated;
revoke all on function public.arcade_reset_leaderboard(uuid,text) from public, anon, authenticated;
revoke all on function public.arcade_end_event(uuid) from public, anon, authenticated;
grant execute on function public.arcade_consume_rate_limit(text,integer,integer) to service_role;
grant execute on function public.arcade_cancel_active_turn(uuid,text) to service_role;
grant execute on function public.arcade_clear_queue(uuid) to service_role;
grant execute on function public.arcade_reset_leaderboard(uuid,text) to service_role;
grant execute on function public.arcade_end_event(uuid) to service_role;
