# הקמת המערכת לשימוש

המערכת רצה על Supabase (מסד הנתונים, ההתחברות, הקבצים והשרת), והאפליקציה מתארחת ב-Vercel. כל עובד נכנס מהדפדפן או מאפליקציה שמותקנת בטלפון ובמחשב, ורואה רק מה שהתפקיד שלו מאפשר.

- פרויקט Supabase: `genair-ops` (פרנקפורט), `https://alpcxjloqpglpjfvaset.supabase.co`
- הפונקציה (השרת): `https://alpcxjloqpglpjfvaset.supabase.co/functions/v1/api/health`

## מה כבר מוכן

- מסד הנתונים: טבלאות, הרשאות לפי תפקיד, סינון קריאה לפי תפקיד, עדכונים בזמן אמת, אחסון קבצים.
- השרת (Edge Function `api`): Priority, AI, וואטסאפ, גוגל, קבצים, אזור אישי ללקוח, טופס פנייה, ניהול סיסמאות, הקמה ראשונה, סנכרון Priority.
- האפליקציה: כניסה עם טלפון, סנכרון חי, מסך הקמה ראשונה, התקנה כאפליקציה.

## מה נשאר, לפי הסדר

### 1. ריפו פרטי לקוד (פעם אחת)
1. ב-GitHub: New repository ← השם `genair-ops` ← **Private** ← בלי README.
2. ב-https://github.com/apps/claude/installations/select_target לוודא שלאפליקציה של Claude יש גישה לריפו החדש.
3. לכתוב ל-Claude "הריפו מוכן". הקוד עובר אליו עם ההיסטוריה, והענף מהריפו הציבורי נמחק.

### 2. אחסון האפליקציה ב-Vercel (פעם אחת, אחרי שלב 1)
1. ב-vercel.com: Add New ← Project ← לבחור את `genair-ops` מ-GitHub (אם לא מופיע: Adjust GitHub App Permissions ולתת גישה לריפו).
2. Root Directory: `app`. Framework: Vite. שאר ההגדרות כמו שהן ← Deploy.
3. לשלוח ל-Claude את הכתובת שהתקבלה (למשל `https://genair-ops.vercel.app`). מכאן כל עדכון בריפו מתפרסם לבד.

### 3. הגדרות בלוח הבקרה של Supabase
ב-supabase.com ← הפרויקט `genair-ops`:
1. **Edge Functions ← Secrets** (או Project Settings ← Edge Functions):
   - `BOOTSTRAP_TOKEN`: קוד הקמה שבוחרים (מחרוזת אקראית ארוכה). משמש פעם אחת בלבד, בהקמה הראשונה.
   - `ALLOWED_ORIGINS`: כתובת האפליקציה מ-Vercel (למשל `https://genair-ops.vercel.app`). בלי זה הדפדפן לא יכול לפנות לשרת מהכתובת הזו.
2. **Authentication ← Sign In / Providers**: לכבות את "Allow new users to sign up". עובדים מקבלים חשבון רק מהמנהל. (גם בלי זה, מי שנרשם לבד לא רואה כלום, אבל עדיף לחסום.)
3. אם תופיע בקשת אישור לשינוי הרשאות במסד (migration בשם grants): לאשר. זו שכבת הגנה נוספת; ההגנה העיקרית כבר פעילה.

### 4. הקמה ראשונה
1. לפתוח את כתובת האפליקציה. כשהמסד ריק מופיע מסך "הקמה ראשונה".
2. לבחור מקור נתונים: מערכת חדשה (מתחילים ריק עם מנהל אחד), קובץ גיבוי, או הנתונים מהדפדפן.
3. שם המנהל, הטלפון שלו (איתו נכנסים), סיסמה, וקוד ההקמה משלב 3.
4. אחרי ההקמה: בעמוד **משתמשים** מוסיפים עובדים, ולכל אחד "קביעת סיסמה" (או סיסמה זמנית שהוא מחליף בכניסה הראשונה). כל עובד נכנס עם הטלפון הנייד שלו.

### 5. התקנה אצל העובדים
- **טלפון**: לפתוח את הכתובת בכרום (אנדרואיד) או ספארי (אייפון) ← "הוספה למסך הבית". נפתחת כאפליקציה עם אייקון.
- **מחשב Windows**: לפתוח בכרום או Edge ← סמל ההתקנה בשורת הכתובת. או את חבילת ההתקנה ב-`desktop/windows`.

### 6. חיבורים (כשמוכנים)
בסודות של הפונקציה (שלב 3.1), באותם שמות כמו ב-`server/.env.example`:
- **Priority**: `PRIORITY_MODE=live`, `PRIORITY_URL`, `PRIORITY_PAT` (או `PRIORITY_USER` + `PRIORITY_PASSWORD`). לסנכרון אוטומטי גם `PRIORITY_SYNC=on`, `PRIORITY_CRON_SECRET`, ותזמון כל דקה (ההוראות ב-`supabase/functions/README.md`). כתיבה לפריוריטי רק אחרי שבוע בקריאה בלבד: `PRIORITY_ALLOW_WRITE=true`.
- **AI**: `ANTHROPIC_API_KEY`.
- **וואטסאפ**: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`. כתובת ה-Webhook ב-Meta: `https://alpcxjloqpglpjfvaset.supabase.co/functions/v1/api/whatsapp/webhook`.
- **Google**: `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_CALENDAR_ID`, `GOOGLE_DRIVE_PARENT_ID`.

## חשוב לדעת על התוכנית החינמית של Supabase
- פרויקט שלא נעשה בו שימוש שבוע נעצר (נתונים לא נמחקים; מפעילים מחדש בלחיצה). בשימוש יומי זה לא קורה.
- אין גיבוי אוטומטי. מומלץ לייצא גיבוי מהאפליקציה (הגדרות ← נתונים) פעם בשבוע, או לעבור ל-Pro (25$ לחודש) שכולל גיבוי יומי.
- 500MB למסד ו-1GB לקבצים.
