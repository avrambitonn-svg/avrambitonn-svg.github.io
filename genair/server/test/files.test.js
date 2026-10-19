import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { jsonResponse, mockFetch, startServer, useEnv } from './helpers.js';
import { bearer, bootstrapOrg } from './fixtures.js';
import { clearTokenCache } from '../src/google.js';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const SA = JSON.stringify({ client_email: 'ops@genair.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });

test('files: upload streams to disk, download needs a session, size limit, unsafe types become attachments', async (t) => {
  useEnv(t, { FILES_MAX_MB: '1' });
  const s = await startServer(t);
  const { token } = await bootstrapOrg(s);
  const body = Buffer.alloc(300_000, 7);
  const up = await s.request('POST', '/api/files', { headers: { ...bearer(token), 'content-type': 'application/pdf', 'x-file-name': encodeURIComponent('חוזה חתום.pdf'), 'x-case-id': 'k1' }, body });
  assert.equal(up.status, 201);
  assert.match(up.json.fileId, /^f[a-f0-9]{24}$/);
  assert.deepEqual({ ...up.json, fileId: 'x' }, { fileId: 'x', name: 'חוזה חתום.pdf', mime: 'application/pdf', size: 300_000 });

  const get = await s.request('GET', `/api/files/${up.json.fileId}`, { headers: bearer(token) });
  assert.equal(get.status, 200);
  assert.equal(get.headers['content-length'], '300000');
  assert.match(get.headers['content-disposition'], /^inline; .*filename\*=UTF-8''%D7%97/);
  assert.equal((await s.request('GET', `/api/files/${up.json.fileId}?download=1`, { headers: bearer(token) })).headers['content-disposition'].split(';')[0], 'attachment');
  assert.equal((await s.request('GET', `/api/files/${up.json.fileId}`)).status, 401);
  assert.equal((await s.request('GET', '/api/files/../../etc/passwd', { headers: bearer(token) })).status, 404);
  assert.equal((await s.request('GET', '/api/files/fdeadbeef', { headers: bearer(token) })).status, 404);

  const big = await s.request('POST', '/api/files', { headers: { ...bearer(token), 'content-type': 'image/png' }, body: Buffer.alloc(1_200_000) });
  assert.equal(big.status, 413);
  assert.equal((await s.request('POST', '/api/files', { headers: { 'content-type': 'image/png' }, body: Buffer.alloc(10) })).status, 401);

  const html = await s.request('POST', '/api/files', { headers: { ...bearer(token), 'content-type': 'text/html', 'x-file-name': 'x.html' }, body: '<script>alert(1)</script>' });
  const served = await s.request('GET', `/api/files/${html.json.fileId}`, { headers: bearer(token) });
  assert.equal(served.headers['content-type'], 'application/octet-stream');
  assert.match(served.headers['content-disposition'], /^attachment/);
  assert.equal(served.headers['x-content-type-options'], 'nosniff');
});

test('files: copied into the case folder in Drive when configured', async (t) => {
  clearTokenCache();
  useEnv(t, { GOOGLE_SERVICE_ACCOUNT_JSON: SA, GOOGLE_DRIVE_PARENT_ID: 'ROOT' });
  const calls = mockFetch(t, (url) => (url.includes('oauth2') ? jsonResponse(200, { access_token: 'ya29', expires_in: 3600 }) : jsonResponse(200, { id: 'drv1', webViewLink: 'https://drive.google.com/file/d/drv1' })));
  const s = await startServer(t);
  const { token } = await bootstrapOrg(s);
  const up = await s.request('POST', '/api/files', { headers: { ...bearer(token), 'content-type': 'image/jpeg', 'x-file-name': 'a.jpg', 'x-drive-folder-id': 'SUB_CUSTOMER' }, body: Buffer.from('jpegdata') });
  assert.equal(up.status, 201);
  assert.equal(up.json.driveFileId, 'drv1');
  const driveCall = calls.find((c) => c.url.includes('/upload/drive/v3/files'));
  assert.match(driveCall.url, /uploadType=multipart/);
  assert.match(driveCall.init.headers['content-type'], /^multipart\/related; boundary=/);
  const sent = Buffer.from(driveCall.init.body).toString('utf8');
  assert.match(sent, /"parents":\["SUB_CUSTOMER"\]/);
  assert.match(sent, /jpegdata/);
  clearTokenCache();
});

test('Drive: case folder with subfolders, direct upload, move and trash', async (t) => {
  clearTokenCache();
  useEnv(t, { GOOGLE_SERVICE_ACCOUNT_JSON: SA, GOOGLE_DRIVE_PARENT_ID: 'ROOT' });
  let n = 0;
  const calls = mockFetch(t, (url, init) => {
    if (url.includes('oauth2')) return jsonResponse(200, { access_token: 'ya29', expires_in: 3600 });
    if (init.method === 'PATCH' && url.includes('/files/gone')) return jsonResponse(404, { error: { message: 'File not found' } });
    return jsonResponse(200, { id: `id${++n}`, webViewLink: `https://drive.google.com/x/id${n}` });
  });
  const s = await startServer(t);
  const f = await s.request('POST', '/api/google/drive/folders', { body: { name: 'GN-260100 — לוי', subfolders: [{ key: 'office', name: 'משרד' }, { key: 'customer', name: 'לקוח' }] } });
  assert.equal(f.status, 201);
  assert.deepEqual(f.json, { id: 'id1', webViewLink: 'https://drive.google.com/x/id1', subfolders: { office: 'id2', customer: 'id3' } });
  const bodies = calls.filter((c) => c.url.includes('/drive/v3/files?')).map((c) => JSON.parse(c.init.body));
  assert.deepEqual(bodies.map((b) => [b.name, b.parents[0]]), [['GN-260100 — לוי', 'ROOT'], ['משרד', 'id1'], ['לקוח', 'id1']]);
  assert.equal((await s.request('POST', '/api/google/drive/folders', { body: { name: 'x', subfolders: [{ key: '../', name: 'x' }] } })).status, 400);

  const up = await s.request('POST', '/api/google/drive/files?folderId=id3', { headers: { 'content-type': 'application/pdf', 'x-file-name': 'a.pdf' }, body: Buffer.from('%PDF') });
  assert.equal(up.status, 201);
  assert.equal(up.json.id, 'id4');

  const mv = await s.request('POST', '/api/google/drive/files/id4/move', { body: { from: 'id3', to: 'id2' } });
  assert.equal(mv.status, 200);
  const mvCall = calls.at(-1);
  assert.equal(mvCall.init.method, 'PATCH');
  assert.match(mvCall.url, /addParents=id2/);
  assert.match(mvCall.url, /removeParents=id3/);

  assert.deepEqual((await s.request('POST', '/api/google/drive/files/id4/trash', {})).json, { ok: true, gone: false });
  assert.equal(JSON.parse(calls.at(-1).init.body).trashed, true);
  assert.deepEqual((await s.request('POST', '/api/google/drive/files/gone/trash', {})).json, { ok: true, gone: true });
  clearTokenCache();
});

test('Calendar: per-user calendarId, update and delete events', async (t) => {
  clearTokenCache();
  useEnv(t, { GOOGLE_SERVICE_ACCOUNT_JSON: SA, GOOGLE_CALENDAR_ID: 'company@group.calendar.google.com' });
  const calls = mockFetch(t, (url, init) => {
    if (url.includes('oauth2')) return jsonResponse(200, { access_token: 'ya29', expires_in: 3600 });
    if (init.method === 'DELETE') return new Response(null, { status: url.includes('/events/old') ? 410 : 204 });
    return jsonResponse(200, { id: 'evt1', htmlLink: 'https://calendar.google.com/evt1' });
  });
  const s = await startServer(t);
  const ev = { summary: 'התקנה', start: '2026-10-20T09:00:00+03:00', end: '2026-10-20T12:00:00+03:00' };
  await s.request('POST', '/api/google/calendar/events', { body: { ...ev, calendarId: 'samer@genair.co.il' } });
  assert.match(calls.at(-1).url, /calendars\/samer%40genair\.co\.il\/events$/);
  const patch = await s.request('PATCH', '/api/google/calendar/events/evt1', { body: { ...ev, start: '2026-10-21T09:00:00+03:00', end: '2026-10-21T12:00:00+03:00', calendarId: 'samer@genair.co.il' } });
  assert.equal(patch.status, 200);
  assert.equal(calls.at(-1).init.method, 'PATCH');
  assert.match(calls.at(-1).url, /samer%40genair\.co\.il\/events\/evt1$/);
  assert.equal(JSON.parse(calls.at(-1).init.body).start.dateTime, '2026-10-21T09:00:00+03:00');
  const del = await s.request('DELETE', '/api/google/calendar/events/evt1?calendarId=samer%40genair.co.il');
  assert.deepEqual(del.json, { ok: true, gone: false });
  assert.deepEqual((await s.request('DELETE', '/api/google/calendar/events/old')).json, { ok: true, gone: true });
  assert.match(calls.at(-1).url, /company%40group/);
  assert.equal((await s.request('PATCH', '/api/google/calendar/events/bad%20id', { body: ev })).status, 400);
  clearTokenCache();
});
