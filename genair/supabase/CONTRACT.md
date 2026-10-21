# Genair on Supabase - how the parts talk

Project: `alpcxjloqpglpjfvaset` (eu-central-1). URL `https://alpcxjloqpglpjfvaset.supabase.co`.
Publishable key (safe in the browser): `sb_publishable_uag9WizsMH6xx8XsmGO-Xg_JGsHrkRG`.

Three parts:

1. **Database** (`migrations/`): every entity is a row of `app.entities`; the app calls `db_*` functions as the
   signed-in user, Edge Functions call `sys_*` with the service role. Permissions and the per-role read scope are
   inside the functions. Tested in `tests/db.test.js`.
2. **Edge Function `api`** (`functions/api/`): everything the Node server (`../server`) did besides the database -
   integrations, files, customer portal, lead form, user passwords, first setup, Priority sync.
3. **App** (`../app`): talks to the database with supabase-js (auth, RPC, Realtime) and to `api` with fetch.

## Database API (app, signed in)

All are `supabase.rpc(name, args)`; results are JSON exactly like the old `/api/db/*` responses.

| RPC | args | returns |
|---|---|---|
| `db_me` | - | `{ user, mustChange }` |
| `db_snapshot` | - | `{ seq, collections: { [c]: [...] }, config, settings, counters, serverTime, me }`. A collection the role may not read comes as `[]` |
| `db_changes` | `{ since }` | `{ seq, changes: [{ c, id, seq, data } \| { c, id, seq, del: true }] }` or `{ seq, reset: true, changes: [] }`. A record the role may not read comes as `del: true` |
| `db_fetch` | `{ items: [{ c, id }] }` | `{ seq, items: [change...] }` |
| `db_ops` | `{ ops: [{ op, collection, id, data?, unset?, at, ifUnset? }], client_id }` | `{ seq, results: [{ status, seq?, error? }], serverTime }`. status: ok, partial, stale, missing, conflict, denied |
| `db_reserve` | `{ p_key, p_count }` | `{ key, from, to }` |
| `db_password_changed` | - | clears `mustChange` after the user set a new password |

Errors (PostgREST `{ code, message, details }`):
- `42501` + details `revoked`: not a member or deactivated. The device wipes its copy (like a revoked session).
- `22023`: the batch is invalid; never retried (like the old 400).
- JWT expired: supabase-js refreshes by itself; when refresh fails the session is over (`expired`: keep the device's data).

Live updates: subscribe with Realtime to `postgres_changes` `UPDATE` on `public.sync_feed` (one row, `{ id: 1, seq }`)
and pull `db_changes(since)` when `seq` moves. Poll `db_changes` every 30 s as a fallback.

## Logins

Supabase Auth, email + password. Each employee's account email is derived, not typed:

- the user has a phone: `<digits of the phone, Israeli 05...>@phone.genair.app` (e.g. `0502201100@phone.genair.app`)
- no phone: their email, lowercased.

`loginEmail(input)`: input containing `@` → lowercased input; otherwise normalize the phone (digits, `972...` →
`0...`) → `<phone>@phone.genair.app`. The app signs in with `supabase.auth.signInWithPassword({ email, password })`
(per-IP rate limits of Supabase Auth apply to the employee's own device). Then `db_me`.
An employee with a phone signs in with the phone.

Changing one's own password: `supabase.auth.updateUser({ password })`, then `db_password_changed`, then
`supabase.auth.signOut({ scope: 'others' })`.

## Edge Function `api`

`https://alpcxjloqpglpjfvaset.supabase.co/functions/v1/api/...` - the path inside the function is the old server
path, so the app's base URL is `https://<ref>.supabase.co/functions/v1` and every old path (`/api/priority/items`)
stays the same. Deployed with `verify_jwt: false`; the function checks access itself:

- **signed in**: `Authorization: Bearer <Supabase access token>`; the function resolves the member with
  `sys_member_by_auth(auth user id)` (null = not a member / deactivated → 401 `{ error: { code: 'unauthorized', details: { reason: 'revoked' } } }`).
- **public**: health, portal, lead form, WhatsApp and Priority webhooks.
- **cron**: header `x-cron-key: <PRIORITY_CRON_SECRET>`.

Errors keep the old format `{ error: { code, message, details? } }` (Hebrew messages).

| Route | Access | Notes |
|---|---|---|
| `GET /api/health` | public | `{ ok, db: { mode: 'supabase', ready, bootstrapped, bootstrapToken: true } }`; signed in: also `version`, `features` |
| `POST /api/auth/bootstrap` | public | `{ snapshot, adminUserId, password, bootstrapToken }`. Only when `sys_is_empty()`, and only with the `BOOTSTRAP_TOKEN` secret. Imports (`sys_import`), creates the admin's auth account, links it (`sys_set_member`), signs in and returns `{ session: { access_token, refresh_token, expires_in }, user, seq }` |
| `GET /api/auth/users` | admin, office | `{ users: [{ id, hasPassword, mustChange, lastLoginAt, passwordSetAt, login }] }` |
| `POST /api/auth/users/:id/password` | admin | `{ password? , mustChange? }` → creates or updates the user's auth account (email = derived login email, confirmed), `sys_set_member`. No password → `{ ok, temporaryPassword, login }`. Two users with the same login (same phone) → 409 |
| `POST /api/files` | signed in | raw body, `content-type`, `x-file-name`, optional `x-case-id`, `x-folder`, `x-drive-folder-id` → Storage bucket `files` at `<auth uid>/<fileId>-<safe name>` + `sys_file_save` → `{ fileId, name, mime, size, driveFileId?, webViewLink? }` |
| `GET /api/files/:id` | signed in | the file, same safe headers as the Node server |
| `/api/priority/*`, `/api/ai/messages`, `/api/whatsapp/send`, `/api/whatsapp/inbox`, `/api/google/*` | signed in | as in the Node server, with the same per-user limits; the inbox is `sys_inbox_add` / `sys_inbox_since` |
| `GET/POST /api/whatsapp/webhook` | public | Meta's verification and signed webhook (requires `WHATSAPP_APP_SECRET`) |
| `GET /api/priority/sync/status`, `POST /api/priority/sync/run` | admin, office | |
| `POST /api/priority/webhook?key=` | public + `PRIORITY_WEBHOOK_SECRET` | |
| `POST /api/priority/cron` | cron key | one round of the Priority engine (pg_cron calls it every minute when `PRIORITY_SYNC=on`) |
| `/api/portal/:token/*`, `POST /api/public/leads` | public | as in the Node server |

Inside the function the Node server's modules run unchanged where possible: a `PgStore` (the server's `DocStore`
loaded from `sys_dump()`, writes applied in memory and persisted with `sys_apply` before the response) stands in
for the JSON-file database, and Storage stands in for `DATA_DIR/files`.

Secrets (Edge Function secrets, set in the Supabase dashboard): `BOOTSTRAP_TOKEN`, `ALLOWED_ORIGINS`, and per
integration the same variables as `server/.env.example` (`PRIORITY_*`, `ANTHROPIC_API_KEY`, `WHATSAPP_*`,
`GOOGLE_*`), plus `PRIORITY_CRON_SECRET`. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided by Supabase.

## App configuration

Built with `VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY` → server mode (login, shared data). Without them the app
runs as the demo (data in the browser), as before.
