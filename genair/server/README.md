# Genair Ops - שרת אינטגרציות ומסד נתונים משותף

שכבה דקה בין האפליקציה (genair/app, רצה בדפדפן) לבין המערכות החיצוניות, ומסד הנתונים המשותף של הצוות. כל הסיסמאות והמפתחות נשמרים רק כאן, והדפדפן לא רואה אותם.

- **מסד נתונים משותף** - כל המשתמשים עובדים על אותם נתונים: התחברות עם טלפון או אימייל וסיסמה, הרשאות לפי תפקיד שנאכפות בשרת, שינויים בזמן אמת (SSE, ואם אין — long-poll), התראות בין משתמשים, קבצים, אזור אישי ללקוח וטופס פנייה ציבורי. פירוט בהמשך.

- **פריוריטי (ERP)** - קריאת לקוחות, פריטים ומחירונים; יצירת לקוח, הצעת מחיר והזמנה (חסום כברירת מחדל).
- **AI (Anthropic)** - מעביר את בקשת ה-Messages של האפליקציה ומוסיף את מפתח ה-API.
- **וואטסאפ (Meta Cloud API)** - שליחת הודעות ותבניות, קבלת הודעות נכנסות וסטטוסים דרך Webhook.
- **Google** - יצירת אירוע ביומן ותיקייה ב-Drive עם חשבון שירות.

Node 22.9 ומעלה, ללא תלויות (אין צורך ב-`npm install`).

## הרצה מקומית

```bash
cd genair/server
cp .env.example .env      # ולמלא את מה שצריך; בלי כלום זה עובד מול דמו פריוריטי
npm start                 # http://localhost:8787
npm run dev               # אותו דבר עם טעינה מחדש בשינוי קבצים
```

המסד המשותף פועל כברירת מחדל ונשמר ב-`./data` (לא נכנס לגיט). עד שמקימים אותו מהאפליקציה הוא ריק, והשרת מתנהג כשרת אינטגרציות רגיל. `DB_MODE=off` מכבה אותו.

בדיקה מהירה:

```bash
curl localhost:8787/api/health
curl localhost:8787/api/priority/test
curl 'localhost:8787/api/priority/customers?top=3&search=כהן'
```

מאחורי פרוקסי ארגוני (`HTTPS_PROXY`): השרת מפעיל את עצמו מחדש עם `NODE_USE_ENV_PROXY=1` כדי ש-`fetch` של Node יעבור דרך הפרוקסי (Node 22.21+). בלי פרוקסי אין לזה השפעה.

## נקודות קצה

| שיטה ונתיב | מה עושה |
|---|---|
| `GET /api/health` | גרסה ואילו אינטגרציות מוגדרות (`features`) |
| `GET /api/priority/test` | קריאה קטנה לפריוריטי: `{ ok, latencyMs, mode, serviceRoot, sample }` |
| `GET /api/priority/customers?search=&top=50&skip=0` | לקוחות. החיפוש לפי שם, טלפון או מספר לקוח |
| `GET /api/priority/items?search=&top=50&skip=0` | פריטים ומחיר בסיס |
| `GET /api/priority/pricelists` | מחירונים |
| `POST /api/priority/customers` | `{ name, phone, email?, address?, city?, vatNum? }` ← `{ custname }` |
| `POST /api/priority/quotes` | `{ custname, details?, lines:[{ partname, qty, price, description? }] }` ← `{ cprofnum }` |
| `POST /api/priority/orders` | `{ custname, details?, reference?, lines:[...] }` ← `{ ordname }` |
| `POST /api/ai/messages` | גוף בקשת Messages API כמו שהוא; מחזיר את תשובת Anthropic כמו שהיא (כולל stream) |
| `POST /api/whatsapp/send` | `{ to, text }` או `{ to, template:{ name, language:"he", params:[] } }` ← `{ id }` |
| `GET/POST /api/whatsapp/webhook` | אימות ו-Webhook של Meta (לא דורש `x-app-token`) |
| `GET /api/whatsapp/inbox?since=<iso>` | `{ items:[{ id, from, text, at, type, status?, name? }], cursor }` |
| `POST /api/google/calendar/events` | `{ summary, description?, location?, start, end, allDay?, calendarId? }` ← `{ id, htmlLink }`. `calendarId` = היומן האישי של העובד |
| `PATCH /api/google/calendar/events/:id` | אותו גוף; מעדכן זמן, כותרת ופרטים ← `{ id, htmlLink }` |
| `DELETE /api/google/calendar/events/:id?calendarId=` | ← `{ ok, gone }` (אירוע שכבר נמחק נחשב הצלחה) |
| `POST /api/google/drive/folders` | `{ name, parentId?, subfolders?: [{ key, name }] }` ← `{ id, webViewLink, subfolders?: { key: id } }` |
| `POST /api/google/drive/files?folderId=` | גוף גולמי (הקובץ), שם ב-`x-file-name` (URI-encoded) ← `{ id, webViewLink }` |
| `POST /api/google/drive/files/:id/move` | `{ from?, to }` ← `{ id, webViewLink }` |
| `POST /api/google/drive/files/:id/trash` | לפח של Drive ← `{ ok, gone }` |

שגיאות תמיד בפורמט `{ "error": { "code": "...", "message": "<הודעה בעברית>", "details"?: ... } }`.
קודים שימושיים: `validation_error` (400, ב-`details.fields` רשימת השדות), `unauthorized` (401), `priority_write_disabled` (403),
`*_not_configured` (503), `priority_rejected` / `google_error` / `whatsapp_error` (502, ההודעה המקורית ב-`details.message`).

הערות:
- **כתיבה לפריוריטי** חסומה עד שמגדירים `PRIORITY_ALLOW_WRITE=true`. אפשר לבדוק payload בלי לשלוח כלום: `POST /api/priority/quotes?dryRun=1` מחזיר את מה שהיה נשלח לפריוריטי.
- אורכי שדות: `details` עד 24 תווים, `reference` עד 25, שם לקוח עד 48. ערך ארוך יותר נדחה. המיפוי המלא ב-[PRIORITY_MAPPING.md](PRIORITY_MAPPING.md).
- **Inbox**: את `cursor` מהתשובה שולחים כ-`since` בבקשה הבאה. ההודעות נשמרות בזיכרון של התהליך (500 אחרונות): כל מופע שרת מחזיק עותק משלו, והכול נמחק בהפעלה מחדש. זה מספיק לדמו; בייצור צריך מסד נתונים.
- מגבלת קצב לפריוריטי: עד 90 קריאות לדקה לכל מופע שרת, וניסיון חוזר על 429/503 (עד 3 ניסיונות, לפי `Retry-After`). Timeout של 20 שניות.
- גוף בקשה עד 25MB (413 מעל זה). **ב-Vercel המגבלה של הפלטפורמה היא 4.5MB**, ולכן כדאי להקטין תמונות בדפדפן לפני שליחה ל-AI.

## מסד נתונים משותף והתחברות

כל ישות (לקוח, תיק, הצעה, מועד...) נשמרת לפי אוסף ומזהה, עם רצף שינויים עולה (`seq`), מחיקה רכה ומיזוג לפי שדה: כל שדה זוכר מתי נכתב, והכתיבה המאוחרת (לפי `at` של הפעולה) מנצחת. כך שני משתמשים שמשנים שדות שונים באותו תיק לא דורסים זה את זה. ההגדרות (`config`) וההגדרות הארגוניות (`settings`) הן מסמכים בודדים עם המזהה `org`.

האחסון: קובץ `db.json` בתיקיית `DATA_DIR`, נטען לזיכרון ונכתב כקובץ זמני + `rename` (לא נשאר קובץ חצי כתוב), כמה מאות מילישניות אחרי השינוי. פעם ביום נשמר עותק ב-`DATA_DIR/backups` (14 אחרונים), והקבצים שהועלו ב-`DATA_DIR/files`. האחסון עובר דרך ממשק קטן (`load` / `save`, ב-`src/db/adapters.js`), כך שאפשר להחליף אותו ב-Postgres בלי לגעת בשאר.

### הקמה

1. להריץ את השרת על אחסון קבוע (ראו "פריסה") עם `AUTH_SECRET` ו-`BOOTSTRAP_TOKEN`.
2. באפליקציה: הגדרות ← חיבורים ← "מסד נתונים משותף" ← כתובת השרת ← בדיקה.
3. השרת ריק, ולכן מופיעה "הקמה ראשונה": בוחרים את מנהל המערכת, סיסמה (וקוד ההקמה). הנתונים שבדפדפן (לקוחות, תיקים, משתמשים, הגדרות, קבצים) עולים לשרת. אפשר להקים פעם אחת בלבד. קישורי אזור אישי קצרים מנתוני ההדגמה מוחלפים בקישורים אקראיים.
4. בעמוד המשתמשים המנהל קובע לכל עובד סיסמה (או סיסמה זמנית, שהעובד מחליף בכניסה הראשונה).
5. בכל מכשיר אחר: אותו מסך ← "מעבר למסד המשותף" ← כניסה. בבנייה עם `VITE_SERVER_URL` האפליקציה נפתחת ישר במסך הכניסה.

### נקודות קצה

כולן דורשות `Authorization: Bearer <token>` חוץ מהכניסה, ההקמה, האזור האישי וטופס הפנייה.

| שיטה ונתיב | מה עושה |
|---|---|
| `POST /api/auth/login` | `{ login: טלפון או אימייל, password }` ← `{ token, expiresAt, user, mustChange }`. עד 8 ניסיונות שגויים ל-15 דקות לכל משתמש, 30 לכל כתובת IP |
| `POST /api/auth/logout` | סוגר את החיבור הזה (הטוקן נפסל) |
| `GET /api/auth/me` | המשתמש המחובר |
| `POST /api/auth/password` | `{ current, next }` - החלפת סיסמה; שאר המכשירים מתנתקים, ומוחזר טוקן חדש |
| `GET /api/auth/users` | ניהול ומשרד: למי יש סיסמה ומתי נכנס לאחרונה (בלי hash) |
| `POST /api/auth/users/:id/password` | מנהל מערכת בלבד: `{ password? }`. בלי סיסמה מוחזרת `temporaryPassword` חד-פעמית |
| `POST /api/auth/bootstrap` | רק כשהמסד ריק: `{ snapshot: { collections, config, settings, counters }, adminUserId, password, bootstrapToken? }` |
| `GET /api/db/snapshot` | כל האוספים, `config`, `settings`, מונים ו-`seq` נוכחי |
| `GET /api/db/changes?since=<seq>&wait=25` | שינויים אחרי `seq` (ישן ← חדש). בלי שינויים מחכה עד `wait` שניות. `reset: true` = לטעון snapshot |
| `GET /api/db/events?since=<seq>` | SSE: `hello`, `changes` (id = seq), `reset`, `signout`; פעימה כל 20 שניות |
| `POST /api/db/ops` | `{ ops: [{ op: upsert\|patch\|remove, collection, id, data?, unset?, at, ifUnset? }], clientId }` ← `{ seq, results: [{ status, seq }] }`. סטטוס: `ok`, `partial` (חלק מהשדות כבר נכתבו מאוחר יותר), `stale`, `missing`, `conflict` (ל-`ifUnset`), `denied` |
| `POST /api/db/fetch` | `{ items: [{ c, id }] }` - המצב הנוכחי בשרת (אחרי `denied`/`stale`) |
| `POST /api/db/counters/reserve` | `{ key, count }` ← `{ from, to }` - בלוק מספרים שמור למכשיר (מספרי תיקים, הצעות, קריאות) |
| `POST /api/files` | גוף גולמי; `content-type`, `x-file-name`, ואופציונלי `x-case-id`, `x-folder`, `x-drive-folder-id` (גם העתק ל-Drive) ← `{ fileId, name, mime, size, driveFileId?, webViewLink? }` |
| `GET /api/files/:id[?download=1]` | הקובץ, למשתמש מחובר בלבד. HTML ו-SVG תמיד כהורדה, עם CSP sandbox |

**הרשאות (נאכפות בשרת לכל פעולה):** כל משתמש מחובר קורא הכול. ניהול ומשרד כותבים הכול. סוכן ומהנדס - הכול חוץ ממשתמשים, `config` ו-`settings`. מתקין - מועדים, קריאות שירות, מלאי, מסמכים, הודעות, צ'אט, משימות, התראות, חופשות, יחידות ויומן פעילות, ובתיק רק את השדות שסיום עבודה מעדכן (`stage`, `updatedAt`, `closedAt`, `flow`, `installerIds`), וחוזה רק כ"מוצע". התראה אפשר ליצור לכל אחד, אבל רק הנמען מסמן או מוחק אותה. בקשת חופשה - רק של עצמי, ואת האישור נותנים ניהול ומשרד. רק מנהל מערכת יוצר או משנה מנהל מערכת, ואי אפשר להשבית את המנהל הפעיל האחרון. משתמש שהושבת מתנתק מיד.

**סיסמאות:** scrypt (`node:crypto`), נשמרות בחלק נפרד של `db.json` ולא באוסף `users`, ולא נשלחות לאף לקוח. שדות כמו `password` שנשלחים בטעות עם משתמש נמחקים. הטוקן הוא JWT (HS256) עם מזהה חיבור; תוקף 12 שעות שמתחדש בכל שימוש (כותרת `x-auth-token`).

### אזור אישי ללקוח וטופס פנייה (בלי התחברות)

| שיטה ונתיב | מה עושה |
|---|---|
| `GET /api/portal/:token` | רק התיק של הקישור: פרטי התיק, שם פרטי, הכתובת, ההצעה האחרונה שנשלחה (בלי עלויות והערות AI), מועדים עם השם הפרטי של הצוות, מסמכים גלויים ללקוח, יחידות, הודעות הצ'אט |
| `POST /api/portal/:token/view` | כניסה: "נצפה לאחרונה", הצעה שנשלחה ← "נצפתה", התראה לסוכן |
| `POST /api/portal/:token/approve` | `{ quoteId, signature: { name, dataUrl }, deposit: { method } }` - השרת מחשב את המקדמה, מעדכן הצעה ותיק, דוחה הצעות פתוחות אחרות, רושם תשלום ושולח התראות. ההצעה מסומנת `approvedVia: 'portal'`, ומכשיר של המשרד משלים פעם אחת עמלה, פלואו ו-Priority |
| `POST /api/portal/:token/reject` | `{ quoteId, reason? }` |
| `POST /api/portal/:token/service` | `{ unitId?, symptom?, errorCode?, text }` ← `{ number }` (מספר מהמונה המשותף) |
| `POST /api/portal/:token/upload` | תמונה או PDF עד 10MB, נכנס לתיקיית "לקוח" של התיק |
| `POST /api/portal/:token/messages` | `{ body }` - הודעה מהלקוח (`Message` עם `channel: 'portal'`, `direction: 'in'`). תשובות הצוות: `direction: 'out'` |
| `GET /api/portal/:token/files/:docId` | קובץ שגלוי ללקוח, רק מהתיק של הקישור |
| `POST /api/public/leads` | `{ name, phone, city?, type, text?, photos?, source?, website }` (`website` = מלכודת לבוטים) ← לקוח, איש קשר ותיק; `{ number, portalToken }`. עד 5 פניות ל-10 דקות לכל IP |

## סנכרון אוטומטי עם פריוריטי (בשני הכיוונים)

מנוע שרץ בתוך השרת, על המסד המשותף (`src/psync/`). מפעילים עם `PRIORITY_SYNC=on`.

**מהמערכת לפריוריטי, תוך שניות:** כל שמירה במערכת מפעילה את המנוע. הוא מחכה שנייה וחצי שהשינויים יתייצבו ושולח: לקוחות (פתיחה ועדכון), אנשי קשר, ספקים, הצעות מחיר שנשלחו (`CPROF`, עריכה מחליפה שורות), הזמנה כשהצעה מאושרת (`ORDERS`, פעם אחת), הזמנות רכש (`PORDERS`) וקריאות שירות (`DOCUMENTS_Q`). סבב כל דקה מנסה שוב את מה שנכשל (המתנה הולכת וגדלה, עד 6 שעות) ותופס מה שהוחמץ בהפעלה מחדש.

**מפריוריטי למערכת:** לפריוריטי אין ערוץ שינויים ב-API, ולכן המנוע מושך לפי תאריכים:
- כל דקה (`PRIORITY_SYNC_HOT_SEC`): סטטוס הזמנות, חשבוניות סופיות וקבלות. הן נכנסות ללשונית הכספים בתיק כשורות קריאה בלבד. תשלום שכבר הוקלד במערכת (למשל מקדמה מהאזור האישי) מקושר לקבלה ולא נספר פעמיים.
- כל 10 דקות (`PRIORITY_SYNC_WARM_SEC`): שינויים בלקוחות, לקוחות חדשים שנפתחו בפריוריטי, מחירים ועלויות לפי מק״ט, יתרות לקוחות (אובליגו), ומלאי לפי מחסן.
- מיידי: חוק עסקי בפריוריטי ששולח `POST /api/priority/webhook?key=<PRIORITY_WEBHOOK_SECRET>` (אפשר עם `{"form":"ORDERS"}`). הגוף לא נחשב אמין: הוא רק אומר "תבדוק עכשיו", והנתונים נקראים מפריוריטי.

**בלי פינג-פונג ובלי כפילויות:** הכתיבות של המנוע מסומנות ולא מפעילות אותו שוב. לכל רשומה נשמר hash של מה שנשלח ושל מה שנראה בפריוריטי, כך שערך שהגיע מפריוריטי לא נשלח חזרה. לפני יצירה המנוע מחפש רשומה קיימת: לקוח לפי טלפון או ח״פ, הזמנה והצעה לפי מספר ההצעה (`REFERENCE`), הזמנת רכש לפי מספרה (`DETAILS`). נמצאה, מקשרים.

**מי מנצח:**
- לקוח קיים בפריוריטי שמקושר: הפרטים בפריוריטי נשמרים, ומשלימים רק שדות ריקים.
- לקוחות שקושרו לפני שהמנוע עלה: פריוריטי הוא נקודת המוצא, שום דבר לא נדרס.
- שני הצדדים שינו אותו לקוח מאז הסבב הקודם: העריכה במערכת נשמרת ונשלחת, ונרשמת בפעילות.
- הזמנה אחרי שנפתחה, חשבוניות, קבלות, יתרות, מחירים ומלאי: של פריוריטי. במערכת הם לקריאה בלבד (השרת דוחה שינוי שלהם).

**הגדרות:**

| משתנה | ברירת מחדל | |
|---|---|---|
| `PRIORITY_SYNC` | כבוי | `on` מפעיל את המנוע (צריך `DB_MODE=file` ו-`PRIORITY_MODE=live`) |
| `PRIORITY_ALLOW_WRITE` | כבוי | בלעדיו המנוע רק קורא, והרשומות מחכות כ"ממתין" עם הסיבה. מול הדמו הציבורי לא נכתב כלום בכל מקרה |
| `PRIORITY_SYNC_STREAMS` | הכול | `customers,contacts,quotes,orders,suppliers,purchasing,service,invoices,receipts,items,balances,stock` |
| `PRIORITY_SYNC_HOT_SEC` / `PRIORITY_SYNC_WARM_SEC` | 60 / 600 | תדירות המשיכה |
| `PRIORITY_WEBHOOK_SECRET` | - | המפתח של ה-webhook |
| `PRIORITY_GENERIC_PART` | `000` | מק״ט לשורות בלי פריט מהקטלוג |
| `PRIORITY_IMPORT_CUSTOMERS` | `new` | `new`: לקוחות שנפתחו בפריוריטי מאז שהמנוע עלה. `all`: כולם. `off`: בלי |
| `PRIORITY_IMPORT_ITEMS` | כבוי | גם פריטים שאין בקטלוג נכנסים |
| `PRIORITY_WAREHOUSES` | - | `Main=מחסן ראשי,V12=רכב — רון`: אילו מחסנים מעדכנים מלאי ובאיזה מיקום |
| `PRIORITY_CUSTOMER_PREFIX` | `GN` | לקוח חדש מקבל מספר מהמערכת (GN000001, GN000002...) ונפתח בפריוריטי כלקוח רגיל ופעיל. `off`: פריוריטי ממספרת, והלקוח נפתח כ"זמני" (T...). לקוח זמני אי אפשר להפוך לרגיל דרך ה-API, ולכן קריאת שירות בשבילו תיעצר עד שיומר בפריוריטי |
| `PRIORITY_AUTO_ACTIVATE` | פועל | לפני הזמנה או קריאת שירות, לקוח בסטטוס שלא מאפשר אותן עובר לסטטוס הפעיל. `off`: נעצר עם הסבר |

**סטטוסים:** המנוע קורא את טבלאות הסטטוסים של פריוריטי (`CUSTSTATS`, `CPROFSTATS`) ומזהה לפי הדגלים איזה סטטוס הוא "פעיל", "אושרה" ו"נדחתה", כי השמות שונים בכל התקנה. הצעה שהלקוח אישר מסומנת בפריוריטי כמאושרת, ורק אז נפתחת ממנה הזמנה (מקושרת ב-`CPROFNUM`). הצעה שנדחתה נסגרת שם. שורות של הצעה מתעדכנות רק כל עוד היא בטיוטה בפריוריטי. שורה עם פריט מהקטלוג נשלחת לפי מק״ט בלבד, כי פריוריטי לא מאפשרת לשנות תיאור של פריט שלא סומן כניתן לשינוי. שורה חופשית נשלחת עם הפריט הכללי והתיאור שלה.

מסך שנסגר ל-API בהתקנה מסוימת משהה רק את הזרם שלו לשש שעות, והסיבה מופיעה במסך "סנכרון Priority". פריוריטי לא זמין עוצר את הסבב, והסבב הבא מנסה שוב.

נקודות קצה: `GET /api/priority/sync/status` ו-`POST /api/priority/sync/run` (`{"kind":"hot"|"warm"|"full"}`) להנהלה ולמשרד, `POST /api/priority/webhook` לפריוריטי.

**נבדק מול פריוריטי אמיתי** (סביבת הדמו הציבורית, 20.10.2026, עם נתוני בדיקה בלבד): פתיחת לקוח ועדכונו בשני הכיוונים, איש קשר ועריכתו, הצעה ועריכת שורותיה, אישור והזמנה מקושרת בלי כפילות, דחיית הצעה, ספק, הזמנת רכש, קריאת שירות, ומשיכת סטטוס הזמנה, חשבוניות, קבלות, יתרות ומלאי. הבדיקה גילתה את כללי התיאור, הסטטוסים והלקוח הזמני שתוארו למעלה, והם מטופלים.

**לפני הפעלה בחברה:** לעבור על המיפוי (`PRIORITY_MAPPING.md`) עם מנהל המערכת של פריוריטי. מק״טים, שדות חובה וסטטוסים משתנים בין התקנות. מומלץ להתחיל בקריאה בלבד, לבדוק שבוע, ואז להפעיל כתיבה על משתמש API ייעודי. המנוע רץ בתהליך אחד: לא מפעילים אותו בשני שרתים במקביל.

## אבטחה

- `ALLOWED_ORIGINS` - רק הדומיין של האפליקציה. בקשה מדפדפן מ-Origin אחר נחסמת (403).
- `APP_TOKEN` - סוד משותף שהאפליקציה שולחת בכותרת `x-app-token`, לנתיבי האינטגרציות. במסד המשותף משתמש מחובר נכנס גם בלעדיו, ואחרי ההקמה הנתיבים האלה כבר לא פתוחים בלי אחד מהשניים.
- `AUTH_SECRET` - חותם את טוקני ההתחברות. להגדיר בייצור (אחרת נוצר סוד ונשמר ב-`db.json`). החלפה שלו מנתקת את כולם.
- `BOOTSTRAP_TOKEN` - בלעדיו, מי שמגיע ראשון לשרת ריק יכול להקים אותו.
- `TRUST_PROXY=true` מאחורי פרוקסי, כדי שמגבלות הקצב יהיו לפי כתובת הלקוח ולא של הפרוקסי.
- ה-AI מוגבל לרשימת מודלים (`AI_ALLOWED_MODELS`) ולרשימת ערכי `anthropic-beta`.
- `WHATSAPP_APP_SECRET` - בלעדיו כל אחד יכול לשלוח ל-Webhook הודעות מזויפות. בייצור חובה.
- השרת לא רושם בלוג גופי בקשות, query strings או מפתחות.

## פריסה

**המסד המשותף צריך שרת שרץ כל הזמן עם דיסק קבוע** (החיבורים החיים והנתונים בזיכרון). כל אחד מאלה מתאים:

- **Docker** (בכל VPS): `docker build -t genair-server genair/server` ואז `docker run -d -p 8787:8787 -v genair-data:/data --env-file .env genair-server`. ה-`Dockerfile` מבוסס `node:22-alpine`, בלי `npm install`.
- **Render**: Web Service מה-repo, Root Directory `genair/server`, Runtime Docker (או Node עם `npm start`), Disk שמחובר ל-`/data` ו-`DATA_DIR=/data`, `TRUST_PROXY=true`.
- **Railway / Fly.io**: אותו Dockerfile, Volume שמחובר ל-`/data`, ומופע אחד בלבד (המסד בזיכרון של התהליך; לא להריץ כמה מופעים).
- **שרת משלכם**: `node src/server.js` מאחורי nginx (עם `proxy_buffering off` לנתיב `/api/db/events`) ו-systemd.

בכל המקרים: `ALLOWED_ORIGINS` לכתובת האפליקציה, `AUTH_SECRET`, `BOOTSTRAP_TOKEN`, ובאפליקציה לבנות עם `VITE_SERVER_URL=https://<השרת>` כדי שקישורי האזור האישי וטופס הפנייה יעבדו אצל לקוחות. כשהתהליך נעצר (SIGTERM) הוא כותב את הנתונים לפני היציאה. גיבוי: להעתיק את `DATA_DIR` (או את `backups/`).

**להמשך (Postgres):** מימוש של `load`/`save` ב-`src/db/adapters.js` שכותב רק את הישויות ששונו, ו-LISTEN/NOTIFY במקום אירוע בתוך התהליך, יאפשרו כמה מופעי שרת.

### Vercel (אינטגרציות בלבד)

ב-Vercel אין תהליך שרץ כל הזמן ואין דיסק קבוע, ולכן שם `DB_MODE` כבוי כברירת מחדל: השרת נותן Priority, AI, וואטסאפ ו-Google, והאפליקציה עובדת במצב הדגמה (נתונים בכל דפדפן). אפשר לשלב: שרת אינטגרציות ב-Vercel ושרת מסד נתונים נפרד, או הכול בשרת אחד עם דיסק.

### פריסה ל-Vercel

1. ב-Vercel: New Project ← לבחור את ה-repo ← **Root Directory: `genair/server`**, Framework Preset: Other. אין Build Command.
2. Environment Variables: כל מה שצריך מ-`.env.example`, ובנוסף:
   - `ALLOWED_ORIGINS=https://<הדומיין של האפליקציה>`
   - `APP_TOKEN=<מחרוזת אקראית ארוכה>` (ואותה מחרוזת בהגדרות האפליקציה)
   - `NODEJS_HELPERS=0` (כדי לקבל את גוף הבקשה המקורי; נדרש לאימות החתימה של וואטסאפ)
3. Deploy. הכתובת תהיה `https://<project>.vercel.app/api/health`.

`vercel.json` מפנה את `/api/(.*)` ל-`api/index.js`, שמשתמש באותו handler של השרת המקומי. `maxDuration` מוגדר ל-300 שניות בשביל קריאות AI ארוכות. אם הפרויקט לא על Fluid Compute והחבילה היא Hobby, להוריד ל-60.

## מה צריך לכל אינטגרציה ומי מספק

### פריוריטי
- **רישיון API** ו**משתמש API** ייעודי - מבקשים ממנהל המערכת של Genair או משותף פריוריטי (Priority partner). למשתמש צריך הרשאות למסכים `CUSTOMERS`, `LOGPART`, `PRICELIST`, `CPROF`, `ORDERS`, ולסנכרון האוטומטי גם `SUPPLIERS`, `PORDERS`, `DOCUMENTS_Q`, `AINVOICES`, `CINVOICES`, `EINVOICES`, `TINVOICES`, `OBLIGO`, `PARTBAL`.
- **כתובת השירות** (`PRIORITY_URL`) בפורמט `https://<שרת>/odata/Priority/<tabula.ini>/<קוד חברה>` - מהשותף.
- אפשרות להזדהות: משתמש+סיסמה (`PRIORITY_USER`/`PRIORITY_PASSWORD`) או Personal Access Token (`PRIORITY_PAT`) שהמשתמש מנפיק בפריוריטי.
- אם פריוריטי/השותף הנפיקו App ID ו-App Key לאפליקציה - `PRIORITY_APP_ID` / `PRIORITY_APP_KEY`.
- אם רוצים קריאות שירות או טכנאים, צריך לבקש מהשותף לפתוח גם את המסכים האלה ל-API (בדמו הם חסומים).
- להתחיל עם `PRIORITY_MODE=live` ו-`PRIORITY_ALLOW_WRITE=false`, לבדוק קריאה, ורק אחרי זה להפעיל כתיבה.

### וואטסאפ (Meta)
- **Meta Business Manager מאומת** (Business Verification) של Genair, ו-WhatsApp Business Account עם מספר טלפון רשום (מספר שלא פעיל באפליקציית וואטסאפ הרגילה) ושם תצוגה מאושר. את זה עושה בעל העסק או מי שמנהל את חשבון ה-Meta של Genair.
- אפליקציה ב-developers.facebook.com עם מוצר WhatsApp. משם: `WHATSAPP_PHONE_NUMBER_ID` ו-`WHATSAPP_APP_SECRET`.
- **טוקן קבוע**: System User ב-Business Settings עם הרשאות `whatsapp_business_messaging` ו-`whatsapp_business_management` ← `WHATSAPP_TOKEN`. (הטוקן הזמני מה-dashboard פג אחרי 24 שעות.)
- **Webhook**: Callback URL = `https://<הדומיין>/api/whatsapp/webhook`, Verify token = הערך של `WHATSAPP_VERIFY_TOKEN`, ולהירשם לשדה `messages`.
- **תבניות מאושרות** ב-WhatsApp Manager (שפה: Hebrew `he`) לכל הודעה שהעסק יוזם, למשל תזכורת לביקור טכנאי. טקסט חופשי אפשר לשלוח רק בתוך 24 שעות מההודעה האחרונה של הלקוח; מחוץ לחלון הזה השרת מחזיר `whatsapp_window_closed`.

### Google (יומן ו-Drive)
- פרויקט ב-Google Cloud (בחשבון של Genair) עם **Google Calendar API** ו-**Google Drive API** מופעלים.
- **חשבון שירות** + מפתח JSON ← `GOOGLE_SERVICE_ACCOUNT_JSON` (התוכן או base64 שלו).
- לשתף את **היומן** עם כתובת המייל של חשבון השירות בהרשאה "ביצוע שינויים באירועים" ← `GOOGLE_CALENDAR_ID`.
- **יומן אישי לכל עובד**: בעמוד המשתמשים ממלאים "יומן Google אישי" (בדרך כלל האימייל שלו), וכל עובד משתף את היומן שלו עם חשבון השירות באותה הרשאה. מי שאין לו יומן אישי מקבל את האירוע ביומן של החברה. שינוי מועד או צוות מעדכן את האירועים, וביטול מוחק אותם.
- **תיקיות התיק ב-Drive**: לכל תיק נפתחת תיקייה עם תיקיות המשנה מההגדרות (משרד, לקוח, מתקין, הנדסה, ספקים, ארכיון), וכל קובץ עולה לתיקייה שלו.
- לשתף **תיקייה ב-Drive** עם חשבון השירות כעורך (או להוסיף אותו ל-Shared Drive כ-Content manager) ← `GOOGLE_DRIVE_PARENT_ID`. לחשבון שירות אין נפח אחסון משלו, ולכן תיקיית אב היא חובה.
- את כל זה עושה מי שמנהל את חשבון Google של Genair. אם Drive מחזיר `appNotAuthorizedToFile`, להגדיר `GOOGLE_DRIVE_SCOPE=https://www.googleapis.com/auth/drive`.

### AI (Anthropic)
- **מפתח API** מ-console.anthropic.com, בארגון עם אמצעי תשלום ← `ANTHROPIC_API_KEY`. את זה פותח Genair או המפתח שמחזיק את החשבון. מומלץ להגדיר תקרת הוצאה ב-Console.

## בדיקות

```bash
npm test            # בדיקות יחידה, בלי רשת (כולל המסד, התחברות, הרשאות, סנכרון, SSE, מונים, קבצים, אזור אישי וטופס פנייה)
npm run test:live   # קריאה בלבד מול דמו פריוריטי (דורש אינטרנט)
```

הבדיקות לא שולחות אף פעם POST לדמו של פריוריטי: הוא משותף לכל העולם. בדיקות הכתיבה רצות מול fetch מדומה.
