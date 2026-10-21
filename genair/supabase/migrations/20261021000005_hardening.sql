-- Hardening after a second review: a security log, an immutable activity log, sync state that only the server
-- writes for installers, contract prices hidden from installers, and the author of every activity recorded by
-- the server.

-- ------------------------------------------------------------------ security log
create table app.audit (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor text,
  action text not null,
  detail jsonb not null default '{}'::jsonb
);
create index audit_at on app.audit (at);
alter table app.audit enable row level security;

-- from the Edge Function: first setup, passwords, rejected webhooks and keys
create function public.sys_audit(p_action text, p_actor text default null, p_detail jsonb default '{}'::jsonb) returns void
language plpgsql volatile security definer set search_path = app, public as $$
begin
  perform app.require_service();
  insert into app.audit (actor, action, detail) values (left(p_actor, 128), left(p_action, 60), coalesce(p_detail, '{}'::jsonb));
end $$;

-- managers read the log (newest first)
create function public.db_audit(p_limit int default 200) returns jsonb language plpgsql stable security definer set search_path = app, public as $$
declare me jsonb := app.require_me();
begin
  if not app.is_manager(me) then raise exception using errcode = '42501', message = 'manager_only'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('at', at, 'actor', actor, 'action', action, 'detail', detail) order by id desc)
    from (select * from app.audit order by id desc limit least(greatest(coalesce(p_limit, 200), 1), 1000)) t), '[]'::jsonb);
end $$;

-- ------------------------------------------------------------------ permissions and read scope
create or replace function app.check_op(op jsonb, cur jsonb, me jsonb) returns text language plpgsql stable set search_path = app, public as $$
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

  -- the activity log is a record of what happened: nobody rewrites it, only an admin deletes an entry
  if c = 'activities' then
    if o = 'remove' then return case when role = 'admin' then null else 'admin_only' end; end if;
    if cur is not null then return 'append_only'; end if;
  end if;
  -- sync state is the Priority engine's (an installer setting "synced" would keep a record from going out)
  if role = 'installer' and ((d ? 'sync' and (d -> 'sync') is distinct from (cur -> 'sync')) or coalesce((op -> 'unset') ? 'sync', false)) then
    return 'installer_scope';
  end if;

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

create or replace function app.scope(c text, d jsonb, me jsonb) returns jsonb language plpgsql immutable set search_path = app, public as $$
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
    when 'contracts' then
      if role = 'installer' then d := d - 'pricePerYear'; end if;
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

-- the server records who wrote each activity (data.by), whatever the device sent; denied writes go to the log
create or replace function public.db_ops(ops jsonb, client_id text default null) returns jsonb language plpgsql volatile security definer set search_path = app, public as $$
declare
  me jsonb := app.require_me();
  signed jsonb;
  res jsonb;
begin
  if ops is not null and jsonb_typeof(ops) = 'array' then
    select coalesce(jsonb_agg(case when x ->> 'collection' = 'activities' and jsonb_typeof(x -> 'data') = 'object'
      then jsonb_set(x, '{data,by}', to_jsonb(me ->> 'id')) else x end order by o), '[]'::jsonb)
    into signed from jsonb_array_elements(ops) with ordinality t(x, o);
  else
    signed := ops;
  end if;
  res := app.apply(signed, me, me ->> 'id');
  insert into app.audit (actor, action, detail)
  select me ->> 'id', 'op_denied', jsonb_build_object('collection', signed -> (r.o - 1)::int ->> 'collection', 'id', signed -> (r.o - 1)::int ->> 'id', 'op', signed -> (r.o - 1)::int ->> 'op', 'reason', r.x ->> 'error')
  from jsonb_array_elements(res -> 'results') with ordinality r(x, o)
  where r.x ->> 'status' = 'denied';
  return res;
end $$;

grant execute on function public.db_audit(int) to authenticated;
