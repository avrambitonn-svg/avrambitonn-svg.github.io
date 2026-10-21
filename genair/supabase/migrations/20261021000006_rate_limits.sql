-- Rate limits shared by every instance of the Edge Function: a counter per key and time window, updated
-- atomically. In-memory counters would not hold: each call may land on another instance, and instances restart.
create table app.rate (
  key text primary key,
  reset_at timestamptz not null,
  count int not null default 0
);
alter table app.rate enable row level security;

-- counts one event for `p_key` (or only checks, p_peek) in a window of p_window_ms; { allowed, retryAfterMs }
create function public.sys_hit(p_key text, p_max int, p_window_ms int, p_peek boolean default false) returns jsonb
language plpgsql volatile security definer set search_path = app, public as $$
declare
  add int := case when p_peek then 0 else 1 end;
  n int;
  until timestamptz;
begin
  perform app.require_service();
  insert into app.rate as r (key, reset_at, count) values (left(p_key, 200), now() + make_interval(secs => p_window_ms / 1000.0), add)
  on conflict (key) do update set
    count = case when r.reset_at <= now() then add else r.count + add end,
    reset_at = case when r.reset_at <= now() then now() + make_interval(secs => p_window_ms / 1000.0) else r.reset_at end
  returning r.count, r.reset_at into n, until;
  return jsonb_build_object(
    'allowed', case when p_peek then n < p_max else n <= p_max end,
    'retryAfterMs', greatest(0, (extract(epoch from (until - now())) * 1000)::bigint));
end $$;
