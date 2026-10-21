-- Genair Ops on Supabase: the shared database, its permissions and its change feed.
--
-- Every entity (customer, case, quote, ...) is one row of app.entities: collection + id, the JSON document, and
-- when each field was last written (field_at, ms). Writes merge per field, the later write (by the op's `at`)
-- winning, so two people editing different fields of one case never overwrite each other. Deletes are soft (del),
-- and every changed row gets the next global seq, which is what devices pull by ("changes since seq N").
--
-- The app never touches the tables: it calls the db_* functions below as the signed-in user. They check every
-- write against the user's role (app.check_op, ported from server/src/permissions.js) and filter every read
-- (app.scope, from server/src/readscope.js). Edge Functions use the sys_* functions with the service role.
--
-- Writes take one advisory lock, so they commit in seq order and a device that read up to seq N never misses N-1.

create schema if not exists app;
revoke all on schema app from public;

-- ------------------------------------------------------------------ tables

create table app.entities (
  collection text not null check (collection ~ '^[a-z][A-Za-z0-9]{0,39}$'),
  id text not null check (id ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  data jsonb not null,
  field_at jsonb not null default '{}'::jsonb,
  cseq bigint not null,
  seq bigint not null default 0,
  del bigint not null default 0,
  ts bigint not null,
  by text,
  primary key (collection, id)
);
create index entities_seq on app.entities (seq);
create index entities_portal_token on app.entities ((data -> 'portal' ->> 'token')) where collection = 'cases';

create sequence app.seq_gen;
create sequence app.cseq_gen;

create table app.counters (key text primary key check (key ~ '^[A-Za-z0-9_.:-]{1,60}$'), value bigint not null default 0);

-- a signed-in Supabase user <-> the app's user (users collection). login_email is the account's address in Supabase Auth.
create table app.members (
  auth_id uuid primary key,
  user_id text not null unique,
  login_email text not null unique,
  must_change boolean not null default false,
  password_set_at timestamptz,
  created_at timestamptz not null default now()
);

-- uploaded files (Storage bucket "files"): who uploaded them and for which case, for the doc ownership check
create table app.files (
  id text primary key check (id ~ '^f[a-f0-9]{24}$'),
  path text not null unique,
  case_id text,
  folder text,
  by_user text,
  name text not null,
  mime text not null,
  size bigint not null,
  source text,
  created_at timestamptz not null default now()
);

-- WhatsApp webhook events (the inbox the app polls)
create table app.inbox (
  id text primary key,
  item jsonb not null,
  at timestamptz not null default now()
);
create index inbox_at on app.inbox (at);

alter table app.entities enable row level security;
alter table app.counters enable row level security;
alter table app.members enable row level security;
alter table app.files enable row level security;
alter table app.inbox enable row level security;

-- one row whose seq moves on every write: devices subscribe to it (Realtime) and then pull db_changes.
-- It carries no data, so everyone signed in may see it.
create table public.sync_feed (id int primary key check (id = 1), seq bigint not null default 0, at timestamptz not null default now());
insert into public.sync_feed (id) values (1);
alter table public.sync_feed enable row level security;
create policy sync_feed_read on public.sync_feed for select to authenticated using (true);
grant select on public.sync_feed to authenticated;

-- ------------------------------------------------------------------ helpers

create function app.now_ms() returns bigint language sql volatile as $$
  select (extract(epoch from clock_timestamp()) * 1000)::bigint
$$;

create function app.to_ms(v jsonb) returns bigint language plpgsql immutable as $$
begin
  if v is null or jsonb_typeof(v) = 'null' then return null; end if;
  if jsonb_typeof(v) = 'number' then return (v #>> '{}')::numeric::bigint; end if;
  if jsonb_typeof(v) = 'string' then
    return (extract(epoch from (v #>> '{}')::timestamptz) * 1000)::bigint;
  end if;
  return null;
exception when others then
  return null;
end $$;

create function app.bad(msg text) returns void language plpgsql as $$
begin
  raise exception using errcode = '22023', message = msg;
end $$;

-- the signed-in user's document (users collection), or null when not a member or deactivated
create function app.me() returns jsonb language sql stable security definer set search_path = app, public as $$
  select e.data
  from app.members m
  join app.entities e on e.collection = 'users' and e.id = m.user_id and e.del = 0
  where m.auth_id = auth.uid() and coalesce(e.data ->> 'active', 'true') <> 'false'
$$;

create function app.require_me() returns jsonb language plpgsql stable security definer set search_path = app, public as $$
declare v jsonb := app.me();
begin
  if v is null then
    raise exception using errcode = '42501', message = 'צריך להתחבר למערכת', detail = 'revoked';
  end if;
  return v;
end $$;

create function app.is_manager(u jsonb) returns boolean language sql immutable as $$
  select coalesce(u ->> 'role', '') in ('admin', 'office')
$$;

create function app.max_seq() returns bigint language sql stable as $$
  select coalesce(max(seq), 0) from app.entities
$$;

