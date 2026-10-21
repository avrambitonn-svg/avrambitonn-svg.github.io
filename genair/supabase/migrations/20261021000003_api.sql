-- The functions the app (db_*) and the Edge Functions (sys_*) call, who may call them, storage and realtime.

-- ------------------------------------------------------------------ the app's API (signed-in users)

create function public.db_me() returns jsonb language plpgsql stable security definer set search_path = app, public as $$
declare me jsonb := app.require_me();
begin
  return jsonb_build_object('user', me, 'mustChange', (select must_change from app.members where auth_id = auth.uid()));
end $$;

create function public.db_snapshot() returns jsonb language plpgsql stable security definer set search_path = app, public as $$
declare
  me jsonb := app.require_me();
  cols jsonb;
begin
  select coalesce(jsonb_object_agg(collection, items), '{}'::jsonb) into cols from (
    select collection, coalesce(jsonb_agg(s order by cseq desc) filter (where s is not null), '[]'::jsonb) as items
    from (select collection, cseq, app.scope(collection, data, me) as s from app.entities where del = 0 and collection not in ('config', 'settings')) t
    group by collection
  ) g;
  return jsonb_build_object(
    'seq', app.max_seq(),
    'collections', cols,
    'config', (select data from app.entities where collection = 'config' and id = 'org' and del = 0),
    'settings', (select data from app.entities where collection = 'settings' and id = 'org' and del = 0),
    'counters', (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from app.counters),
    'serverTime', app.now_ms(),
    'me', me);
end $$;

-- changes after `since`, oldest first, or { reset } when the device must reload the snapshot
create function public.db_changes(since bigint) returns jsonb language plpgsql stable security definer set search_path = app, public as $$
declare
  me jsonb := app.require_me();
  top bigint := app.max_seq();
  cnt int;
begin
  if since is null or since < 0 or since > top then return jsonb_build_object('seq', top, 'reset', true, 'changes', '[]'::jsonb); end if;
  select count(*) into cnt from app.entities where seq > since;
  if cnt > 3000 then return jsonb_build_object('seq', top, 'reset', true, 'changes', '[]'::jsonb); end if;
  return jsonb_build_object('seq', top, 'changes', coalesce((
    select jsonb_agg(app.change_row(e, me) order by e.seq) from app.entities e where e.seq > since
  ), '[]'::jsonb));
end $$;

-- the current state of specific entities (after a denied or stale write the device takes the server's copy)
create function public.db_fetch(items jsonb) returns jsonb language plpgsql stable security definer set search_path = app, public as $$
declare me jsonb := app.require_me();
begin
  if items is null or jsonb_typeof(items) <> 'array' or jsonb_array_length(items) > 500 then perform app.bad('items חייב להיות מערך (עד 500)'); end if;
  return jsonb_build_object('seq', app.max_seq(), 'items', coalesce((
    select jsonb_agg(coalesce(
      (select app.change_row(e, me) from app.entities e where e.collection = x ->> 'c' and e.id = x ->> 'id'),
      jsonb_build_object('c', x ->> 'c', 'id', x ->> 'id', 'seq', 0, 'del', true)))
    from jsonb_array_elements(items) x
    where x ->> 'c' ~ '^[a-z][A-Za-z0-9]{0,39}$' and x ->> 'id' ~ '^[A-Za-z0-9_.:-]{1,128}$'
  ), '[]'::jsonb));
end $$;

create function public.db_ops(ops jsonb, client_id text default null) returns jsonb language plpgsql volatile security definer set search_path = app, public as $$
declare me jsonb := app.require_me();
begin
  return app.apply(ops, me, me ->> 'id');
end $$;

-- a block of numbers kept for this device (case, quote, service call numbers)
create function public.db_reserve(p_key text, p_count int default 1) returns jsonb language plpgsql volatile security definer set search_path = app, public as $$
declare
  me jsonb := app.require_me();
  top bigint;
begin
  if p_key is null or p_key !~ '^[A-Za-z0-9_.-]{1,40}$' then perform app.bad('key לא תקין'); end if;
  if p_count is null or p_count < 1 or p_count > 100 then perform app.bad('count חייב להיות בין 1 ל-100'); end if;
  insert into app.counters as k (key, value) values (p_key, p_count)
  on conflict (key) do update set value = k.value + excluded.value
  returning k.value into top;
  return jsonb_build_object('key', p_key, 'from', top - p_count + 1, 'to', top);
end $$;

-- after the first sign-in with a temporary password and a new one
create function public.db_password_changed() returns void language sql volatile security definer set search_path = app, public as $$
  update app.members set must_change = false, password_set_at = now() where auth_id = auth.uid();
$$;

-- a file the user just uploaded to Storage (bucket "files", under their own folder) is recorded for the doc check
create function public.db_register_file(file_id text, path text, case_id text default null, folder text default null, name text default 'file', mime text default 'application/octet-stream', size bigint default 0)
returns jsonb language plpgsql volatile security definer set search_path = app, public as $$
declare me jsonb := app.require_me();
begin
  if file_id !~ '^f[a-f0-9]{24}$' then perform app.bad('file_id לא תקין'); end if;
  if split_part(path, '/', 1) <> auth.uid()::text then perform app.bad('הקובץ לא בתיקייה של המשתמש'); end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'files' and o.name = path and (o.owner = auth.uid() or o.owner_id = auth.uid()::text)) then
    perform app.bad('הקובץ לא נמצא באחסון');
  end if;
  insert into app.files (id, path, case_id, folder, by_user, name, mime, size)
  values (file_id, path, nullif(left(case_id, 128), ''), nullif(left(folder, 40), ''), me ->> 'id', left(coalesce(name, 'file'), 180), left(coalesce(mime, 'application/octet-stream'), 100), coalesce(size, 0));
  return jsonb_build_object('fileId', file_id, 'path', path);
end $$;

create function public.is_member() returns boolean language sql stable security definer set search_path = app, public as $$
  select app.me() is not null
$$;

-- ------------------------------------------------------------------ the server's API (Edge Functions, service role)

-- The server's functions refuse anyone but the service role (Edge Functions) or a direct database session
-- (migrations, the SQL editor), whatever the grants say: they bypass the per-user checks.
create function app.require_service() returns void language plpgsql stable set search_path = app, public as $$
declare role text := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role');
begin
  if role = 'service_role' then return; end if;
  if role is null and session_user not in ('authenticator', 'anon', 'authenticated') then return; end if;
  raise exception using errcode = '42501', message = 'server_only';
end $$;


create function public.sys_apply(ops jsonb, origin text) returns jsonb language plpgsql volatile security definer set search_path = app, public as $$
begin
  perform app.require_service();
  return (select app.apply(ops, null, origin));
end $$;

-- everything (Edge Functions load it into memory for one request: the portal, the lead form, the Priority sync)
create function public.sys_dump() returns jsonb language plpgsql stable security definer set search_path = app, public as $$
begin
  perform app.require_service();
  return (select jsonb_build_object(
      'seq', app.max_seq(),
      'collections', coalesce((select jsonb_object_agg(collection, items) from (
        select collection, jsonb_agg(jsonb_build_object('id', id, 'data', data, 'at', field_at, 'cseq', cseq, 'seq', seq, 'del', del, 'ts', ts, 'by', by) order by cseq) as items
        from app.entities group by collection) g), '{}'::jsonb),
      'counters', (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from app.counters)));
end $$;

create function public.sys_reserve(p_key text, p_count int default 1) returns jsonb language plpgsql volatile security definer set search_path = app, public as $$
declare out jsonb;
begin
  perform app.require_service();
  insert into app.counters as k (key, value) values (p_key, p_count)
  on conflict (key) do update set value = k.value + excluded.value
  returning jsonb_build_object('key', k.key, 'from', k.value - p_count + 1, 'to', k.value) into out;
  return out;
end $$;

create function public.sys_is_empty() returns boolean language plpgsql stable security definer set search_path = app, public as $$
begin
  perform app.require_service();
  return (select not exists (select 1 from app.entities where del = 0 and collection <> 'integrations'));
end $$;

-- first run only: the app's data from the browser that sets the system up
create function public.sys_import(snapshot jsonb) returns jsonb language plpgsql volatile security definer set search_path = app, public as $$
declare
  now_ms bigint := app.now_ms();
  c text;
  list jsonb;
  item jsonb;
  fat jsonb;
  k text;
  v jsonb;
begin
  perform app.require_service();
  perform pg_advisory_xact_lock(4242);
  if not public.sys_is_empty() then raise exception using errcode = 'P0001', message = 'already_bootstrapped'; end if;
  for c, list in select * from jsonb_each(coalesce(snapshot -> 'collections', '{}'::jsonb)) loop
    continue when c !~ '^[a-z][A-Za-z0-9]{0,39}$' or c in ('config', 'settings', 'integrations') or jsonb_typeof(list) <> 'array';
    -- the app keeps lists newest first
    for item in select x from jsonb_array_elements(list) with ordinality t(x, o) order by o desc loop
      continue when jsonb_typeof(item) <> 'object' or coalesce(item ->> 'id', '') !~ '^[A-Za-z0-9_.:-]{1,128}$';
      item := app.clean_data(c, item);
      select coalesce(jsonb_object_agg(f, now_ms), '{}'::jsonb) into fat from jsonb_object_keys(item) f;
      insert into app.entities (collection, id, data, field_at, cseq, seq, del, ts, by)
      values (c, item ->> 'id', item, fat, nextval('app.cseq_gen'), nextval('app.seq_gen'), 0, now_ms, 'bootstrap')
      on conflict do nothing;
    end loop;
  end loop;
  foreach c in array array['config', 'settings'] loop
    item := snapshot -> c;
    continue when item is null or jsonb_typeof(item) <> 'object';
    item := app.clean_data(c, item) || '{"id":"org"}'::jsonb;
    select coalesce(jsonb_object_agg(f, now_ms), '{}'::jsonb) into fat from jsonb_object_keys(item) f;
    insert into app.entities (collection, id, data, field_at, cseq, seq, del, ts, by)
    values (c, 'org', item, fat, nextval('app.cseq_gen'), nextval('app.seq_gen'), 0, now_ms, 'bootstrap');
  end loop;
  for k, v in select * from jsonb_each(coalesce(snapshot -> 'counters', '{}'::jsonb)) loop
    continue when k !~ '^[A-Za-z0-9_.:-]{1,60}$' or jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric < 0;
    insert into app.counters (key, value) values (k, floor((v #>> '{}')::numeric)) on conflict (key) do update set value = excluded.value;
  end loop;
  update public.sync_feed set seq = app.max_seq(), at = now() where id = 1;
  return jsonb_build_object('seq', app.max_seq());
end $$;

create function public.sys_set_member(p_auth_id uuid, p_user_id text, p_login_email text, p_must_change boolean) returns void language plpgsql volatile security definer set search_path = app, public as $$
begin
  perform app.require_service();
  -- one login account per user (the Edge Function keeps login emails unique: one per phone or email)
  insert into app.members (auth_id, user_id, login_email, must_change, password_set_at)
  values (p_auth_id, p_user_id, p_login_email, p_must_change, now())
  on conflict (auth_id) do update set user_id = excluded.user_id, login_email = excluded.login_email, must_change = excluded.must_change, password_set_at = now();
end $$;

create function public.sys_members() returns jsonb language plpgsql stable security definer set search_path = app, public as $$
begin
  perform app.require_service();
  return (select coalesce(jsonb_agg(jsonb_build_object('authId', auth_id, 'userId', user_id, 'loginEmail', login_email, 'mustChange', must_change, 'passwordSetAt', password_set_at)), '[]'::jsonb) from app.members);
end $$;

create function public.sys_member_by_auth(p_auth_id uuid) returns jsonb language plpgsql stable security definer set search_path = app, public as $$
begin
  perform app.require_service();
  return (select jsonb_build_object('userId', m.user_id, 'mustChange', m.must_change, 'user', e.data)
    from app.members m join app.entities e on e.collection = 'users' and e.id = m.user_id and e.del = 0
    where m.auth_id = p_auth_id and coalesce(e.data ->> 'active', 'true') <> 'false');
end $$;

create function public.sys_file_save(p jsonb) returns void language plpgsql volatile security definer set search_path = app, public as $$
begin
  perform app.require_service();
  insert into app.files (id, path, case_id, folder, by_user, name, mime, size, source)
    values (p ->> 'id', p ->> 'path', p ->> 'caseId', p ->> 'folder', p ->> 'by', p ->> 'name', p ->> 'mime', (p ->> 'size')::bigint, p ->> 'source')
    on conflict (id) do nothing;
end $$;

create function public.sys_file(p_id text) returns jsonb language plpgsql stable security definer set search_path = app, public as $$
begin
  perform app.require_service();
  return (select jsonb_build_object('id', id, 'path', path, 'caseId', case_id, 'folder', folder, 'by', by_user, 'name', name, 'mime', mime, 'size', size, 'source', source, 'at', created_at)
    from app.files where id = p_id);
end $$;

create function public.sys_inbox_add(items jsonb) returns int language plpgsql volatile security definer set search_path = app, public as $$
declare added int;
begin
  perform app.require_service();
  with ins as (
    insert into app.inbox (id, item, at)
    select x ->> 'id', x, coalesce((x ->> 'at')::timestamptz, now()) from jsonb_array_elements(items) x where coalesce(x ->> 'id', '') <> ''
    on conflict (id) do nothing returning 1
  ) select count(*) into added from ins;
  return added;
end $$;

create function public.sys_inbox_since(since timestamptz) returns jsonb language plpgsql stable security definer set search_path = app, public as $$
begin
  perform app.require_service();
  return (select jsonb_build_object(
      'items', coalesce((select jsonb_agg(item order by at) from (select item, at from app.inbox where since is null or at > since order by at limit 500) t), '[]'::jsonb),
      'cursor', (select max(at) from app.inbox)));
end $$;

-- ------------------------------------------------------------------ storage and realtime

insert into storage.buckets (id, name, public, file_size_limit)
values ('files', 'files', false, 26214400)
on conflict (id) do nothing;

-- members upload into their own folder (<auth uid>/...) and read every file; nobody deletes from the app
create policy files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'files' and (storage.foldername(name))[1] = auth.uid()::text and public.is_member());
create policy files_read on storage.objects for select to authenticated
  using (bucket_id = 'files' and public.is_member());

alter publication supabase_realtime add table public.sync_feed;
