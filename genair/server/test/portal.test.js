import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forbidFetch, startServer, useEnv } from './helpers.js';
import { bearer, bootstrapOrg } from './fixtures.js';
import { quoteTotals } from '../src/portal.js';

const SIG = `data:image/png;base64,${Buffer.from('signature').toString('base64')}`;

async function org(t) {
  useEnv(t);
  forbidFetch(t);
  const s = await startServer(t);
  const { token: admin } = await bootstrapOrg(s);
  const db = async () => (await s.request('GET', '/api/db/snapshot', { headers: bearer(admin) })).json;
  return { s, admin, db };
}

test('portal GET: only that case, no internal fields', async (t) => {
  const { s } = await org(t);
  const r = await s.request('GET', '/api/portal/TokenK1abcdefgh');
  assert.equal(r.status, 200);
  const p = r.json;
  assert.equal(p.case.id, 'k1');
  assert.equal(p.case.notes, undefined, 'internal notes stay inside');
  assert.equal(p.customer.firstName, 'משפחת לוי');
  assert.equal(p.contact.firstName, 'יעל');
  assert.equal(p.address.entryNotes, undefined);
  assert.deepEqual(p.agent, { firstName: 'אבי', name: 'אבי לוי', phone: '0502201102' });
  assert.equal(p.quote.id, 'q1', 'latest non-draft quote');
  assert.equal(p.quote.ai, undefined);
  assert.equal(p.quote.createdBy, undefined);
  assert.equal(p.quote.lines[0].aiReason, undefined);
  assert.equal(p.quote.lines[0].itemId, undefined);
  assert.deepEqual(p.appointments.map((a) => [a.id, a.team]), [['ap1', ['אבי', 'סאמר']]]);
  assert.equal(p.appointments[0].notes, undefined);
  assert.deepEqual(p.docs.map((d) => d.id), ['d1'], 'only customer-visible docs of this case');
  assert.deepEqual(p.messages.map((m) => [m.id, m.by]), [['m1', 'אבי']], 'only portal messages of this case');
  assert.deepEqual(p.units.map((u) => u.id), ['un1']);
  const text = r.text;
  for (const leak of ['ברק', 'TokenK2', 'פנימי', 'u-admin', '0502201100', 'scrypt', 'קוד 1234']) assert.ok(!text.includes(leak), `must not include ${leak}`);
});

test('portal: unknown, malformed and disabled tokens are 404', async (t) => {
  const { s } = await org(t);
  for (const tok of ['nope12345678', 'TokenK3closedxx', '..%2F..', 'a', 'pt-k1']) assert.equal((await s.request('GET', `/api/portal/${tok}`)).status, 404, tok);
});

test('view marks the quote viewed and notifies the agent once', async (t) => {
  const { s, db } = await org(t);
  await s.request('POST', '/api/portal/TokenK1abcdefgh/view', { body: {} });
  await s.request('POST', '/api/portal/TokenK1abcdefgh/view', { body: {} });
  const d = await db();
  assert.equal(d.collections.quotes.find((q) => q.id === 'q1').status, 'viewed');
  assert.ok(d.collections.cases.find((k) => k.id === 'k1').portal.lastViewedAt);
  assert.equal(d.collections.notifications.filter((n) => n.userId === 'u-agent1' && n.text.includes('צפה')).length, 1);
  assert.equal(d.collections.activities.filter((a) => a.text === 'הלקוח נכנס לאזור האישי').length, 1);
});

test('approve: server sets quote + case, money and notifications; marks approvedVia for the staff follow-up', async (t) => {
  const { s, db } = await org(t);
  const wrongCase = await s.request('POST', '/api/portal/TokenK1abcdefgh/approve', { body: { quoteId: 'q2', signature: { name: 'יעל לוי', dataUrl: SIG }, deposit: { method: 'credit' } } });
  assert.equal(wrongCase.status, 404, 'a quote of another case cannot be approved through this link');
  const noSig = await s.request('POST', '/api/portal/TokenK1abcdefgh/approve', { body: { quoteId: 'q1', signature: { name: 'י', dataUrl: 'javascript:x' }, deposit: { method: 'cash' } } });
  assert.equal(noSig.status, 400);
  assert.deepEqual(noSig.json.error.details.fields.map((f) => f.field), ['signature.name', 'signature.dataUrl', 'deposit.method']);

  const ok = await s.request('POST', '/api/portal/TokenK1abcdefgh/approve', { body: { quoteId: 'q1', signature: { name: 'יעל לוי', dataUrl: SIG }, deposit: { method: 'bit', amount: 1 } } });
  assert.equal(ok.status, 200);
  const total = quoteTotals({ lines: [{ qty: 2, unitPrice: 3000 }], discountPct: 10, vatPct: 18 }).total; // 6372
  assert.equal(total, 6372);
  assert.equal(ok.json.deposit.amount, Math.round(total * 0.2), 'the amount is computed on the server, not taken from the client');

  const d = await db();
  const q = d.collections.quotes.find((x) => x.id === 'q1');
  assert.equal(q.status, 'approved');
  assert.equal(q.approvedVia, 'portal');
  assert.equal(q.approvedFromStage, 'quote');
  assert.equal(q.signature.name, 'יעל לוי');
  assert.ok(q.deposit.paidAt);
  assert.equal(d.collections.quotes.find((x) => x.id === 'q0').status, 'rejected', 'other open quotes of the case close');
  assert.equal(d.collections.cases.find((k) => k.id === 'k1').stage, 'approved');
  assert.equal(d.collections.cases.find((k) => k.id === 'k2').stage, 'quote', 'other cases untouched');
  assert.equal(d.collections.money.filter((m) => m.caseId === 'k1' && m.kind === 'payment').length, 1);
  const notes = d.collections.notifications.map((n) => `${n.userId}:${n.text}`);
  assert.ok(notes.some((n) => n.startsWith('u-office:הצעה אושרה')));
  assert.ok(notes.some((n) => n.startsWith('u-admin:הצעה אושרה')));
  assert.ok(notes.some((n) => n.startsWith('u-agent1:') && n.includes('אושר')));

  const twice = await s.request('POST', '/api/portal/TokenK1abcdefgh/approve', { body: { quoteId: 'q1', signature: { name: 'יעל לוי', dataUrl: SIG }, deposit: { method: 'bit' } } });
  assert.equal(twice.status, 409);
});

test('expired quotes cannot be approved; reject with a reason', async (t) => {
  const { s, db } = await org(t);
  const exp = await s.request('POST', '/api/portal/TokenK2abcdefgh/approve', { body: { quoteId: 'q2', signature: { name: 'רונית ברק', dataUrl: SIG }, deposit: { method: 'credit' } } });
  assert.equal(exp.status, 409);
  assert.equal(exp.json.error.code, 'quote_expired');
  const r = await s.request('POST', '/api/portal/TokenK1abcdefgh/reject', { body: { quoteId: 'q1', reason: 'המחיר גבוה בשבילי' } });
  assert.equal(r.status, 200);
  const d = await db();
  assert.equal(d.collections.quotes.find((x) => x.id === 'q1').status, 'rejected');
  assert.ok(d.collections.notifications.some((n) => n.userId === 'u-agent1' && n.text.includes('המחיר גבוה')));
});

test('service request: number from the shared counter, unit must belong to the customer', async (t) => {
  const { s, db } = await org(t);
  const other = await s.request('POST', '/api/portal/TokenK2abcdefgh/service', { body: { unitId: 'un1', symptom: 'leak' } });
  assert.equal(other.status, 400, "another customer's unit");
  const r = await s.request('POST', '/api/portal/TokenK1abcdefgh/service', { body: { unitId: 'un1', symptom: 'error_code', errorCode: 'e4', text: 'מהבוקר' } });
  assert.equal(r.status, 201);
  assert.equal(r.json.number, 'SC-0314');
  assert.equal(r.json.underWarranty, true);
  const sc = (await db()).collections.serviceCalls[0];
  assert.equal(sc.errorCode, 'E4');
  assert.equal(sc.source, 'portal');
  assert.equal(sc.customerId, 'c1');
});

test('chat: customer message in, staff reply out, both on the portal; files upload and download by link', async (t) => {
  const { s, admin, db } = await org(t);
  const m = await s.request('POST', '/api/portal/TokenK1abcdefgh/messages', { body: { body: 'מתי מגיעים?' } });
  assert.equal(m.status, 201);
  assert.equal((await s.request('POST', '/api/portal/TokenK1abcdefgh/messages', { body: { body: '' } })).status, 400);
  await s.request('POST', '/api/db/ops', { headers: bearer(admin), body: { ops: [{ op: 'upsert', collection: 'messages', id: 'm-reply', data: { caseId: 'k1', customerId: 'c1', channel: 'portal', direction: 'out', body: 'מחר ב-9', at: new Date().toISOString(), by: 'u-admin', status: 'sent' }, at: Date.now() }] } });
  const p = (await s.request('GET', '/api/portal/TokenK1abcdefgh')).json;
  assert.deepEqual(p.messages.map((x) => [x.direction, x.body, x.by ?? null]), [['out', 'שלום יעל', 'אבי'], ['in', 'מתי מגיעים?', null], ['out', 'מחר ב-9', 'דוד']]);
  assert.ok((await db()).collections.notifications.some((n) => n.userId === 'u-agent1' && n.text.includes('מתי מגיעים')));

  const bad = await s.request('POST', '/api/portal/TokenK1abcdefgh/upload', { headers: { 'content-type': 'text/html', 'x-file-name': 'x.html' }, body: '<script>' });
  assert.equal(bad.status, 415);
  const png = Buffer.from('89504e470d0a1a0a0000', 'hex');
  const up = await s.request('POST', '/api/portal/TokenK1abcdefgh/upload', { headers: { 'content-type': 'image/png', 'x-file-name': encodeURIComponent('המזגן שלי.png') }, body: png });
  assert.equal(up.status, 201);
  assert.equal(up.json.name, 'המזגן שלי.png');
  const doc = (await db()).collections.docs.find((d) => d.id === up.json.id);
  assert.equal(doc.folder, 'customer');
  assert.equal(doc.customerVisible, true);
  const file = await s.request('GET', up.json.url);
  assert.equal(file.status, 200);
  assert.equal(file.headers['content-type'], 'image/png');
  assert.match(file.headers['content-security-policy'], /sandbox/);
  assert.equal((await s.request('GET', `/api/portal/TokenK2abcdefgh/files/${up.json.id}`)).status, 404, 'not through another case');
  assert.equal((await s.request('GET', '/api/portal/TokenK1abcdefgh/files/d2')).status, 404, 'office docs are not public');
  const staff = await s.request('GET', `/api/files/${doc.fileId}`, { headers: bearer(admin) });
  assert.equal(staff.status, 200);
  assert.equal((await s.request('GET', `/api/files/${doc.fileId}`)).status, 401);
});

test('leads: validation, honeypot, customer + contact + case on the server', async (t) => {
  const { s, db } = await org(t);
  const bad = await s.request('POST', '/api/public/leads', { body: { name: 'א', phone: '123', type: 'spaceship' } });
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.json.error.details.fields.map((f) => f.field), ['name', 'phone', 'type']);
  const bot = await s.request('POST', '/api/public/leads', { body: { name: 'בוט', phone: '0541234567', type: 'apartment', website: 'http://spam' } });
  assert.equal(bot.status, 201);
  assert.equal(bot.json.number, null);
  const photo = `data:image/jpeg;base64,${Buffer.from('jpeg').toString('base64')}`;
  const r = await s.request('POST', '/api/public/leads', { body: { name: 'נועה כהן', phone: '+972-54-1234567', city: 'מודיעין', type: 'apartment', text: '4 חדרים', photos: [photo], source: 'facebook' } });
  assert.equal(r.status, 201);
  assert.match(r.json.number, /^GN-\d{2}0143$/);
  const d = await db();
  const k = d.collections.cases.find((c) => c.number === r.json.number);
  assert.equal(k.createdVia, 'lead');
  assert.equal(k.source, 'facebook');
  assert.equal(k.survey.photos.length, 1);
  assert.equal(k.portal.token, r.json.portalToken);
  const c = d.collections.customers.find((x) => x.id === k.customerId);
  assert.equal(c.phone, '0541234567');
  assert.equal(d.collections.contacts.find((x) => x.customerId === c.id).name, 'נועה כהן');
  assert.ok(d.collections.notifications.some((n) => n.userId === 'u-office' && n.text.includes('נועה כהן')));
  assert.equal(d.collections.customers.filter((x) => x.name === 'בוט').length, 0);
  assert.equal((await s.request('GET', `/api/portal/${r.json.portalToken}`)).json.case.number, r.json.number, 'the new lead can follow up in the portal');
});

test('leads are rate limited per IP', async (t) => {
  const { s } = await org(t);
  let last;
  for (let i = 0; i < 6; i++) last = await s.request('POST', '/api/public/leads', { body: { name: `לקוח ${i}`, phone: `054123456${i}`, type: 'apartment' } });
  assert.equal(last.status, 429);
});

test('portal without a shared database answers 503', async (t) => {
  useEnv(t, { DB_MODE: 'off' });
  const s = await startServer(t);
  assert.equal((await s.request('GET', '/api/portal/TokenK1abcdefgh')).status, 503);
  assert.equal((await s.request('GET', '/api/health')).json.db.mode, 'off');
});
