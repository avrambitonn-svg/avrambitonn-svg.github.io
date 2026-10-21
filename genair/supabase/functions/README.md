# Edge Function `api`

כל מה שהשרת (`../../server`) עשה חוץ ממסד הנתונים: Priority (כולל הסנכרון האוטומטי), ה-AI, וואטסאפ, Google,
קבצים, האזור האישי של הלקוח, טופס הלידים, סיסמאות של עובדים והקמה ראשונה. הנתיבים זהים לשרת (`/api/...`),
והחוזה המלא ב-[`../CONTRACT.md`](../CONTRACT.md).

## איך זה בנוי

- `api/index.ts`: נקודת הכניסה (`Deno.serve`). `api/src/router.js` הוא הנתב של השרת עם בדיקת גישה מול Supabase Auth.
- המודולים של השרת רצים כמו שהם: `priority.js`, `anthropic.js`, `whatsapp.js`, `google.js`, `portal.js`, `auth.js`
  (בדיקת ה-snapshot, סיסמאות זמניות) ומנוע הסנכרון `psync/*`.
- `PgStore` (`api/src/pgstore.js`): ה-`DocStore` של השרת, נטען מ-`sys_dump()` לכל בקשה. כתיבות חלות בזיכרון
  ונשלחות ב-`sys_apply` לפני התשובה. מספור (`reserve`) נעשה במסד (`sys_reserve`), כך שאין כפילויות.
- שני מודולים של השרת מוחלפים בבנייה: `db/index.js` (במקומו `api/src/db.js`) ו-`files.js` (במקומו `api/src/files.js`, קבצים ב-Storage).
- קבצים: באקט פרטי `files`. העלאה של עובד נשמרת ב-`<auth uid>/<fileId>-<name>`, מהאזור האישי ומטופס הלידים
  ב-`portal/<caseId>/...`, ונרשמת ב-`sys_file_save`. אין `FILES_QUOTA_MB`: חלה המגבלה של הבאקט (25MB לקובץ) והמכסה של הפרויקט.
- תיבת וואטסאפ: `sys_inbox_add` / `sys_inbox_since` במקום הזיכרון.
- סנכרון Priority: אין תהליך שרץ ברקע. pg_cron קורא כל דקה ל-`POST /api/priority/cron`, וכל קריאה היא סבב אחד של
  המנוע: hot בכל דקה, warm כל `PRIORITY_SYNC_WARM_SEC`, full כל 6 שעות. השינויים של המשתמשים נשלחים בסבב הבא (עד דקה).
  סבב אחד בכל פעם (נעילה ב-`integrations/priority-lock`). סבב מפסיק לפנות ל-Priority אחרי `PRIORITY_EDGE_DEADLINE_SEC`
  (ברירת מחדל 110 שניות), והסבב הבא ממשיך.

## סודות (Edge Function secrets)

Supabase מספקת בעצמה: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`.

| משתנה | למה |
|---|---|
| `BOOTSTRAP_TOKEN` | חובה להקמה הראשונה (בלעדיו אין הקמה) |
| `ALLOWED_ORIGINS` | הכתובת של האפליקציה, למשל `https://genair.vercel.app` (פסיקים בין כמה). תמיד מותרים גם `null` (ההתקנה כקובץ אחד ב-Windows), ובלי הגדרה `http://localhost:5173`, `http://localhost:4173` |
| `PRIORITY_CRON_SECRET` | המפתח ש-pg_cron שולח ב-`x-cron-key` |
| `PRIORITY_MODE`, `PRIORITY_URL`, `PRIORITY_PAT` או `PRIORITY_USER`+`PRIORITY_PASSWORD`, `PRIORITY_APP_ID`, `PRIORITY_APP_KEY`, `PRIORITY_ALLOW_WRITE` | החיבור ל-Priority, כמו ב-`server/.env.example` |
| `PRIORITY_SYNC=on`, `PRIORITY_SYNC_*`, `PRIORITY_WEBHOOK_SECRET`, `PRIORITY_WAREHOUSES`, `PRIORITY_CUSTOMER_PREFIX`, `PRIORITY_IMPORT_*`, `PRIORITY_AUTO_ACTIVATE`, `PRIORITY_GENERIC_PART`, `PRIORITY_FILES_MAX_MB` | הסנכרון האוטומטי |
| `PRIORITY_EDGE_DEADLINE_SEC` | אופציונלי: כמה זמן סבב סנכרון רשאי לרוץ (ברירת מחדל 110) |
| `ANTHROPIC_API_KEY`, `AI_ALLOWED_MODELS`, `AI_ALLOWED_BETAS`, `AI_MAX_TOKENS`, `AI_TIMEOUT_MS` | ה-AI |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_GRAPH_VERSION` | וואטסאפ |
| `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_CALENDAR_ID`, `GOOGLE_DRIVE_PARENT_ID`, `GOOGLE_SUBJECT`, `GOOGLE_DRIVE_SCOPE` | Google |
| `FILES_MAX_MB`, `PORTAL_TTL_DAYS` | אופציונלי, כמו בשרת |

## בנייה ופריסה

```bash
cd genair/supabase/functions
npm install          # esbuild ו-pg (לבדיקות), בגרסאות נעולות
node build.mjs       # -> api/dist/index.js, קובץ אחד
npm test             # בונה ומריץ את הבדיקות (צריך את Postgres המקומי, ראו ../tests)
```

פורסים את **`api/dist/index.js`** בלבד, כפונקציה בשם `api` עם `verify_jwt = false` (הפונקציה בודקת גישה בעצמה).
לא לפרוס את `index.ts` ישירות: הבנייה היא שמחליפה את מודולי הקבצים ומסד הנתונים של השרת.

- עם ה-CLI: ב-`supabase/config.toml`
  ```toml
  [functions.api]
  verify_jwt = false
  entrypoint = "./functions/api/dist/index.js"
  ```
  ואז `supabase functions deploy api`.
- או בפריסה של קובץ אחד (Dashboard / MCP): קובץ בשם `index.js` עם התוכן של `api/dist/index.js`, entrypoint `index.js`, `verify_jwt: false`.

הכתובת: `https://<ref>.supabase.co/functions/v1/api/...`.

## סנכרון Priority עם pg_cron

אחרי `PRIORITY_SYNC=on` והסודות של Priority, פעם אחת ב-SQL Editor (המפתח נשמר ב-Vault ולא בטקסט של המשימה):

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('<PRIORITY_CRON_SECRET>', 'priority_cron_secret');

select cron.schedule('genair-priority-sync', '* * * * *', $$
  select net.http_post(
    url := 'https://alpcxjloqpglpjfvaset.supabase.co/functions/v1/api/priority/cron',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'priority_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
$$);
```

לעצור: `select cron.unschedule('genair-priority-sync');`. התשובות של הקריאות ב-`net._http_response`, ומצב הסנכרון במסך הסנכרון באפליקציה.

## לשים לב

- כל בקשה שצריכה את הנתונים (האזור האישי, הלידים, הסנכרון, מסך המשתמשים) טוענת את כל המסד ב-`sys_dump()`. מתאים לחברה בגודל הזה.
- סיסמה שמנהל קובע מנתקת את כל ההתחברויות של אותו עובד (כך עובד ה-Admin API של Supabase Auth). טוקן גישה שכבר הונפק
  ממשיך לעבוד מול מסד הנתונים עד שתוקפו פג (שעה), אבל לא מול הפונקציה.
- מגבלות הקצב (AI, וואטסאפ, הפורטל וכו') נספרות לכל מופע של הפונקציה, לא לכל המערכת.
