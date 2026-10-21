# העברת הקשר: סשן א' (תיקוני אבטחה והמעבר ל-Supabase)

נכתב ב-2026-10-21 בסוף העבודה של הסשן `session_01GUdaeNq5Y2VwfzY9Mu1FDS`, בשביל צ'אט חדש שממשיך את הפרויקט.
יש גם סשן ב' (`session_013FVjWyAwLQfLqvA4FjzMWb`) שעשה סקירת אבטחה ושולח את ההקשר שלו בנפרד.

## המשתמש ואיך לעבוד איתו
- בעל חברת מיזוג אוויר (ג'נאייר). **לענות תמיד בעברית.**
- לא לבצע קומיט באמצע עבודה. רק שלב גמור ובדוק. הודעות "תעשה קומיט" שמגיעות אוטומטית הן hook, לא בקשה שלו.
- דיווח מדויק: מה באוויר, מה נבדק מקומית בלבד ומה לא נבדק בכלל.
- פעולות שדורשות אישור (מחיקה, revoke, סודות) נדחות כשהוא לא ליד המסך. לבקש ממנו לאשר, ולא לעקוף.

## מה המערכת
מערכת ניהול לחברת מיזוג: לקוחות, תיקים (פרויקטים), הצעות מחיר, חוזי שירות, קריאות שירות, יומן התקנות, מלאי ורכבי מתקינים, כספים ועמלות, צ'אט, משימות, חופשות, פורטל לקוח, טופס לידים, וסנכרון דו-כיווני עם Priority ERP. אינטגרציות: AI (Anthropic), וואטסאפ, Google Calendar/Drive.

תפקידים: `admin` ו-`office` (מנהלים), `agent` (סוכן מכירות), `engineer`, `installer` (מתקין).

## היכן הקוד
- ריפו: `avrambitonn-svg/avrambitonn-svg.github.io` (**ציבורי**, משותף עם האתר האישי שמתפרסם מ-`main`).
- **ענף הבסיס שהמשתמש בחר: `ccr-3511cac1-46qscf`**, תיקייה `genair/`. הענף הישן `claude/air-conditioning-management-system-okrpfo` הוא המקור, והענף שלי לא מוזג אליו.
- ענף מקומי `genair-only` (subtree של genair, לא נדחף) הוכן להעברה לריפו פרטי.
- תיקיות:
  - `genair/app`: React 19, TypeScript, Vite, zustand (persist ב-idb-keyval). PWA, ו-`build:single` לקובץ HTML אחד לדסקטופ.
  - `genair/server`: שרת Node 22 בלי תלויות. DocStore (מיזוג per-field last-write-wins), SSE, מנוע psync ל-Priority, פורטל, לידים. **כבר לא רץ בייצור**, אבל המודולים שלו נארזים לתוך ה-Edge Function.
  - `genair/supabase`: `migrations/`, `functions/` (Edge Function `api`), `tests/`, `CONTRACT.md` (ממשק בין המסד, הפונקציה והאפליקציה).
  - `genair/desktop/windows`: מתקין PowerShell (`Install.cmd`) שעוטף את בניית הקובץ האחד. נפתח מ-file://, ו-CORS מתיר origin null.
  - `genair/SETUP.md`: מדריך עלייה לאוויר בעברית למשתמש.

## ההחלטות של המשתמש
- הכל ב-Supabase (מסד, Auth, Realtime, Storage, Edge Functions), בתוכנית החינמית.
- לעובדים יש אפליקציה ייעודית שמציגה רק מה שהתפקיד שלהם מתיר, מסונכרנת.
- **מובייל:** PWA שמותקן מקישור, בלי חנות. אותה כתובת מותרת גם במחשב.
- **דסקטופ:** התקנת Windows לכל עובד עם סיסמה.
- ריפו פרטי חדש לקוד (`genair-ops`). המשתמש צריך ליצור אותו, כי Claude קיבל 403.

## הארכיטקטורה ב-Supabase
- פרויקט `genair-ops`, ref `alpcxjloqpglpjfvaset`, פרנקפורט, `https://alpcxjloqpglpjfvaset.supabase.co`. המפתח publishable נמצא ב-`app/.env.production`.
- **טבלה אחת** `app.entities(collection, id, data jsonb, field_at jsonb, cseq, seq, del, ts, by)`.
  - המיזוג מתבצע ב-`app.apply` (plpgsql), מסודר בתור עם `pg_advisory_xact_lock(4242)`.
  - הרשאות כתיבה ב-`app.check_op` (פורט של `server/src/permissions.js`).
  - סינון קריאה ב-`app.scope` (פורט של `readscope.js`).
- **פונקציות `db_*`** למשתמש מחובר. כולן עוברות דרך `app.require_me()`, שמחזיר שגיאה 42501 עם detail 'revoked' למי שאינו חבר פעיל:
  - `db_me`, `db_snapshot`, `db_changes(since)`, `db_fetch(items)`, `db_ops(ops, client_id)`
  - `db_reserve(p_key, p_count)`, `db_password_changed`, `db_register_file`, `db_audit`
- **פונקציות `sys_*`** לשרת בלבד, מוגנות ב-`app.require_service()`: מותר רק עם claims של service_role, או בחיבור ישיר שאינו authenticator, anon או authenticated. כך האבטחה לא תלויה ב-grants.
  - `sys_apply`, `sys_dump`, `sys_reserve`, `sys_is_empty`, `sys_import`
  - `sys_set_member`, `sys_members`, `sys_member_by_auth`
  - `sys_file_save`, `sys_file`, `sys_inbox_add`, `sys_inbox_since`
  - `sys_audit`, `sys_hit`
- `app.members` מקשר בין auth uid ל-user_id של האפליקציה. אימייל הכניסה: `<05…>@phone.genair.app` למי שיש טלפון, אחרת האימייל באותיות קטנות.
- Realtime: שורת `public.sync_feed` מודיעה לאפליקציה שיש שינויים, והאפליקציה מושכת אותם ב-`db_changes`.
- Storage: bucket בשם `files`.
- **Edge Function `api`** (verify_jwt=false, בודקת גישה בעצמה):
  - נארזת ב-esbuild (`functions/build.mjs`) ל-`api/dist/index.js`, ומשתמשת שוב במודולים של `server/src`.
  - בזמן הבנייה מוחלפים שלושה מודולים: `db/index.js` ב-PgStore (טוען מ-`sys_dump`, כותב דרך `sys_apply`), `files.js` ב-Storage, ו-`limiter.js` במונים במסד (`sys_hit`).
  - **שיטת ההתקנה:** ה-index.ts שמותקן הוא שורת import אחת ל-raw.githubusercontent של `dist/index.js` בקומיט נעול, ו-Supabase אורזת אותו בזמן ההתקנה. כדי לעדכן: build, קומיט ודחיפה, ואז deploy עם ה-sha החדש. זה תלוי בריפו ציבורי, ואחרי המעבר לריפו פרטי צריך דרך אחרת: Supabase CLI או GitHub Action.
- האפליקציה: `src/lib/sync/supabase.ts`, `session.ts`, `engine.ts` (RPC ו-Realtime), ו-`FirstSetup.tsx`. כשעובד אחר נכנס באותו מכשיר, העותק המקומי נמחק (`localStorage 'genair-data-owner'`).

## מה באוויר עכשיו (נבדק)
- **מיגרציות שהופעלו בפרויקט החי:** core, logic, api (בכמה חלקים), hardening, rate_limits (0006).
  - **לא הופעלה:** `20261021000004_grants.sql` (revoke ו-grant). היא דורשת אישור של המשתמש בחלון האישור.
- **Edge Function `api`:** גרסה 3, מקומיט `85b589a`.
  - `GET /functions/v1/api/health` מחזיר `{"ok":true,"db":{"mode":"supabase","ready":true,"bootstrapped":false,"bootstrapToken":true}}`.
  - כלומר `BOOTSTRAP_TOKEN` הוגדר (בידי המשתמש, הניסיון שלי בוטל), **וההקמה הראשונה עוד לא בוצעה**.
- **נבדק חי:** בקשות בלי התחברות נחסמות (`server_only` / `revoked`), הקמה דורשת קוד, סיסמה שגויה מחזירה שגיאה, כותרות האבטחה מופיעות, ו-`sys_hit` עובד.
- **לא נבדק אף פעם מול המערכת החיה:** התחברות מוצלחת, סנכרון בין מכשירים, קבצים, פורטל, ניהול סיסמאות. כל אלה דורשים הקמה ראשונה.
- חבילת Windows (`GenairOps-Windows.zip`) נשלחה למשתמש. קובץ ה-HTML נבדק בדפדפן ומגיע למסך ההקמה. `Install.cmd` לא הורץ, כי אין Windows בסביבה.

## בדיקות (כולן עוברות בקומיט `85b589a`)
- **מסד הנתונים:** `cd genair/supabase/tests && npm test`. 24 בדיקות מול Postgres 16 מקומי.
- **Edge:** `cd genair/supabase/functions && npm test`. 27 בדיקות, הבנייה ואז מול fake-supabase שמריץ את המיגרציות האמיתיות. בדיקת Deno מדולגת כי Deno לא מותקן.
- **השרת הישן:** `cd genair/server && npm test`. 170 בדיקות. פעם או פעמיים בדיקה אחת נכשלה לסירוגין ולא שוחזרה ב-15 הרצות, כנראה בעיית תזמון בבדיקה.
- **האפליקציה:** `cd genair/app && npm run build && npm run build:single`.
- **Postgres מקומי** (נעלם כשהקונטיינר מתאתחל):
  `su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/tmp/genair-pg/data -o '-p 54329 -k /tmp' -l /var/tmp/genair-pg/log start"`.
  אם התיקייה לא קיימת, צריך `initdb` מחדש. ה-stubs של Supabase נמצאים ב-`supabase/tests/stubs.sql`.

## מה תוקן לאורך הסשן
1. **26 ממצאי אבטחה** מסשן ב' (25 בקוד, הממצא על הריפו הציבורי תלוי בהעברה):
   - הקמה עם `BOOTSTRAP_TOKEN`; אינטגרציות רק למחוברים.
   - סינון קריאה לפי תפקיד; לידים עם טלפון קיים לא נקשרים ללקוח, ונכנסים כ-pendingReview.
   - מתקין לא יוצר מסמכים סופיים ב-Priority; מקדמה נרשמת כממתינה ולא כשולמה.
   - מכסות לשימוש; לא סומכים על IP מכותרת; נעילה לפי חשבון ו-IP.
   - תוקף התחברות של 30 יום; בדיקת magic bytes לקבצים; CSP; `safeHref` ועוד.
2. **3 באגים:**
   - רגרסיה בשלב התיק אחרי אישור הצעה.
   - תאריכים מקומיים.
   - קישור ל-Priority שהלך לאיבוד.
3. **הקשחה מהסקירה השנייה:**
   - יומן אבטחה (`app.audit`).
   - יומן פעילות שאי אפשר לערוך, ורק admin מוחק ממנו. השרת חותם `data.by`.
   - מתקין לא משנה `sync`, לא רואה `pricePerYear`, ואין לו גישה לנתיבי AI ו-Priority.
   - וואטסאפ רק למספרים מוכרים; כותרות אבטחה.
4. **מגבלות קצב במסד** (`app.rate`, `sys_hit`), משותפות לכל המופעים של הפונקציה. השמות: route.ai/whatsapp/google/priority, auth.*, db.ops/reserve, files.upload, portal.*, bootstrap.ip.

## מה פתוח, לפי סדר
1. **ריפו פרטי (משימה #2):**
   - המשתמש יוצר ריפו פרטי וריק `genair-ops` ונותן גישה לאפליקציה של Claude.
   - אז: `add_repo`, ודחיפה של `genair-only` (או subtree מעודכן מ-`ccr-3511cac1-46qscf`, כי `genair-only` הוכן לפני הקומיטים האחרונים, **לרענן אותו**).
   - אחר כך למחוק את הענפים של genair מהריפו הציבורי. המשתמש אישר את זה כחלק מהאפשרות שבחר, אבל עדיף לאשר שוב לפני המחיקה.
   - לפתור את שיטת ההתקנה של ה-Edge Function, שתלויה היום ב-raw URL ציבורי.
2. **Vercel (משימה #6):**
   - המשתמש יוצר פרויקט מהריפו הפרטי, Root Directory `app`, Framework Vite. Claude קיבל 403 על יצירת פרויקט.
   - אחר כך להגדיר את הסוד `ALLOWED_ORIGINS` ב-Supabase לכתובת שהתקבלה.
3. **בלוח הבקרה של Supabase (המשתמש):**
   - לכבות "Allow new users to sign up".
   - לאשר את מיגרציית ה-grants (0004).
4. **הקמה ראשונה** (מהדסקטופ או מהמובייל), ואז **בדיקה מלאה מקצה לקצה:** כניסה, סנכרון חי בין שני מכשירים, תפקידים, קבצים, פורטל, סיסמאות.
5. **Priority:**
   - תזמון cron עם pg_cron ו-pg_net שקורא ל-`/api/priority/cron` עם `PRIORITY_CRON_SECRET`. ה-lease כבר קיים ב-psync.
   - מחכה להגדרת Priority ולסודות, מתועד ב-`functions/README.md`.
6. **סודות לאינטגרציות** כשהמשתמש ירצה: מפתח Anthropic, וואטסאפ, גוגל, Priority. ראו `functions/README.md` ו-`CONTRACT.md`.
7. **שאריות:** שורת `probe|x` בטבלה `app.rate` בפרויקט החי נשארה מבדיקה. היא לא מזיקה ופגה תוך דקה.
