import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import {
  buildCalendarEvent,
  buildDriveFolder,
  buildJwt,
  clearTokenCache,
  getAccessToken,
  jerusalemDate,
  parseServiceAccount,
} from '../src/google.js';
import { forbidFetch, jsonResponse, mockFetch, startServer, useIntegrationEnv } from './helpers.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });
const SA = {
  type: 'service_account',
  project_id: 'genair-test',
  private_key_id: 'kid123',
  private_key: PEM,
  client_email: 'genair-ops@genair-test.iam.gserviceaccount.com',
  token_uri: 'https://oauth2.googleapis.com/token',
};

const decode = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

test('parseServiceAccount accepts raw JSON, base64, and fixes literal \\n in the key', () => {
  assert.equal(parseServiceAccount(JSON.stringify(SA)).client_email, SA.client_email);
  assert.equal(parseServiceAccount(Buffer.from(JSON.stringify(SA)).toString('base64')).private_key, PEM);
  const escaped = JSON.stringify({ ...SA, private_key: PEM.replace(/\n/g, '\\n') });
  assert.equal(parseServiceAccount(escaped).private_key, PEM);
  assert.equal(parseServiceAccount(''), null);
  assert.equal(parseServiceAccount('not json'), null);
  assert.equal(parseServiceAccount('{"client_email":"x"}'), null);
});

test('buildJwt produces a valid RS256 JWT with the expected claims', () => {
  const jwt = buildJwt({
    clientEmail: SA.client_email,
    privateKey: PEM,
    privateKeyId: 'kid123',
    scope: 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/drive.file',
    nowSec: 1_760_000_000,
  });
  const [h, c, sig] = jwt.split('.');
  assert.deepEqual(decode(h), { alg: 'RS256', typ: 'JWT', kid: 'kid123' });
  assert.deepEqual(decode(c), {
    iss: SA.client_email,
    scope: 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/drive.file',
    aud: 'https://oauth2.googleapis.com/token',
    iat: 1_760_000_000,
    exp: 1_760_003_600,
  });
  const ok = createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(sig, 'base64url'));
  assert.equal(ok, true);
  assert.equal(decode(buildJwt({ clientEmail: 'a', privateKey: PEM, scope: 's', subject: 'boss@genair.co.il', nowSec: 1 }).split('.')[1]).sub, 'boss@genair.co.il');
});

test('getAccessToken exchanges the JWT once and caches until expiry', async (t) => {
  clearTokenCache();
  const calls = mockFetch(t, () => jsonResponse(200, { access_token: 'ya29.token', expires_in: 3599, token_type: 'Bearer' }));
  let now = 1_760_000_000_000;
  const opts = { scopes: ['a', 'b'], now: () => now };
  assert.equal(await getAccessToken(SA, opts), 'ya29.token');
  assert.equal(await getAccessToken(SA, opts), 'ya29.token');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://oauth2.googleapis.com/token');
  const form = new URLSearchParams(calls[0].init.body);
  assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  assert.equal(decode(form.get('assertion').split('.')[1]).scope, 'a b');
  now += 3600 * 1000; // expired -> refresh
  await getAccessToken(SA, opts);
  assert.equal(calls.length, 2);
  clearTokenCache();
});

test('jerusalemDate converts instants to the local calendar date', () => {
  assert.equal(jerusalemDate('2026-10-19'), '2026-10-19');
  assert.equal(jerusalemDate('2026-10-19T22:30:00Z'), '2026-10-20'); // 01:30 in Israel
  assert.equal(jerusalemDate('2026-10-19T08:00:00+03:00'), '2026-10-19');
});

test('buildCalendarEvent: timed and all-day events', () => {
  assert.deepEqual(
    buildCalendarEvent({ summary: 'התקנת מזגן - כהן', description: 'מזגן 1.5', location: 'הרצל 5, חולון', start: '2026-10-20T09:00:00+03:00', end: '2026-10-20T11:00:00+03:00' }),
    {
      summary: 'התקנת מזגן - כהן',
      start: { dateTime: '2026-10-20T09:00:00+03:00', timeZone: 'Asia/Jerusalem' },
      end: { dateTime: '2026-10-20T11:00:00+03:00', timeZone: 'Asia/Jerusalem' },
      description: 'מזגן 1.5',
      location: 'הרצל 5, חולון',
    },
  );
  assert.deepEqual(buildCalendarEvent({ summary: 'חופש', allDay: true, start: '2026-10-20T00:00:00+03:00', end: '2026-10-20T23:59:00+03:00' }), {
    summary: 'חופש', start: { date: '2026-10-20' }, end: { date: '2026-10-21' },
  });
  assert.deepEqual(buildCalendarEvent({ summary: 'כנס', allDay: true, start: '2026-10-20', end: '2026-10-23' }).end, { date: '2026-10-23' });
});

test('buildCalendarEvent validation', () => {
  const fields = (b) => {
    try {
      buildCalendarEvent(b);
    } catch (e) {
      return e.details.fields.map((f) => f.field);
    }
    throw new Error('expected error');
  };
  assert.deepEqual(fields({}), ['summary', 'start', 'end']);
  assert.deepEqual(fields({ summary: 'x', start: '2026-10-20T10:00:00Z', end: '2026-10-20T09:00:00Z' }), ['end']);
  assert.deepEqual(fields({ summary: 'x', start: 'tomorrow', end: '2026-10-20T09:00:00Z' }), ['start']);
});

test('buildDriveFolder', () => {
  assert.deepEqual(buildDriveFolder({ name: ' לקוח 1001 - כהן ' }, 'PARENT'), { name: 'לקוח 1001 - כהן', mimeType: 'application/vnd.google-apps.folder', parents: ['PARENT'] });
  assert.deepEqual(buildDriveFolder({ name: 'x', parentId: 'OTHER' }, 'PARENT').parents, ['OTHER']);
  assert.throws(() => buildDriveFolder({}, 'P'), { code: 'validation_error' });
});

test('routes return 503 without credentials and never call Google', async (t) => {
  useIntegrationEnv(t, { GOOGLE_CALENDAR_ID: 'cal@group.calendar.google.com' });
  const calls = forbidFetch(t);
  const s = await startServer(t);
  const c = await s.request('POST', '/api/google/calendar/events', { body: { summary: 'x', start: '2026-10-20T09:00:00Z', end: '2026-10-20T10:00:00Z' } });
  assert.equal(c.status, 503);
  assert.equal(c.json.error.code, 'google_not_configured');
  const d = await s.request('POST', '/api/google/drive/folders', { body: { name: 'x' } });
  assert.equal(d.status, 503);
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify(SA);
  delete process.env.GOOGLE_CALENDAR_ID;
  const noCal = await s.request('POST', '/api/google/calendar/events', { body: { summary: 'x', start: '2026-10-20T09:00:00Z', end: '2026-10-20T10:00:00Z' } });
  assert.equal(noCal.json.error.code, 'calendar_not_configured');
  const noParent = await s.request('POST', '/api/google/drive/folders', { body: { name: 'x' } });
  assert.equal(noParent.json.error.code, 'drive_not_configured');
  assert.equal(calls.length, 0);
});

test('calendar + drive routes: token exchange, then API calls', async (t) => {
  clearTokenCache();
  useIntegrationEnv(t, {
    GOOGLE_SERVICE_ACCOUNT_JSON: Buffer.from(JSON.stringify(SA)).toString('base64'),
    GOOGLE_CALENDAR_ID: 'genair@group.calendar.google.com',
    GOOGLE_DRIVE_PARENT_ID: 'FOLDER123',
  });
  const calls = mockFetch(t, (url) => {
    if (url === 'https://oauth2.googleapis.com/token') return jsonResponse(200, { access_token: 'ya29.x', expires_in: 3600 });
    if (url.includes('/calendar/v3/')) return jsonResponse(200, { id: 'evt1', htmlLink: 'https://www.google.com/calendar/event?eid=evt1', status: 'confirmed' });
    return jsonResponse(200, { id: 'fld1', webViewLink: 'https://drive.google.com/drive/folders/fld1' });
  });
  const s = await startServer(t);
  const health = await s.request('GET', '/api/health');
  assert.deepEqual(health.json.features.google, { calendar: true, drive: true });

  const ev = await s.request('POST', '/api/google/calendar/events', { body: { summary: 'ביקור טכנאי', start: '2026-10-20T09:00:00+03:00', end: '2026-10-20T10:00:00+03:00' } });
  assert.equal(ev.status, 201);
  assert.deepEqual(ev.json, { id: 'evt1', htmlLink: 'https://www.google.com/calendar/event?eid=evt1' });
  assert.equal(calls[1].url, 'https://www.googleapis.com/calendar/v3/calendars/genair%40group.calendar.google.com/events');
  assert.equal(calls[1].init.headers.authorization, 'Bearer ya29.x');
  assert.equal(JSON.parse(calls[1].init.body).start.timeZone, 'Asia/Jerusalem');

  const fd = await s.request('POST', '/api/google/drive/folders', { body: { name: 'לקוח 1001' } });
  assert.equal(fd.status, 201);
  assert.deepEqual(fd.json, { id: 'fld1', webViewLink: 'https://drive.google.com/drive/folders/fld1' });
  assert.equal(calls[2].url, 'https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,webViewLink');
  assert.deepEqual(JSON.parse(calls[2].init.body).parents, ['FOLDER123']);
  assert.equal(calls.filter((c) => c.url.includes('oauth2')).length, 1, 'token is cached across calls');
  clearTokenCache();
});

test('Google API errors map to 502 google_error with the Google message', async (t) => {
  clearTokenCache();
  useIntegrationEnv(t, { GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify(SA), GOOGLE_CALENDAR_ID: 'c' });
  mockFetch(t, (url) =>
    url.includes('oauth2') ? jsonResponse(200, { access_token: 't', expires_in: 3600 }) : jsonResponse(404, { error: { code: 404, message: 'Not Found', errors: [{ reason: 'notFound' }] } }),
  );
  const s = await startServer(t);
  const r = await s.request('POST', '/api/google/calendar/events', { body: { summary: 'x', start: '2026-10-20T09:00:00Z', end: '2026-10-20T10:00:00Z' } });
  assert.equal(r.status, 502);
  assert.equal(r.json.error.code, 'google_error');
  assert.equal(r.json.error.details.reason, 'notFound');
  clearTokenCache();
});
