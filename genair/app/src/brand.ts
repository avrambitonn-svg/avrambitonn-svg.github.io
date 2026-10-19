// שפת המותג של הלקוח. כל מה שמזהה את החברה נמצא כאן, כדי שאותה מערכת תתאים גם לחברה אחרת.
const common = {
  hours: 'א׳-ה׳ 08:00-17:00',
  // ירושלים: ברירת מחדל לתחזית מזג אוויר וזמני שבת
  geo: { lat: 31.7683, lng: 35.2137, geonameid: 281184 },
  colors: { primary: '#00aeef', ink: '#1c2127' },
}

// VITE_BRAND=demo: מותג ניטרלי לקישור הדגמה, בלי שם, טלפון או כתובת של חברה אמיתית.
// התנאי מחושב בזמן הבנייה, כך שהמותג שלא נבחר לא נכנס לקבצים בכלל.
export const brand = import.meta.env.VITE_BRAND === 'demo'
  ? {
      ...common,
      name: 'מיזוג הדגמה',
      nameEn: 'DEMO AIR',
      tagline: 'AIR CONDITIONING OPS',
      slogan: 'מערכת תפעול לחברת מיזוג.',
      promise: 'כל הנתונים כאן בדויים',
      phone: '03-0000000',
      whatsapp: '972500000000',
      email: 'office@example.com',
      domain: 'example.com',
      website: 'https://example.com',
      address: 'כתובת לדוגמה',
      demo: true,
    }
  : {
      ...common,
      name: "ג'נאייר",
      nameEn: 'GENAIR',
      tagline: 'SMART AIR CONDITIONING',
      slogan: 'מעלה אחת מעל כולם.',
      promise: 'תהיו רגועים בכל מזג אוויר',
      phone: '02-9401100',
      whatsapp: '972546388435',
      email: 'office@genair.co.il',
      domain: 'genair.co.il',
      website: 'https://www.genair.co.il',
      address: 'יעקב אליאב 3, ירושלים',
      demo: false,
    }

export type Brand = typeof brand
