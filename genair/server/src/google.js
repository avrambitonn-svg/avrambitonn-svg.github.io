// Google Calendar + Drive with a service account (JWT RS256 -> OAuth access token).
import { createSign } from 'node:crypto';
import { HttpError, fetchUpstream, readJson, readUpstream } from './http.js';

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

async function googleFetch(cfg, sa, url, body) {
  const token = await getAccessToken(sa, { scopes: scopesFor(cfg), subject: cfg.google.subject || undefined });
  const res = await fetchUpstream(
    url,
    { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) },
    { timeoutMs: 20_000, service: SERVICE },
  );
  const data = await readUpstream(res);
  if (!res.ok) {
    const e = data && typeof data === 'object' ? data.error ?? {} : {};
    throw new HttpError(502, 'google_error', e.message ? `Google דחה את הבקשה: ${e.message}` : 'Google דחה את הבקשה', {
      status: res.status,
      reason: e.status ?? e.errors?.[0]?.reason ?? null,
      message: e.message ?? (typeof data === 'string' ? data : ''),
    });
  }
  return data;
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

export async function createDriveFolder({ req, cfg }) {
  const sa = requireAccount(cfg);
  const body = await readJson(req);
  const parent = (typeof body.parentId === 'string' && body.parentId.trim()) || cfg.google.driveParentId;
  // Service accounts have no Drive storage of their own: always create inside a shared folder / shared drive.
  if (!parent) throw new HttpError(503, 'drive_not_configured', 'לא הוגדרה תיקיית אב ב-Google Drive (חסר GOOGLE_DRIVE_PARENT_ID)');
  const folder = buildDriveFolder(body, parent);
  const url = 'https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,webViewLink';
  const data = await googleFetch(cfg, sa, url, folder);
  return { status: 201, body: { id: data?.id ?? null, webViewLink: data?.webViewLink ?? null } };
}

export function googleFeatures(cfg) {
  const sa = parseServiceAccount(cfg.google.serviceAccountRaw);
  return { calendar: Boolean(sa && cfg.google.calendarId), drive: Boolean(sa && cfg.google.driveParentId) };
}
