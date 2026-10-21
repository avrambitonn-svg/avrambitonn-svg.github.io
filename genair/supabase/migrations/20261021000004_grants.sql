-- Who may call what. The server's sys_* functions also check for the service role themselves (app.require_service),
-- and the db_* functions require a signed-in member (app.require_me), so these grants are a second layer.


alter function app.now_ms() set search_path = app, public;
alter function app.to_ms(jsonb) set search_path = app, public;
alter function app.bad(text) set search_path = app, public;
alter function app.is_manager(jsonb) set search_path = app, public;
alter function app.max_seq() set search_path = app, public;
alter function app.clean_data(text, jsonb) set search_path = app, public;
alter function app.parse_op(jsonb, int, bigint) set search_path = app, public;
alter function app.check_user(jsonb, jsonb, jsonb) set search_path = app, public;
alter function app.check_op(jsonb, jsonb, jsonb) set search_path = app, public;
alter function app.scope(text, jsonb, jsonb) set search_path = app, public;
alter function app.change_row(app.entities, jsonb) set search_path = app, public;

revoke all on all functions in schema app from public;
revoke execute on all functions in schema public from public, anon;
grant execute on function public.db_me(), public.db_snapshot(), public.db_changes(bigint), public.db_fetch(jsonb), public.db_ops(jsonb, text),
  public.db_reserve(text, int), public.db_password_changed(), public.db_register_file(text, text, text, text, text, text, bigint), public.is_member()
  to authenticated;
revoke execute on function public.sys_apply(jsonb, text), public.sys_dump(), public.sys_reserve(text, int), public.sys_is_empty(), public.sys_import(jsonb),
  public.sys_set_member(uuid, text, text, boolean), public.sys_members(), public.sys_member_by_auth(uuid), public.sys_file_save(jsonb), public.sys_file(text),
  public.sys_inbox_add(jsonb), public.sys_inbox_since(timestamptz)
  from authenticated;
grant execute on function public.sys_apply(jsonb, text), public.sys_dump(), public.sys_reserve(text, int), public.sys_is_empty(), public.sys_import(jsonb),
  public.sys_set_member(uuid, text, text, boolean), public.sys_members(), public.sys_member_by_auth(uuid), public.sys_file_save(jsonb), public.sys_file(text),
  public.sys_inbox_add(jsonb), public.sys_inbox_since(timestamptz)
  to service_role;

