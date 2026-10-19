// A small org for the database / auth / portal tests, shaped like the app's seed.
const iso = (days) => new Date(Date.now() + days * 86400_000).toISOString();
const day = (days) => iso(days).slice(0, 10);

export function orgSnapshot() {
  return {
    collections: {
      users: [
        { id: 'u-admin', name: 'דוד מזרחי', role: 'admin', title: 'מנכ״ל', phone: '0502201100', email: 'david@genair.co.il', color: '#0f766e', active: true, password: 'leak-me' },
        { id: 'u-office', name: 'משה כהן', role: 'office', title: 'משרד', phone: '0502201101', email: 'office@genair.co.il', color: '#0ea5e9', active: true },
        { id: 'u-agent1', name: 'אבי לוי', role: 'agent', title: 'סוכן', phone: '0502201102', color: '#00aeef', active: true },
        { id: 'u-inst1', name: 'סאמר חלבי', role: 'installer', title: 'מתקין', phone: '0502201105', color: '#16a34a', active: true },
      ],
      customers: [
        { id: 'c1', name: 'משפחת לוי', type: 'private', phone: '0541111111', addresses: [{ id: 'a1', city: 'ירושלים', street: 'הרצל', number: '5', entryNotes: 'קוד 1234' }], sync: { status: 'synced' }, createdAt: iso(-30) },
        { id: 'c2', name: 'רונית ברק', type: 'private', phone: '0542222222', addresses: [{ id: 'a2', city: 'בית שמש', street: 'נחל דולב', number: '3' }], sync: { status: 'synced' }, createdAt: iso(-20) },
      ],
      contacts: [{ id: 'ct1', customerId: 'c1', name: 'יעל לוי', phone: '0541111111', primary: true }],
      cases: [
        { id: 'k1', number: 'GN-260100', title: 'מיזוג דירה — לוי', customerId: 'c1', contactIds: ['ct1'], addressId: 'a1', projectType: 'apartment', stage: 'quote', source: 'phone', agentId: 'u-agent1', installerIds: [], priority: 'normal', tags: [], notes: 'הערה פנימית', survey: { rooms: [], photos: [] }, portal: { token: 'TokenK1abcdefgh', enabled: true }, createdAt: iso(-10), updatedAt: iso(-1) },
        { id: 'k2', number: 'GN-260101', title: 'החלפת מזגן — ברק', customerId: 'c2', contactIds: [], addressId: 'a2', projectType: 'replacement', stage: 'quote', source: 'phone', agentId: 'u-agent1', installerIds: [], priority: 'normal', tags: [], survey: { rooms: [], photos: [] }, portal: { token: 'TokenK2abcdefgh', enabled: true }, createdAt: iso(-9), updatedAt: iso(-1) },
        { id: 'k3', number: 'GN-260102', title: 'סגור', customerId: 'c2', contactIds: [], addressId: 'a2', projectType: 'other', stage: 'lead', source: 'phone', installerIds: [], priority: 'normal', tags: [], survey: { rooms: [], photos: [] }, portal: { token: 'TokenK3closedxx', enabled: false }, createdAt: iso(-9), updatedAt: iso(-1) },
      ],
      quotes: [
        { id: 'q1', caseId: 'k1', number: 'Q-26-0001', version: 1, status: 'sent', lines: [{ id: 'l1', itemId: 'i1', description: 'מזגן 1.5 כ״ס', qty: 2, unit: 'יח׳', unitPrice: 3000, aiReason: 'פנימי' }], discountPct: 10, vatPct: 18, validUntil: day(10), terms: 'תנאים', ai: { summary: 'פנימי' }, createdBy: 'u-agent1', createdAt: iso(-2), sync: { status: 'not_synced' } },
        { id: 'q0', caseId: 'k1', number: 'Q-26-0000', version: 0, status: 'draft', lines: [], discountPct: 0, vatPct: 18, validUntil: day(10), terms: '', createdAt: iso(-3), sync: { status: 'not_synced' } },
        { id: 'q2', caseId: 'k2', number: 'Q-26-0002', version: 1, status: 'sent', lines: [{ id: 'l2', description: 'מזגן', qty: 1, unit: 'יח׳', unitPrice: 5000 }], discountPct: 0, vatPct: 18, validUntil: day(-1), terms: '', createdAt: iso(-5), sync: { status: 'not_synced' } },
      ],
      appointments: [
        { id: 'ap1', type: 'survey', title: 'סקר — לוי', caseId: 'k1', customerId: 'c1', start: iso(2), end: iso(2.1), userIds: ['u-agent1', 'u-inst1'], status: 'planned', checklist: [], photosBefore: [], photosAfter: [], notes: 'פנימי' },
        { id: 'ap2', type: 'installation', title: 'התקנה — ברק', caseId: 'k2', customerId: 'c2', start: iso(3), end: iso(3.2), userIds: ['u-inst1'], status: 'planned', checklist: [], photosBefore: [], photosAfter: [] },
      ],
      units: [{ id: 'un1', customerId: 'c1', caseId: 'k1', addressId: 'a1', model: 'Electra', serial: 'SN1', installedAt: day(-400), warrantyUntil: day(300) }],
      contracts: [],
      docs: [
        { id: 'd1', caseId: 'k1', folder: 'customer', name: 'תוכנית.pdf', mime: 'application/pdf', uploadedAt: iso(-3) },
        { id: 'd2', caseId: 'k1', folder: 'office', name: 'פנימי.pdf', mime: 'application/pdf', uploadedAt: iso(-3) },
        { id: 'd3', caseId: 'k2', folder: 'customer', name: 'של ברק.pdf', mime: 'application/pdf', uploadedAt: iso(-3) },
      ],
      messages: [
        { id: 'm1', caseId: 'k1', customerId: 'c1', channel: 'portal', direction: 'out', body: 'שלום יעל', at: iso(-1), by: 'u-agent1', status: 'sent' },
        { id: 'm2', caseId: 'k1', customerId: 'c1', channel: 'whatsapp', direction: 'out', body: 'פנימי בוואטסאפ', at: iso(-1), status: 'sent' },
        { id: 'm3', caseId: 'k2', customerId: 'c2', channel: 'portal', direction: 'in', body: 'של ברק', at: iso(-1), status: 'delivered' },
      ],
      activities: [],
      notifications: [{ id: 'n1', at: iso(-1), userId: 'u-agent1', text: 'ישנה', read: false }],
      money: [],
      tasks: [],
      leaves: [],
    },
    config: { caseStages: [{ key: 'quote', label: 'הצעת מחיר' }, { key: 'approved', label: 'אושר' }], projectTypes: [{ key: 'apartment', label: 'דירה', active: true }], caseNumbering: { mode: 'global', prefix: 'GN-', pad: 4 } },
    settings: { depositPct: 20, vatPct: 18, serverUrl: 'http://device-only', anthropicKey: 'sk-device' },
    counters: { case: 142, quote: 2, service: 313 },
  };
}

export const ADMIN_PASSWORD = 'admin-pass-123';

/** Bootstraps the in-memory store through the API; returns { token } for the admin. */
export async function bootstrapOrg(s, extra = {}) {
  const r = await s.request('POST', '/api/auth/bootstrap', { body: { snapshot: orgSnapshot(), adminUserId: 'u-admin', password: ADMIN_PASSWORD, ...extra } });
  if (r.status !== 201) throw new Error(`bootstrap failed: ${r.status} ${r.text}`);
  return r.json;
}

export const bearer = (token) => ({ authorization: `Bearer ${token}` });

/** Admin sets a password for another user, then that user logs in. Returns the token. */
export async function loginAs(s, adminToken, userId, login) {
  const pw = `pw-${userId}-1234`;
  const set = await s.request('POST', `/api/auth/users/${userId}/password`, { headers: bearer(adminToken), body: { password: pw } });
  if (set.status !== 200) throw new Error(`set password failed: ${set.text}`);
  const r = await s.request('POST', '/api/auth/login', { body: { login, password: pw } });
  if (r.status !== 200) throw new Error(`login failed: ${r.text}`);
  return r.json.token;
}
