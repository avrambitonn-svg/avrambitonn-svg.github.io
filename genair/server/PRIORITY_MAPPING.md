# מיפוי שדות פריוריטי ↔ Genair Ops

המיפוי נלקח מה-`$metadata` של סביבת הדמו הציבורית של פריוריטי
(`https://t.eu.priority-connect.online/odata/Priority/tabbtd38.ini/usdemo`, 19.10.2026),
ונבדק בקריאות GET בלבד. התיאורים בעמודת "משמעות" הם התיאורים שפריוריטי עצמה מחזירה ב-metadata.
"אורך" = MaxLength. השרת דוחה ערכים ארוכים יותר (400 `validation_error`) ולא חותך אותם בשקט.

## לקוחות - `CUSTOMERS` (מפתח: `CUSTNAME`)

| שדה בפריוריטי | משמעות | אורך | שדה באפליקציה | הערות |
|---|---|---|---|---|
| `CUSTNAME` | מס. לקוח | 16 | `custname` | ביצירה: אם לא נשלח, פריוריטי ממספרת אוטומטית (רק אם הוגדר מספור אוטומטי / תבנית `CUSTNAMEPATNAME`) |
| `CUSTDES` | שם לקוח | 48 | `name` | חובה ביצירה |
| `PHONE` | מספר טלפון | 20 | `phone` | חובה ביצירה (דרישה של האפליקציה) |
| `EMAIL` | דואר אלקטרוני | 68 | `email` | |
| `ADDRESS` | כתובת | 80 | `address` | |
| `STATEA` | עיר | 40 | `city` (קריאה) | בדמו האמריקאי זו העיר בלבד |
| `STATE` | עיר ומדינה | 40 | `city` (קריאה כגיבוי, כתיבה) | בדמו: "Naples, FL". בהתקנות בישראל זה שדה העיר הרגיל |
| `VATNUM` | מספר תיק במע"מ | 16 | `vatNum` | ח.פ. / עוסק מורשה |
| `WTAXNUM` | מס' חברה | 16 | - | לא ממופה |
| `CUSTPERSONNEL_SUBFORM` | אנשי קשר | - | - | תת-טופס, לא בשימוש כרגע |

חיפוש (`search`): `contains(CUSTDES|PHONE|CUSTNAME, '...')`.

## פריטים - `LOGPART` (מפתח: `PARTNAME`)

| שדה בפריוריטי | משמעות | אורך | שדה באפליקציה |
|---|---|---|---|
| `PARTNAME` | מק"ט | 22 | `partname` |
| `PARTDES` | תאור מוצר | 59 | `description` |
| `BASEPLPRICE` | מחיר במחירון בסיס | - | `price` (מספר, 0 אם ריק) |
| `BASEPLCODE` | מטבע המחירון | 3 | `currency` (למשל `$`, `שח`) |
| `PUNITNAME` | יח' קניה/מכירה | 3 | `unit` |
| `UNITNAME` | יח' מפעל | 3 | `unit` (גיבוי) |

חיפוש: `contains(PARTDES|PARTNAME, '...')`. מחיר לפי מחירון ספציפי של לקוח נמצא ב-`PRICELIST` → `PARTPRICE2_SUBFORM` (לא ממומש).

## מחירונים - `PRICELIST` (מפתח: `PLNAME`)

| שדה בפריוריטי | משמעות | אורך | שדה באפליקציה |
|---|---|---|---|
| `PLNAME` | קוד מחירון | 6 | `code` |
| `PLDES` | תאור מחירון | 16 | `name` |
| `CODE` | מטבע | 3 | `currency` |
| `NAME` | תאור מטבע (קריאה בלבד) | 20 | - |

## הצעות מחיר - `CPROF` (מפתח: `CPROFNUM`), שורות: `CPROFITEMS_SUBFORM`

| שדה בפריוריטי | משמעות | אורך | שדה באפליקציה |
|---|---|---|---|
| `CPROFNUM` | הצעת מחיר (מספר) | 16 | תשובה: `cprofnum` |
| `CUSTNAME` | מס. לקוח | 16 | `custname` (חובה) |
| `DETAILS` | פרטים | **24** | `details` |
| `PDATE` | ת. הצעת מחיר | - | פריוריטי ממלאת (היום) |
| `STATDES` | סטטוס | 24 | פריוריטי ממלאת |
| `TOTPRICE` | מחיר כולל מע"מ | - | מחושב |

שורות (`CPROFITEMS_SUBFORM`, ישות `CPROFITEMS`, מפתח `KLINE`):

| שדה בפריוריטי | משמעות | אורך | שדה באפליקציה |
|---|---|---|---|
| `PARTNAME` | מק"ט | 22 | `lines[].partname` (חובה) |
| `TQUANT` | כמות | - | `lines[].qty` (חובה, > 0) |
| `PRICE` | מחיר ליחידה | - | `lines[].price` (אופציונלי בשרת; בלעדיו פריוריטי אמורה לתמחר לפי המחירון - לא נבדק) |
| `PDES` | תאור מוצר | 59 | `lines[].description` |

## הזמנות לקוח - `ORDERS` (מפתח: `ORDNAME`), שורות: `ORDERITEMS_SUBFORM`

| שדה בפריוריטי | משמעות | אורך | שדה באפליקציה |
|---|---|---|---|
| `ORDNAME` | הזמנה (מספר) | 16 | תשובה: `ordname` |
| `CUSTNAME` | מס. לקוח | 16 | `custname` (חובה) |
| `DETAILS` | פרטים | **24** | `details` |
| `REFERENCE` | הז. רכש (לקוח) | 25 | `reference` |
| `CURDATE` | תאריך | - | פריוריטי ממלאת |
| `ORDSTATUSDES` | סטטוס הזמנה | 12 | פריוריטי ממלאת |
| `CPROFNUM` | הצעת מחיר | 16 | לא ממופה (אפשר לקשר בעתיד) |

שורות (`ORDERITEMS_SUBFORM`, ישות `ORDERITEMS`, מפתח `KLINE`): אותם שדות כמו בהצעת מחיר -
`PARTNAME` ← `partname`, `TQUANT` ← `qty`, `PRICE` ← `price`, `PDES` ← `description`.

יצירת הצעה/הזמנה נשלחת כ-deep insert אחד: `POST /CPROF` (או `/ORDERS`) עם מערך השורות בתוך שם תת-הטופס.

## אנשי קשר - `PHONEBOOK` (מפתח: `FIRMA`,`NAMEA`) - לא בשימוש כרגע

שדות רלוונטיים: `NAME` (שם), `PHONENUM` (טלפון ראשי), `CELLPHONE` (נייד), `EMAIL`, `CUSTNAME` (קשור ללקוח).
קריאה עובדת בדמו.

## מה נמצא בסביבת הדמו

- קריאה עובדת ל-`CUSTOMERS`, `LOGPART`, `PRICELIST`, `CPROF` (עם `$expand=CPROFITEMS_SUBFORM`), `ORDERS` (עם `$expand=ORDERITEMS_SUBFORM`), `PHONEBOOK`.
- `SERVCALLS` (קריאות שירות) ו-`TECHNICIANS` חסומים ל-API בדמו: `400 "לא ניתן להפעיל API למסך זה."`. בהתקנה של Genair צריך לבקש מהשותף לפתוח אותם ל-API אם רוצים לסנכרן קריאות שירות.
- `contains()` נתמך, אבל **רגיש לאותיות גדולות/קטנות**. `tolower()` לא זורק שגיאה אלא פשוט מתעלם מהסינון ומחזיר שורות לא מסוננות, ולכן השרת לא משתמש בו ושולח כמה וריאציות (כמו שהוקלד / lower / UPPER / Capitalized, ובטלפון גם ספרות בלבד).
- `'` מוכפל ל-`''` בתוך מחרוזות `$filter` ועובד (נבדק עם `O'B`).
- `$count=true` לא מחזיר `@odata.count`; `/$count` כן עובד (2000 לקוחות בדמו) אבל איטי, ולכן `/api/priority/test` מסתפק ב-`$top=5`.
- שגיאה מפריוריטי מגיעה בפורמט `{"error":{"code":"400","message":"..."}}` (OData) או `{"FORM":{"InterfaceErrors":{"text":"..."}}}` (שגיאות טופס בכתיבה). השרת מחזיר את ההודעה ב-`error.details.message`.
- כתיבה **לא נבדקה** מול הדמו (הוא משותף לכולם). ה-payload-ים נבדקו בבדיקות יחידה בלבד. בהתקנת live: לבדוק פעם ראשונה עם `?dryRun=1`, ואז בכתיבה אמיתית על לקוח בדיקה.

## סנכרון אוטומטי: מסכים נוספים

השדות נלקחו מה-`$metadata` של הדמו. הקריאות (הזמנות, חשבוניות, קבלות, יתרות, מלאי) נבדקו מול הדמו ב-20.10.2026. הכתיבות נבדקו בבדיקות יחידה בלבד.

| מסך | כיוון | שדות | הערות |
|---|---|---|---|
| `CUSTPERSONNEL_SUBFORM` (מפתח `NAME`,`FIRM`) | → | `NAME`, `CELLPHONE`, `EMAIL`, `POSITIONDES` | נוצר תחת הלקוח; מקושר לפי שם או טלפון |
| `CPROF` | → | `CUSTNAME`, `REFERENCE` (מספר ההצעה), `DETAILS`, שורות | עריכה: `PATCH` לכותרת ומחיקה והוספה של השורות (`KLINE`) |
| `ORDERS` | ⇄ | יציאה: כמו `CPROF` + `CPROFNUM`. חזרה: `ORDSTATUSDES`, `BOOLCLOSED`, `TOTPRICE` | משיכה לפי `STATUSDATE` |
| `SUPPLIERS` | → | `SUPDES`, `PHONE`, `EMAIL`, `ADDRESS`, `VATNUM` | קישור לפי ח״פ או שם |
| `PORDERS` + `PORDERITEMS_SUBFORM` | → | `SUPNAME`, `DETAILS` (מספר ההזמנה), שורות `PARTNAME`, `TQUANT`, `PRICE`, `PDES` | |
| `DOCUMENTS_Q` | → | `CUSTNAME`, `REFERENCE`, `SERNUM`, `PHONENUM`, `DOCTEXT_Q_SUBFORM.TEXT` | סטטוסים לא נשלחים (קודים משתנים בין התקנות) |
| `AINVOICES`, `CINVOICES`, `EINVOICES` | ← | `IVNUM`, `CUSTNAME`, `IVDATE`, `ORDNAME`, `TOTPRICE`, `DETAILS` | רק `FINAL eq 'Y'`. חשבונית מס קבלה נרשמת גם כחשבונית וגם כתשלום |
| `TINVOICES` | ← | כמו למעלה | קבלות. התיק לפי `ORDNAME`, אחרת התיק הפתוח האחרון של הלקוח |
| `OBLIGO` | ← | `OBLIGO`, `IV_DEBIT`, `ACC_DEBIT`, `ORD_DEBIT` | |
| `LOGPART` | ← | `PARTNAME`, `BASEPLPRICE`, `COST`, `UDATE` | `UDATE` כולל שעה, ולכן המשיכה לפי זמן מדויק |
| `PARTBAL` | ← | `PARTNAME`, `WARHSNAME`, `BALANCE` | רק מחסנים ב-`PRIORITY_WAREHOUSES` |

לרוב המסמכים אין שדה "עודכן לאחרונה" ב-API (יש ב-`LOGPART`, `SERNUMBERS`, `ACCOUNTS`). לכן המנוע מושך לפי תאריך המסמך או הסטטוס עם חפיפה (יום להזמנות, 14 יום לחשבוניות וקבלות, 120 יום בסבב מלא), ומדלג על מה שכבר ראה לפי hash.

## סבב שני: כל מה שיש לו מקבילה

| מסך | כיוון | שדות | נבדק בדמו |
|---|---|---|---|
| `AGENTS` | → | `AGENTCODE` (ראשי תיבות + מספר), `AGENTNAME`, `EMAIL`, `CELLPHONE`. קישור לפי שם | כן |
| `CUSTDESTS_SUBFORM` (מפתח `CODE`) | → | `CODE` 01, 02..., `CODEDES`, `ADDRESS`, `STATE` | כן |
| `CUSTEXTFILE_SUBFORM`, `SUPEXTFILE_SUBFORM` | → | `EXTFILEDES` (68), `EXTFILENAME` = `data:<mime>;base64,...` | כן (על לקוח `EXTFILES_SUBFORM` סגור ל-API) |
| `SERNUMBERS` (מפתח `SERNUM`,`PART`) | ⇄ | `SERNUM`, `PARTNAME`, `CUSTNAME`, `INSTDATE`, `LOCATION`. חוזר: `WARDATEFINAL`, `LASTMAINTDATE`, `NEXTMAINTDATE` לפי `UDATE` | כן. הפריט חייב `SERNFLAG`. תאריך אחריות דורש קוד אחריות, ולכן לא נשלח |
| `DOCUMENTS_Q` | ⇄ | `CALLSTATUSCODE` לפי `CALLSTATUSES` (`FINAL`, `CANCEL`), `DETAILS` (24) | כן. טקסטים (`DOCTEXT_Q`) לקריאה בלבד, ותעודה סגורה לא ניתנת לשינוי |
| `DOCUMENTS_T` + `TRANSORDER_T_SUBFORM` | → | `CURDATE` (חובה), `WARHSNAME`/`LOCNAME` → `TOWARHSNAME`/`TOLOCNAME`, `DETAILS` = `SM <מזהה>` | כן, כולל סטטוס `Final` (`TDOCSTATS.FINALFLAG`) |
| `DOCUMENTS_D` + `TRANSORDER_D_SUBFORM` | → | `CUSTNAME`, `WARHSNAME`, `CURDATE`, שורות | כן, כולל `Final` (`DDOCSTATS`) |
| `PORDERS.STATDES` | ⇄ | מאושרת לפי `PORDSTATS` (`APPROVED`, `OPENDOCFLAG`, `AFTERAPPFLAG`), מבוטלת (`CLOSEDBOOL` בלי `CLOSESTATFLAG`) | כן |
| `DOCUMENTS_P` + `TRANSORDER_P_SUBFORM` | → | `SUPNAME`, `TOWARHSNAME`, `CURDATE`, שורות עם `ORDNAME` | כן. נדחית כשההזמנה בטיוטה, ולכן מאשרים אותה קודם |
| `YINVOICES`, `PINVOICES` | ← | `IVNUM`, `SUPNAME`, `ORDNAME`, `TOTPRICE`, `IVDATE`, רק `FINAL` | קריאה |
| `CUSTNOTES_SUBFORM` | → | `SUBJECT` (52), `CURDATE` | כן |
| `CUSTPERSONNEL_SUBFORM` | ← | `NAME`, `CELLPHONE`/`PHONENUM`, `EMAIL`, `POSITIONDES` | כן |

סגורים ל-API בדמו: `DOCPROJ` (פרויקטים), `TECHNICIANS`, `DOCUMENTS_NCONT`, `DOCUMENTS_A`, `WARRANTIES`.
