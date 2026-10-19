# Genair Ops - שרת אינטגרציות

שכבה דקה בין האפליקציה (genair/app, רצה בדפדפן) לבין המערכות החיצוניות. כל הסיסמאות והמפתחות נשמרים רק כאן, והדפדפן לא רואה אותם.

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
| `POST /api/google/calendar/events` | `{ summary, description?, location?, start, end, allDay?, calendarId? }` ← `{ id, htmlLink }` |
| `POST /api/google/drive/folders` | `{ name, parentId? }` ← `{ id, webViewLink }` |

שגיאות תמיד בפורמט `{ "error": { "code": "...", "message": "<הודעה בעברית>", "details"?: ... } }`.
קודים שימושיים: `validation_error` (400, ב-`details.fields` רשימת השדות), `unauthorized` (401), `priority_write_disabled` (403),
`*_not_configured` (503), `priority_rejected` / `google_error` / `whatsapp_error` (502, ההודעה המקורית ב-`details.message`).

הערות:
- **כתיבה לפריוריטי** חסומה עד שמגדירים `PRIORITY_ALLOW_WRITE=true`. אפשר לבדוק payload בלי לשלוח כלום: `POST /api/priority/quotes?dryRun=1` מחזיר את מה שהיה נשלח לפריוריטי.
- אורכי שדות: `details` עד 24 תווים, `reference` עד 25, שם לקוח עד 48. ערך ארוך יותר נדחה. המיפוי המלא ב-[PRIORITY_MAPPING.md](PRIORITY_MAPPING.md).
- **Inbox**: את `cursor` מהתשובה שולחים כ-`since` בבקשה הבאה. ההודעות נשמרות בזיכרון של התהליך (500 אחרונות): כל מופע שרת מחזיק עותק משלו, והכול נמחק בהפעלה מחדש. זה מספיק לדמו; בייצור צריך מסד נתונים.
- מגבלת קצב לפריוריטי: עד 90 קריאות לדקה לכל מופע שרת, וניסיון חוזר על 429/503 (עד 3 ניסיונות, לפי `Retry-After`). Timeout של 20 שניות.
- גוף בקשה עד 25MB (413 מעל זה). **ב-Vercel המגבלה של הפלטפורמה היא 4.5MB**, ולכן כדאי להקטין תמונות בדפדפן לפני שליחה ל-AI.

## אבטחה

- `ALLOWED_ORIGINS` - רק הדומיין של האפליקציה. בקשה מדפדפן מ-Origin אחר נחסמת (403).
- `APP_TOKEN` - סוד משותף שהאפליקציה שולחת בכותרת `x-app-token`. זו לא הזדהות משתמשים (הטוקן נמצא בקוד של האפליקציה), רק מחסום נגד שימוש מזדמן בשרת. אם רוצים יותר, צריך להוסיף התחברות משתמשים.
- ה-AI מוגבל לרשימת מודלים (`AI_ALLOWED_MODELS`) ולרשימת ערכי `anthropic-beta`.
- `WHATSAPP_APP_SECRET` - בלעדיו כל אחד יכול לשלוח ל-Webhook הודעות מזויפות. בייצור חובה.
- השרת לא רושם בלוג גופי בקשות, query strings או מפתחות.

## פריסה ל-Vercel

1. ב-Vercel: New Project ← לבחור את ה-repo ← **Root Directory: `genair/server`**, Framework Preset: Other. אין Build Command.
2. Environment Variables: כל מה שצריך מ-`.env.example`, ובנוסף:
   - `ALLOWED_ORIGINS=https://<הדומיין של האפליקציה>`
   - `APP_TOKEN=<מחרוזת אקראית ארוכה>` (ואותה מחרוזת בהגדרות האפליקציה)
   - `NODEJS_HELPERS=0` (כדי לקבל את גוף הבקשה המקורי; נדרש לאימות החתימה של וואטסאפ)
3. Deploy. הכתובת תהיה `https://<project>.vercel.app/api/health`.

`vercel.json` מפנה את `/api/(.*)` ל-`api/index.js`, שמשתמש באותו handler של השרת המקומי. `maxDuration` מוגדר ל-300 שניות בשביל קריאות AI ארוכות. אם הפרויקט לא על Fluid Compute והחבילה היא Hobby, להוריד ל-60.

## מה צריך לכל אינטגרציה ומי מספק

### פריוריטי
- **רישיון API** ו**משתמש API** ייעודי - מבקשים ממנהל המערכת של Genair או משותף פריוריטי (Priority partner). למשתמש צריך הרשאות למסכים `CUSTOMERS`, `LOGPART`, `PRICELIST`, `CPROF`, `ORDERS`.
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
- לשתף **תיקייה ב-Drive** עם חשבון השירות כעורך (או להוסיף אותו ל-Shared Drive כ-Content manager) ← `GOOGLE_DRIVE_PARENT_ID`. לחשבון שירות אין נפח אחסון משלו, ולכן תיקיית אב היא חובה.
- את כל זה עושה מי שמנהל את חשבון Google של Genair. אם Drive מחזיר `appNotAuthorizedToFile`, להגדיר `GOOGLE_DRIVE_SCOPE=https://www.googleapis.com/auth/drive`.

### AI (Anthropic)
- **מפתח API** מ-console.anthropic.com, בארגון עם אמצעי תשלום ← `ANTHROPIC_API_KEY`. את זה פותח Genair או המפתח שמחזיק את החשבון. מומלץ להגדיר תקרת הוצאה ב-Console.

## בדיקות

```bash
npm test            # בדיקות יחידה, בלי רשת
npm run test:live   # קריאה בלבד מול דמו פריוריטי (דורש אינטרנט)
```

הבדיקות לא שולחות אף פעם POST לדמו של פריוריטי: הוא משותף לכל העולם. בדיקות הכתיבה רצות מול fetch מדומה.
