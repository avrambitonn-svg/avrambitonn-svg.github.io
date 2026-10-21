-- Validation, write permissions, read scope and the per-field merge (see 20261021000001_core.sql).

-- ------------------------------------------------------------------ validating and cleaning what clients send

-- fields the app turns into links keep only web / mail / phone links or a path inside the app
create function app.clean_data(c text, d jsonb) returns jsonb language plpgsql immutable as $$
declare
  k text;
  v jsonb;
  out jsonb := '{}'::jsonb;
begin
  if d is null or jsonb_typeof(d) <> 'object' then perform app.bad('data חייב להיות אובייקט'); end if;
  for k, v in select * from jsonb_each(d) loop
    continue when k in ('__proto__', 'constructor', 'prototype');
    continue when k in ('url', 'website', 'webViewLink', 'htmlLink', 'link') and jsonb_typeof(v) = 'string'
      and (v #>> '{}') <> '' and (v #>> '{}') !~* '^\s*(https?://|mailto:|tel:|/(?!/))';
    -- secrets never go into the users collection, and device-only settings never into the org settings
    continue when c = 'users' and k in ('password', 'passwordHash', 'hash', 'salt', 'token', 'tempPassword');
    continue when c = 'settings' and k in ('serverUrl', 'appToken', 'anthropicKey');
    out := out || jsonb_build_object(k, v);
  end loop;
  return out;
end $$;

-- validates one op from a client and returns it normalized: { op, collection, id, at, data?, unset?, ifUnset? }
create function app.parse_op(raw jsonb, i int, now_ms bigint) returns jsonb language plpgsql as $$
declare
  o text := raw ->> 'op';
  c text := raw ->> 'collection';
  id text;
  at bigint;
  out jsonb;
  data jsonb;
begin
  if raw is null or jsonb_typeof(raw) <> 'object' then perform app.bad(format('ops[%s] לא תקין', i)); end if;
  if o is null or o not in ('upsert', 'patch', 'remove') then perform app.bad(format('ops[%s].op לא תקין', i)); end if;
  if c is null or c !~ '^[a-z][A-Za-z0-9]{0,39}$' then perform app.bad(format('ops[%s].collection לא תקין', i)); end if;
  id := case when c in ('config', 'settings') then 'org' else raw ->> 'id' end;
  if id is null or id !~ '^[A-Za-z0-9_.:-]{1,128}$' then perform app.bad(format('ops[%s].id לא תקין', i)); end if;
  if c in ('config', 'settings') and o = 'remove' then perform app.bad(format('אי אפשר למחוק את %s', c)); end if;
  at := app.to_ms(raw -> 'at');
  if at is null then perform app.bad(format('ops[%s].at חייב להיות זמן', i)); end if;
  if at <= 0 or at > now_ms + 60000 then at := now_ms; end if; -- clocks that run ahead are clamped
  out := jsonb_build_object('op', o, 'collection', c, 'id', id, 'at', at);
  if o <> 'remove' then
    data := app.clean_data(c, coalesce(raw -> 'data', '{}'::jsonb));
    if octet_length(data::text) > 12 * 1024 * 1024 then perform app.bad(format('ops[%s] גדול מדי', i)); end if;
    out := out || jsonb_build_object('data', data);
  end if;
  if o = 'patch' and raw ? 'unset' then
    if jsonb_typeof(raw -> 'unset') <> 'array' or jsonb_array_length(raw -> 'unset') > 200
       or exists (select 1 from jsonb_array_elements(raw -> 'unset') u where jsonb_typeof(u) <> 'string' or (u #>> '{}') in ('__proto__', 'constructor', 'prototype')) then
      perform app.bad(format('ops[%s].unset לא תקין', i));
    end if;
    out := out || jsonb_build_object('unset', raw -> 'unset');
  end if;
  if o = 'patch' and raw ? 'ifUnset' then
    if jsonb_typeof(raw -> 'ifUnset') <> 'string' then perform app.bad(format('ops[%s].ifUnset לא תקין', i)); end if;
    out := out || jsonb_build_object('ifUnset', raw -> 'ifUnset');
  end if;
  return out;
end $$;

-- ------------------------------------------------------------------ write permissions (server/src/permissions.js)

create function app.check_user(op jsonb, cur jsonb, me jsonb) returns text language plpgsql stable as $$
declare
  role text := op #>> '{data,role}';
  touches_admin boolean;
  after jsonb;
  still_admin boolean;
begin
  if op ->> 'op' <> 'remove' and role is not null and role not in ('admin', 'office', 'agent', 'engineer', 'installer') then
    return 'invalid_role';
  end if;
  -- only an admin creates admins, changes an admin, or grants the admin role
  touches_admin := coalesce(cur ->> 'role', '') = 'admin' or coalesce(role, '') = 'admin';
  if touches_admin and me ->> 'role' <> 'admin' then return 'admin_only'; end if;
  -- never leave the system without an active admin
  if cur ->> 'role' = 'admin' and coalesce(cur ->> 'active', 'true') <> 'false' then
    after := case op ->> 'op' when 'remove' then null when 'upsert' then op -> 'data' else cur || (op -> 'data') end;
    still_admin := after is not null and after ->> 'role' = 'admin' and coalesce(after ->> 'active', 'true') <> 'false'
      and not coalesce((op -> 'unset') ? 'role', false);
    if not still_admin and not exists (
      select 1 from app.entities e
      where e.collection = 'users' and e.del = 0 and e.id <> cur ->> 'id' and e.data ->> 'role' = 'admin' and coalesce(e.data ->> 'active', 'true') <> 'false'
    ) then
      return 'last_admin';
    end if;
  end if;
  return null;
end $$;

create function app.check_op(op jsonb, cur jsonb, me jsonb) returns text language plpgsql stable as $$
declare
  role text := me ->> 'role';
  me_id text := me ->> 'id';
  c text := op ->> 'collection';
  o text := op ->> 'op';
  d jsonb := coalesce(op -> 'data', '{}'::jsonb);
  manager boolean := app.is_manager(me);
  fields text[];
  f record;
  m jsonb;
  van text;
  before_read jsonb;
  after_read jsonb;
  x text;
begin
  if c = 'integrations' then return 'server_only'; end if;
  if c in ('users', 'config', 'settings') and not manager then return 'manager_only'; end if;
  -- invoices and receipts that came from Priority are Priority's (and nobody makes one from the app)
  if c = 'money' and (cur ->> 'source' = 'priority' or d ->> 'source' = 'priority') then return 'priority_owned'; end if;
  -- a stored file can be filed only by whoever uploaded it, or under the case it was uploaded for
  if c = 'docs' and jsonb_typeof(d -> 'fileId') = 'string' and (d ->> 'fileId') is distinct from (cur ->> 'fileId') then
    select * into f from app.files where id = d ->> 'fileId';
    if not found then return 'file_not_found'; end if;
    x := coalesce(d ->> 'caseId', cur ->> 'caseId');
    if f.case_id is not null and f.case_id is distinct from x then return 'file_other_case'; end if;
    if not (manager or f.by_user = me_id or (f.case_id is not null and f.case_id = x)) then return 'not_yours'; end if;
  end if;

  if c = 'users' then return app.check_user(op, cur, me); end if;

  if role = 'installer' then
    if c not in ('appointments', 'serviceCalls', 'stock', 'stockMoves', 'docs', 'messages', 'chat', 'tasks', 'notifications', 'leaves', 'units', 'activities') then
      if c = 'contracts' and o = 'upsert' and cur is null and d ->> 'status' = 'proposed' then return null; end if;
      select array_agg(k) into fields from (
        select k from jsonb_object_keys(d) k where k <> 'id'
        union select u #>> '{}' from jsonb_array_elements(coalesce(op -> 'unset', '[]'::jsonb)) u
      ) s;
      if o <> 'patch' or c not in ('cases', 'contracts') then return 'installer_scope'; end if;
      if c = 'cases' and not (coalesce(fields, '{}') <@ array['stage', 'updatedAt', 'closedAt', 'flow', 'installerIds']) then return 'installer_scope'; end if;
      if c = 'contracts' and not (coalesce(fields, '{}') <@ array['nextVisit']) then return 'installer_scope'; end if;
    end if;
    -- once sent, Priority holds a document for these: add or change, never delete
    if o = 'remove' and c in ('serviceCalls', 'units', 'stockMoves', 'activities') then return 'installer_scope'; end if;
    -- stock moves only into or out of the installer's own van, in sane quantities, until sent to Priority
    if c = 'stockMoves' then
      if cur is not null and (cur ->> 'userId' is distinct from me_id or cur #>> '{sync,status}' = 'synced') then return 'installer_scope'; end if;
      if o <> 'remove' then
        m := coalesce(cur, '{}'::jsonb) || d;
        van := 'רכב — ' || coalesce(me ->> 'name', '');
        if coalesce(m ->> 'kind', '') not in ('transfer', 'use', 'return') then return 'installer_scope'; end if;
        if m ->> 'from' is distinct from van and m ->> 'to' is distinct from van then return 'installer_scope'; end if;
        if jsonb_typeof(m -> 'qty') <> 'number' or (m ->> 'qty')::numeric <= 0 or (m ->> 'qty')::numeric > 1000 then return 'installer_scope'; end if;
        if m ? 'userId' and m ->> 'userId' is distinct from me_id then return 'installer_scope'; end if;
      end if;
    end if;
  end if;

  if not manager then
    -- the activity log is a record of what happened: add to it, never rewrite it
    if c = 'activities' and (o <> 'upsert' or cur is not null) then return 'append_only'; end if;
    -- chat: write as yourself; edit or delete only your own messages. Reading marks yourself in readBy.
    if c = 'chat' then
      if cur is not null and o = 'patch' and not (op ? 'unset') and (select coalesce(bool_and(k in ('readBy', 'id')), true) from jsonb_object_keys(d) k)
         and jsonb_typeof(d -> 'readBy') = 'array' then
        before_read := coalesce(cur -> 'readBy', '[]'::jsonb);
        after_read := d -> 'readBy';
        if not exists (select 1 from jsonb_array_elements_text(after_read) a where not (before_read ? a) and a <> me_id)
           and not exists (select 1 from jsonb_array_elements_text(before_read) b where not (after_read ? b)) then
          return null;
        end if;
      end if;
      if coalesce(cur ->> 'fromId', d ->> 'fromId') is distinct from me_id or (d ? 'fromId' and d ->> 'fromId' is distinct from me_id) then return 'not_yours'; end if;
    end if;
    -- notifications: anyone may create one for anyone (short, linking inside the app); only the addressee changes it
    if c = 'notifications' then
      if cur is not null and cur ->> 'userId' is distinct from me_id then return 'not_yours'; end if;
      if cur is null then
        if jsonb_typeof(d -> 'text') is distinct from 'string' or length(d ->> 'text') > 300 then return 'invalid_notification'; end if;
        if d ? 'link' and (jsonb_typeof(d -> 'link') <> 'string' or left(d ->> 'link', 1) <> '/' or left(d ->> 'link', 2) = '//' or length(d ->> 'link') > 300) then
          return 'invalid_notification';
        end if;
      end if;
    end if;
    -- leave requests: own only, nobody approves their own, and once decided it is the managers'
    if c = 'leaves' then
      if coalesce(cur ->> 'userId', d ->> 'userId') is distinct from me_id or (d ? 'userId' and d ->> 'userId' is distinct from me_id) then return 'not_yours'; end if;
      if cur is not null and cur ->> 'status' in ('approved', 'rejected') then return 'manager_only'; end if;
      if d ->> 'status' in ('approved', 'rejected') or d ? 'decidedBy' or d ? 'decidedAt' then return 'manager_only'; end if;
    end if;
  end if;
  return null;
end $$;

-- ------------------------------------------------------------------ read scope (server/src/readscope.js)

-- What a role may read of one document: the document (possibly reduced), or null to leave it out.
create function app.scope(c text, d jsonb, me jsonb) returns jsonb language plpgsql immutable as $$
declare
  role text := me ->> 'role';
  k text;
  v jsonb;
  out jsonb;
begin
  if d is null then return null; end if;
  if app.is_manager(me) or c in ('config', 'settings') then return d; end if;
  if role = 'installer' and c in ('suppliers', 'purchaseOrders') then return null; end if;
  case c
    when 'integrations' then
      return jsonb_build_object('id', d ->> 'id', 'engine', jsonb_build_object('active', coalesce((d #>> '{engine,active}')::boolean, false)));
    when 'money' then
      return case when role = 'agent' and d ->> 'kind' = 'commission' and d ->> 'agentId' = me ->> 'id' then d else null end;
    when 'catalog' then
      d := d - 'cost';
    when 'customers' then
      d := d - 'balance';
      if role = 'installer' then d := d - 'idNumber'; end if;
    when 'quotes' then
      if role = 'installer' then
        if d ->> 'status' <> 'approved' then return null; end if;
        return jsonb_strip_nulls(jsonb_build_object(
          'id', d -> 'id', 'caseId', d -> 'caseId', 'number', d -> 'number', 'version', d -> 'version', 'status', d -> 'status',
          'createdAt', d -> 'createdAt', 'decidedAt', d -> 'decidedAt',
          'lines', coalesce((
            select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', l -> 'id', 'itemId', l -> 'itemId', 'description', l -> 'description', 'qty', l -> 'qty', 'unit', l -> 'unit', 'room', l -> 'room')) || '{"unitPrice":0}'::jsonb)
            from jsonb_array_elements(coalesce(d -> 'lines', '[]'::jsonb)) l
          ), '[]'::jsonb)));
      end if;
    else null;
  end case;
  -- sync states ({ status, error }) keep their status; Priority's own error text stays with the managers
  out := d;
  for k, v in select * from jsonb_each(d) loop
    if jsonb_typeof(v) = 'object' and jsonb_typeof(v -> 'status') = 'string' and jsonb_typeof(v -> 'error') = 'string' and v ->> 'error' <> '' then
      out := jsonb_set(out, array[k, 'error'], to_jsonb('שגיאת סנכרון. הפרטים אצל המשרד'::text));
    end if;
  end loop;
  return out;
end $$;

create function app.change_row(e app.entities, me jsonb) returns jsonb language plpgsql stable as $$
declare d jsonb;
begin
  if e.del > 0 then return jsonb_build_object('c', e.collection, 'id', e.id, 'seq', e.seq, 'del', true); end if;
  d := case when me is null then e.data else app.scope(e.collection, e.data, me) end;
  if d is null then return jsonb_build_object('c', e.collection, 'id', e.id, 'seq', e.seq, 'del', true); end if;
  return jsonb_build_object('c', e.collection, 'id', e.id, 'seq', e.seq, 'data', d);
end $$;

-- ------------------------------------------------------------------ applying ops (server/src/db/store.js applyOps)

-- me: the acting user's document, checked against app.check_op; null for the server itself (no check).
create function app.apply(raw_ops jsonb, me jsonb, actor text) returns jsonb language plpgsql security definer set search_path = app, public as $$
declare
  now_ms bigint := app.now_ms();
  ops jsonb := '[]'::jsonb;
  n int;
  i int;
  op jsonb;
  c text;
  oid text;
  at bigint;
  r app.entities;
  cur jsonb;
  reason text;
  base jsonb;
  fat jsonb;
  k text;
  v jsonb;
  partial boolean;
  applied int;
  skipped int;
  results jsonb := '[]'::jsonb;
  touched jsonb := '{}'::jsonb; -- "c|id" -> true
  res jsonb;
  key text;
  final_seq bigint;
  max_at bigint;
begin
  if raw_ops is null or jsonb_typeof(raw_ops) <> 'array' or jsonb_array_length(raw_ops) = 0 then perform app.bad('ops חייב להיות מערך לא ריק'); end if;
  if jsonb_array_length(raw_ops) > 500 then perform app.bad('עד 500 פעולות בבקשה'); end if;
  n := jsonb_array_length(raw_ops);
  for i in 0 .. n - 1 loop
    ops := ops || jsonb_build_array(app.parse_op(raw_ops -> i, i, now_ms));
  end loop;

  perform pg_advisory_xact_lock(4242);

  for i in 0 .. n - 1 loop
    op := ops -> i;
    c := op ->> 'collection';
    oid := op ->> 'id';
    at := (op ->> 'at')::bigint;
    key := c || '|' || oid;
    select * into r from app.entities where collection = c and id = oid for update;
    cur := case when found and r.del = 0 then r.data else null end;
    if me is not null then
      reason := app.check_op(op, cur, me);
      if reason is not null then
        results := results || jsonb_build_array(jsonb_build_object('status', 'denied', 'error', reason));
        continue;
      end if;
    end if;

    if op ->> 'op' = 'remove' then
      if r.id is null then
        insert into app.entities (collection, id, data, field_at, cseq, seq, del, ts, by)
        values (c, oid, jsonb_build_object('id', oid), '{}'::jsonb, nextval('app.cseq_gen'), 0, at, now_ms, actor);
        results := results || '[{"status":"ok"}]'::jsonb;
      elsif r.del > 0 then
        results := results || '[{"status":"ok"}]'::jsonb;
      else
        select coalesce(max(value::bigint), 0) into max_at from jsonb_each_text(r.field_at);
        if at < max_at then
          results := results || '[{"status":"stale"}]'::jsonb;
        else
          update app.entities set del = at, seq = nextval('app.seq_gen'), ts = now_ms, by = actor where collection = c and id = oid;
          touched := touched || jsonb_build_object(key, true);
          results := results || jsonb_build_array(jsonb_build_object('status', 'ok', 'key', key));
        end if;
      end if;
      r := null;
      continue;
    end if;

    if op ->> 'op' = 'upsert' then
      if r.id is null then
        base := (op -> 'data') || jsonb_build_object('id', oid);
        select coalesce(jsonb_object_agg(f, at), '{}'::jsonb) into fat from jsonb_object_keys(base) f;
        insert into app.entities (collection, id, data, field_at, cseq, seq, del, ts, by)
        values (c, oid, base, fat, nextval('app.cseq_gen'), nextval('app.seq_gen'), 0, now_ms, actor);
        touched := touched || jsonb_build_object(key, true);
        results := results || jsonb_build_array(jsonb_build_object('status', 'ok', 'key', key));
        r := null;
        continue;
      end if;
      if r.del > 0 and r.del > at then
        results := results || '[{"status":"stale"}]'::jsonb;
        r := null;
        continue;
      end if;
      fat := r.field_at;
      if r.del > 0 then
        base := jsonb_build_object('id', oid);
        select coalesce(jsonb_object_agg(f, greatest(value::bigint, r.del)), '{}'::jsonb) into fat from jsonb_each_text(r.field_at) as t(f, value);
      else
        base := r.data;
      end if;
      partial := false;
      for k, v in select * from jsonb_each(op -> 'data') loop
        continue when k = 'id';
        if at >= coalesce((fat ->> k)::bigint, 0) then
          base := base || jsonb_build_object(k, v);
          fat := fat || jsonb_build_object(k, at);
        else
          partial := true;
        end if;
      end loop;
      for k in select jsonb_object_keys(base) loop
        continue when k = 'id' or (op -> 'data') ? k;
        if at >= coalesce((fat ->> k)::bigint, 0) then
          base := base - k;
          fat := fat || jsonb_build_object(k, at); -- tombstone: an older write cannot bring the field back
        else
          partial := true;
        end if;
      end loop;
      update app.entities set data = base, field_at = fat, del = 0, seq = nextval('app.seq_gen'), ts = now_ms, by = actor,
        cseq = case when r.del > 0 then nextval('app.cseq_gen') else cseq end
      where collection = c and id = oid;
      touched := touched || jsonb_build_object(key, true);
      results := results || jsonb_build_array(jsonb_build_object('status', case when partial then 'partial' else 'ok' end, 'key', key));
      r := null;
      continue;
    end if;

    -- patch
    if r.id is null then
      results := results || '[{"status":"missing"}]'::jsonb;
      continue;
    end if;
    if r.del > 0 then
      results := results || '[{"status":"stale"}]'::jsonb;
      r := null;
      continue;
    end if;
    if op ? 'ifUnset' and r.data ? (op ->> 'ifUnset') and jsonb_typeof(r.data -> (op ->> 'ifUnset')) <> 'null' then
      results := results || '[{"status":"conflict"}]'::jsonb;
      r := null;
      continue;
    end if;
    base := r.data;
    fat := r.field_at;
    applied := 0;
    skipped := 0;
    for k, v in select * from jsonb_each(coalesce(op -> 'data', '{}'::jsonb)) loop
      continue when k = 'id';
      if at >= coalesce((fat ->> k)::bigint, 0) then
        base := base || jsonb_build_object(k, v);
        fat := fat || jsonb_build_object(k, at);
        applied := applied + 1;
      else
        skipped := skipped + 1;
      end if;
    end loop;
    for k in select jsonb_array_elements_text(coalesce(op -> 'unset', '[]'::jsonb)) loop
      continue when k = 'id';
      if at >= coalesce((fat ->> k)::bigint, 0) then
        base := base - k;
        fat := fat || jsonb_build_object(k, at);
        applied := applied + 1;
      else
        skipped := skipped + 1;
      end if;
    end loop;
    if applied = 0 then
      results := results || jsonb_build_array(jsonb_build_object('status', case when skipped > 0 then 'stale' else 'ok' end));
    else
      update app.entities set data = base, field_at = fat, seq = nextval('app.seq_gen'), ts = now_ms, by = actor where collection = c and id = oid;
      touched := touched || jsonb_build_object(key, true);
      results := results || jsonb_build_array(jsonb_build_object('status', case when skipped > 0 then 'partial' else 'ok' end, 'key', key));
    end if;
    r := null;
  end loop;

  -- every result reports the record's final seq (a record touched twice in one batch has the later one)
  select coalesce(jsonb_agg(
    case when x ? 'key' then (x - 'key') || jsonb_build_object('seq', (select e.seq from app.entities e
      where e.collection = split_part(x ->> 'key', '|', 1) and e.id = substr(x ->> 'key', strpos(x ->> 'key', '|') + 1)))
    else x end order by ord), '[]'::jsonb)
  into results from jsonb_array_elements(results) with ordinality as t(x, ord);

  final_seq := app.max_seq();
  if touched <> '{}'::jsonb then
    update public.sync_feed set seq = final_seq, at = now() where id = 1;
  end if;
  return jsonb_build_object('seq', final_seq, 'results', results, 'serverTime', app.now_ms());
end $$;

