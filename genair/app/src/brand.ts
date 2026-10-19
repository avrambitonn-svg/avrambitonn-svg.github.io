// שפת המותג של הלקוח. כל מה שמזהה את החברה נמצא כאן, כדי שאותה מערכת תתאים גם לחברה אחרת.
export const brand = {
  name: "ג'נאייר",
  nameEn: 'GENAIR',
  tagline: 'SMART AIR CONDITIONING',
  slogan: 'מעלה אחת מעל כולם.',
  promise: 'תהיו רגועים בכל מזג אוויר',
  phone: '02-9401100',
  whatsapp: '972546388435',
  email: 'office@genair.co.il',
  website: 'https://www.genair.co.il',
  address: 'יעקב אליאב 3, ירושלים',
  hours: 'א׳-ה׳ 08:00-17:00',
  // ירושלים: ברירת מחדל לתחזית מזג אוויר וזמני שבת
  geo: { lat: 31.7683, lng: 35.2137, geonameid: 281184 },
  colors: { primary: '#00aeef', ink: '#1c2127' },
}

export type Brand = typeof brand
