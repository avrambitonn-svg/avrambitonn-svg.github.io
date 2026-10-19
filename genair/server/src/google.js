// Google Calendar + Drive with a service account (JWT RS256 -> OAuth access token).
import { createSign, randomBytes } from 'node:crypto';
import { HttpError, fetchUpstream, readBody, readJson, readUpstream } from './http.js';

const SERVICE = { code: 'google', label: 'Google', to: 'ל-Google' };
export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
export const TIME_ZONE = 'Asia/Jerusalem';

// ---------------------------------------------------------------- credentials

/** Accepts the service-account JSON raw or base64-encoded. Returns null if unusable. */
export function parseServiceAccount(raw) {
  if (!raw) return null;
  let text = String(raw).trim();
  if (!text.startsWith('{')) {
    try {
      text = Buffer.from(text, 'base64').toString('utf8').trim();
    } catch {
      return null;
    }
  }
  try {
    const sa = JSON.parse(text);
    if (!sa?.client_email || !sa?.private_key) return null;
    // Keys pasted into env UIs often arrive with literal "\n" sequences.
    return { ...sa, private_key: String(sa.private_key).replace(/\\n/g, '\n') };
  } catch {
    return null;
  }
}

const b64url = (input) => Buffer.from(input).toString('base64url');

/** Builds a signed JWT assertion for the OAuth 2.0 JWT-bearer grant. */
export function buildJwt({ clientEmail, privateKey, privateKeyId, scope, subject, audience = TOKEN_URL, nowSec = Math.floor(Date.now() / 1000) }) {
  const header = { alg: 'RS256', typ: 'JWT' };
  if (privateKeyId) header.kid = privateKeyId;
  const claims = { iss: clientEmail, scope, aud: audience, iat: nowSec, exp: nowSec + 3600 };
  if (subject) claims.sub = subject;
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(privateKey);
  return `${unsigned}.${signature.toString('base64url')}`;
}

const tokenCache = new Map();
export const clearTokenCache = () => tokenCache.clear();

export async function getAccessToken(sa, { scopes, subject, now = Date.now } = {}) {
  const scope = scopes.join(' ');
  const key = `${sa.client_email}|${subject ?? ''}|${scope}`;
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt - 60_000 > now()) return cached.token;

  let assertion;
  try {
    assertion = buildJwt({
      clientEmail: sa.client_email,
      privateKey: sa.private_key,
      privateKeyId: sa.private_key_id,
      scope,
      subject,
      audience: TOKEN_URL,
      nowSec: Math.floor(now() / 1000),
    });
  } catch {
    throw new HttpError(503, 'google_not_configured', 'המפתח הפרטי של חשבון השירות של Google אינו תקין');
  }
  const res = await fetchUpstream(
    TOKEN_URL,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    },
    { timeoutMs: 20_000, service: SERVICE },
  );
  const data = await readUpstream(res);
  if (!res.ok || !data?.access_token) {
    throw new HttpError(502, 'google_auth_failed', 'ההתחברות ל-Google נכשלה (בדקו את חשבון השירות וההרשאות)', {
      status: res.status,
      message: data?.error_description ?? data?.error ?? '',
    });
  }
  const token = data.access_token;
  tokenCache.set(key, { token, expiresAt: now() + (Number(data.expires_in) || 3600) * 1000 });
  return token;
}

function requireAccount(cfg) {
  const sa = parseServiceAccount(cfg.google.serviceAccountRaw);
  if (!sa) {
    throw new HttpError(503, 'google_not_configured', 'חיבור Google לא הוגדר בשרת (חסר או לא תקין GOOGLE_SERVICE_ACCOUNT_JSON)');
  }
  return sa;
}

const scopesFor = (cfg) => [CALENDAR_SCOPE, cfg.google.driveScope];

async function googleCall(cfg, sa, method, url, { json, body, headers = {}, okStatuses = [] } = {}) {
  const token = await getAccessToken(sa, { scopes: scopesFor(cfg), subject: cfg.google.subject || undefined });
  const h = { authorization: `Bearer ${token}`, ...headers };
  if (json !== undefined) h['content-type'] = 'application/json';
  const res = await fetchUpstream(
    url,
    { method, headers: h, body: json !== undefined ? JSON.stringify(json) : body },
    { timeoutMs: body && body.length > 1_000_000 ? 120_000 : 20_000, service: SERVICE },
  );
  const data = await readUpstream(res);
  if (!res.ok && !okStatuses.includes(res.status)) {
    const e = data && typeof data === 'object' ? data.error ?? {} : {};
    throw new HttpError(502, 'google_error', e.message ? `Google דחה את הבקשה: ${e.message}` : 'Google דחה את הבקשה', {
      status: res.status,
      reason: e.status ?? e.errors?.[0]?.reason ?? null,
      message: e.message ?? (typeof data === 'string' ? data : ''),
    });
  }
  return { status: res.status, data };
}

async function googleFetch(cfg, sa, url, body) {
  return (await googleCall(cfg, sa, 'POST', url, { json: body })).data;
}

const GOOGLE_ID_RE = /^[A-Za-z0-9_@.-]{3,1024}$/;
function requireId(value, field) {
  if (typeof value !== 'string' || !GOOGLE_ID_RE.test(value)) {
    throw new HttpError(400, 'validation_error', 'מזהה לא תקין', { fields: [{ field, message: 'מזהה לא תקין' }] });
  }
  return value;
}

// ---------------------------------------------------------------- calendar

/** YYYY-MM-DD of an instant as seen in Asia/Jerusalem. */
export function jerusalemDate(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}

function addDays(ymd, days) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function buildCalendarEvent(body) {
  const fields = [];
  const isText = (v) => typeof v === 'string' && v.trim() !== '';
  if (!isText(body.summary)) fields.push({ field: 'summary', message: 'כותרת האירוע היא שדה חובה' });
  else if (body.summary.length > 1024) fields.push({ field: 'summary', message: 'הכותרת ארוכה מדי' });
  for (const key of ['description', 'location']) {
    if (body[key] !== undefined && body[key] !== null && typeof body[key] !== 'string') fields.push({ field: key, message: 'חייב להיות מחרוזת' });
  }
  const startMs = isText(body.start) ? Date.parse(body.start) : NaN;
  const endMs = isText(body.end) ? Date.parse(body.end) : NaN;
  if (Number.isNaN(startMs)) fields.push({ field: 'start', message: 'זמן התחלה חייב להיות תאריך ISO' });
  if (Number.isNaN(endMs)) fields.push({ field: 'end', message: 'זמן סיום חייב להיות תאריך ISO' });
  const allDay = body.allDay === true;
  if (!fields.length && !allDay && endMs <= startMs) fields.push({ field: 'end', message: 'זמן הסיום חייב להיות אחרי זמן ההתחלה' });

  let start;
  let end;
  if (!fields.length) {
    if (allDay) {
      const s = jerusalemDate(body.start);
      let e = jerusalemDate(body.end);
      if (e < s) fields.push({ field: 'end', message: 'תאריך הסיום חייב להיות אחרי תאריך ההתחלה' });
      if (e <= s) e = addDays(s, 1); // Google's all-day end date is exclusive.
      start = { date: s };
      end = { date: e };
    } else {
      start = { dateTime: body.start, timeZone: TIME_ZONE };
      end = { dateTime: body.end, timeZone: TIME_ZONE };
    }
  }
  if (fields.length) throw new HttpError(400, 'validation_error', 'נתונים חסרים או שגויים בבקשה', { fields });

  const event = { summary: body.summary.trim(), start, end };
  if (isText(body.description)) event.description = body.description;
  if (isText(body.location)) event.location = body.location;
  return event;
}

export async function createCalendarEvent({ req, cfg }) {
  const sa = requireAccount(cfg);
  const body = await readJson(req);
  const calendarId = (typeof body.calendarId === 'string' && body.calendarId.trim()) || cfg.google.calendarId;
  if (!calendarId) throw new HttpError(503, 'calendar_not_configured', 'לא הוגדר יומן Google בשרת (חסר GOOGLE_CALENDAR_ID)');
  const event = buildCalendarEvent(body);
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  const data = await googleFetch(cfg, sa, url, event);
  return { status: 201, body: { id: data?.id ?? null, htmlLink: data?.htmlLink ?? null } };
}

function calendarFor(cfg, value) {
  const calendarId = (typeof value === 'string' && value.trim()) || cfg.google.calendarId;
  if (!calendarId) throw new HttpError(503, 'calendar_not_configured', 'לא הוגדר יומן Google בשרת (חסר GOOGLE_CALENDAR_ID)');
  return calendarId;
}

/** PATCH /api/google/calendar/events/:id - new time, title or details; same body as create. */
export async function updateCalendarEvent({ req, cfg, params }) {
  const sa = requireAccount(cfg);
  const id = requireId(params.id, 'id');
  const body = await readJson(req);
  const calendarId = calendarFor(cfg, body.calendarId);
  const event = buildCalendarEvent(body);
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`;
  const { data } = await googleCall(cfg, sa, 'PATCH', url, { json: event });
  return { status: 200, body: { id: data?.id ?? id, htmlLink: data?.htmlLink ?? null } };
}

/** DELETE /api/google/calendar/events/:id?calendarId= - an event that is already gone counts as deleted. */
export async function deleteCalendarEvent({ cfg, params, url }) {
  const sa = requireAccount(cfg);
  const id = requireId(params.id, 'id');
  const calendarId = calendarFor(cfg, url.searchParams.get('calendarId'));
  const target = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`;
  const { status } = await googleCall(cfg, sa, 'DELETE', target, { okStatuses: [404, 410] });
  return { status: 200, body: { ok: true, gone: status === 404 || status === 410 } };
}

// ---------------------------------------------------------------- drive

export function buildDriveFolder(body, defaultParent) {
  const fields = [];
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) fields.push({ field: 'name', message: 'שם התיקייה הוא שדה חובה' });
  else if (name.length > 255) fields.push({ field: 'name', message: 'שם התיקייה ארוך מדי' });
  if (fields.length) throw new HttpError(400, 'validation_error', 'נתונים חסרים או שגויים בבקשה', { fields });
  const parentId = (typeof body.parentId === 'string' && body.parentId.trim()) || defaultParent;
  return { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] };
}

/** subfolders: [{ key, name }] (the case's folders from the app's config) - created inside the new folder. */
export function parseSubfolders(list) {
  if (list === undefined) return [];
  const bad = () => new HttpError(400, 'validation_error', 'רשימת תיקיות המשנה לא תקינה', { fields: [{ field: 'subfolders' }] });
  if (!Array.isArray(list) || list.length > 20) throw bad();
  return list.map((x) => {
    const key = typeof x?.key === 'string' ? x.key.trim() : '';
    const name = typeof x?.name === 'string' ? x.name.trim() : '';
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(key) || !name || name.length > 120) throw bad();
    return { key, name };
  });
}

export async function createDriveFolder({ req, cfg }) {
  const sa = requireAccount(cfg);
  const body = await readJson(req);
  const parent = (typeof body.parentId === 'string' && body.parentId.trim()) || cfg.google.driveParentId;
  // Service accounts have no Drive storage of their own: always create inside a shared folder / shared drive.
  if (!parent) throw new HttpError(503, 'drive_not_configured', 'לא הוגדרה תיקיית אב ב-Google Drive (חסר GOOGLE_DRIVE_PARENT_ID)');
  const folder = buildDriveFolder(body, parent);
  const subs = parseSubfolders(body.subfolders);
  const url = 'https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,webViewLink';
  const data = await googleFetch(cfg, sa, url, folder);
  const out = { id: data?.id ?? null, webViewLink: data?.webViewLink ?? null };
  if (subs.length && out.id) {
    out.subfolders = {};
    for (const sub of subs) {
      const d = await googleFetch(cfg, sa, url, buildDriveFolder({ name: sub.name }, out.id));
      out.subfolders[sub.key] = d?.id ?? null;
    }
  }
  return { status: 201, body: out };
}

/** Uploads bytes into a Drive folder (multipart upload). Used by POST /api/files and /api/google/drive/files. */
export async function uploadBufferToDrive(cfg, { name, mime, data, folderId }) {
  const sa = requireAccount(cfg);
  requireId(folderId, 'folderId');
  const boundary = `genair${randomBytes(12).toString('hex')}`;
  const meta = JSON.stringify({ name, parents: [folderId] });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink';
  const { data: res } = await googleCall(cfg, sa, 'POST', url, { body, headers: { 'content-type': `multipart/related; boundary=${boundary}` } });
  return { id: res?.id ?? null, webViewLink: res?.webViewLink ?? null };
}

export const safeFileName = (raw) => {
  let name = '';
  try {
    name = decodeURIComponent(String(raw ?? ''));
  } catch {
    name = String(raw ?? '');
  }
  name = name.replace(/[\u0000-\u001f\u007f/\\]/g, '_').trim().slice(0, 180);
  return name || 'file';
};
export const safeMime = (raw) => {
  const m = String(raw ?? '').split(';')[0].trim().toLowerCase();
  return /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/.test(m) ? m : 'application/octet-stream';
};

/** POST /api/google/drive/files?folderId= - raw body, file name in x-file-name (URI-encoded). */
export async function uploadDriveFile({ req, cfg, url }) {
  requireAccount(cfg);
  const folderId = url.searchParams.get('folderId') || req.headers['x-drive-folder-id'];
  if (!folderId) throw new HttpError(400, 'validation_error', 'חסרה תיקיית יעד', { fields: [{ field: 'folderId' }] });
  const data = await readBody(req, cfg.db?.filesMaxBytes);
  if (!data.length) throw new HttpError(400, 'validation_error', 'הקובץ ריק');
  const out = await uploadBufferToDrive(cfg, { name: safeFileName(req.headers['x-file-name']), mime: safeMime(req.headers['content-type']), data, folderId: String(folderId) });
  return { status: 201, body: out };
}

/** POST /api/google/drive/files/:id/move { from?, to } */
export async function moveDriveFile({ req, cfg, params }) {
  const sa = requireAccount(cfg);
  const id = requireId(params.id, 'id');
  const body = await readJson(req);
  const to = requireId(body.to, 'to');
  const q = new URLSearchParams({ addParents: to, supportsAllDrives: 'true', fields: 'id,parents,webViewLink' });
  if (body.from) q.set('removeParents', requireId(body.from, 'from'));
  const { data } = await googleCall(cfg, sa, 'PATCH', `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?${q}`, { json: {} });
  return { status: 200, body: { id: data?.id ?? id, webViewLink: data?.webViewLink ?? null } };
}

/** POST /api/google/drive/files/:id/trash - to Drive's trash (recoverable there for 30 days). */
export async function trashDriveFile({ cfg, params }) {
  const sa = requireAccount(cfg);
  const id = requireId(params.id, 'id');
  const { status } = await googleCall(cfg, sa, 'PATCH', `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?supportsAllDrives=true`, { json: { trashed: true }, okStatuses: [404] });
  return { status: 200, body: { ok: true, gone: status === 404 } };
}

export function googleFeatures(cfg) {
  const sa = parseServiceAccount(cfg.google.serviceAccountRaw);
  return { calendar: Boolean(sa && cfg.google.calendarId), drive: Boolean(sa && cfg.google.driveParentId) };
}
