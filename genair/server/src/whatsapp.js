// WhatsApp Business Cloud API (Meta): send messages, receive webhooks, poll an inbox.
import { createHmac } from 'node:crypto';
import { HttpError, fetchUpstream, parseJson, readBody, readJson, readUpstream, safeEqual } from './http.js';

const SERVICE = { code: 'whatsapp', label: 'וואטסאפ', to: 'לוואטסאפ' };
const GRAPH = 'https://graph.facebook.com';

// ---------------------------------------------------------------- phone numbers

/**
 * Normalises to WhatsApp's international digits-only format.
 * 054-123-4567 / +972 54 123 4567 / 00972541234567 / 9720541234567 -> 972541234567.
 * Returns null when the input cannot be a valid number.
 */
export function normalizePhone(input) {
  if (input === undefined || input === null) return null;
  let d = String(input).trim();
  if (!/^[\d\s()+\-./]+$/.test(d)) return null;
  d = d.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('9720')) d = `972${d.slice(4)}`;
  else if (d.startsWith('0')) d = `972${d.slice(1)}`;
  else if (/^5\d{8}$/.test(d)) d = `972${d}`; // Israeli mobile typed without the leading 0
  if (d.startsWith('972')) {
    // Israeli: 972 + 8 (landline) or 9 (mobile 5X...) national digits.
    return /^972[1-9]\d{7,8}$/.test(d) ? d : null;
  }
  return /^[1-9]\d{7,14}$/.test(d) ? d : null;
}

// ---------------------------------------------------------------- send

export function buildSendPayload(body) {
  const fields = [];
  const to = normalizePhone(body.to);
  if (!to) fields.push({ field: 'to', message: 'מספר הטלפון אינו תקין' });

  const hasText = typeof body.text === 'string' && body.text.trim() !== '';
  const hasTemplate = body.template && typeof body.template === 'object';
  if (hasText === Boolean(hasTemplate)) {
    fields.push({ field: 'text', message: 'יש לשלוח text או template (אחד מהם בלבד)' });
  }

  let message;
  if (hasText && !hasTemplate) {
    if (body.text.length > 4096) fields.push({ field: 'text', message: 'ההודעה ארוכה מדי (מקסימום 4096 תווים)' });
    message = { type: 'text', text: { preview_url: false, body: body.text } };
  } else if (hasTemplate && !hasText) {
    const { name, language = 'he', params = [] } = body.template;
    if (typeof name !== 'string' || !/^[a-z0-9_]{1,512}$/.test(name)) {
      fields.push({ field: 'template.name', message: 'שם התבנית אינו תקין (אותיות קטנות באנגלית, ספרות וקו תחתון)' });
    }
    if (typeof language !== 'string' || !/^[a-z]{2,3}(_[A-Z]{2})?$/.test(language)) {
      fields.push({ field: 'template.language', message: 'קוד השפה אינו תקין (למשל he)' });
    }
    if (!Array.isArray(params) || params.some((p) => typeof p !== 'string' && typeof p !== 'number')) {
      fields.push({ field: 'template.params', message: 'params חייב להיות מערך של מחרוזות' });
    }
    const template = { name, language: { code: language } };
    if (Array.isArray(params) && params.length) {
      template.components = [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: String(p) })) }];
    }
    message = { type: 'template', template };
  }

  if (fields.length) throw new HttpError(400, 'validation_error', 'נתונים חסרים או שגויים בבקשה', { fields });
  return { messaging_product: 'whatsapp', recipient_type: 'individual', to, ...message };
}

function whatsappHttpError(status, data) {
  const e = data && typeof data === 'object' ? data.error ?? {} : {};
  const details = { status, code: e.code ?? null, message: e.message ?? (typeof data === 'string' ? data : '') };
  if (e.code === 131047) {
    return new HttpError(422, 'whatsapp_window_closed', 'עברו יותר מ-24 שעות מאז ההודעה האחרונה של הלקוח - אפשר לשלוח רק תבנית מאושרת', details);
  }
  if (status === 401 || e.code === 190) {
    return new HttpError(502, 'whatsapp_auth_failed', 'וואטסאפ דחה את הטוקן (WHATSAPP_TOKEN שגוי או שפג תוקפו)', details);
  }
  return new HttpError(502, 'whatsapp_error', 'וואטסאפ דחה את שליחת ההודעה', details);
}

export async function sendWhatsapp({ req, cfg }) {
  const wa = cfg.whatsapp;
  if (!wa.token || !wa.phoneNumberId) {
    throw new HttpError(503, 'whatsapp_not_configured', 'וואטסאפ לא הוגדר בשרת (חסרים WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID)');
  }
  const payload = buildSendPayload(await readJson(req));
  const url = `${GRAPH}/${encodeURIComponent(wa.graphVersion)}/${encodeURIComponent(wa.phoneNumberId)}/messages`;
  const res = await fetchUpstream(
    url,
    { method: 'POST', headers: { authorization: `Bearer ${wa.token}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) },
    { timeoutMs: 20_000, service: SERVICE },
  );
  const data = await readUpstream(res);
  if (!res.ok) throw whatsappHttpError(res.status, data);
  const id = data?.messages?.[0]?.id;
  if (!id) throw new HttpError(502, 'whatsapp_bad_response', 'וואטסאפ לא החזיר מזהה הודעה');
  return { status: 200, body: { id } };
}

// ---------------------------------------------------------------- inbox (in-memory)

/**
 * Fixed-size ring buffer of webhook events. It lives in process memory, so it is
 * per instance and lost on restart/cold start - fine for a demo, use a DB in production.
 */
export class Inbox {
  constructor(capacity = 500) {
    this.capacity = capacity;
    this.items = [];
    this.keys = new Set();
  }

  add(item, receivedAt = Date.now()) {
    const key = `${item.type}|${item.id}|${item.status ?? ''}`;
    if (this.keys.has(key)) return false; // Meta retries deliveries; drop duplicates.
    this.items.push({ item, key, receivedAt });
    this.keys.add(key);
    while (this.items.length > this.capacity) this.keys.delete(this.items.shift().key);
    return true;
  }

  /** Items received after `sinceMs` (by arrival time, so late webhooks are not missed). */
  since(sinceMs = -Infinity) {
    return this.items.filter((e) => e.receivedAt > sinceMs).map((e) => e.item);
  }

  get cursor() {
    return this.items.length ? this.items[this.items.length - 1].receivedAt : null;
  }

  clear() {
    this.items = [];
    this.keys.clear();
  }
}

export const inbox = new Inbox(500);

const toIso = (ts) => {
  const n = Number(ts);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : new Date().toISOString();
};

function messageText(m) {
  switch (m.type) {
    case 'text': return m.text?.body ?? '';
    case 'button': return m.button?.text ?? '';
    case 'interactive': return m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? '';
    case 'reaction': return m.reaction?.emoji ?? '';
    case 'location': return [m.location?.name, m.location?.address].filter(Boolean).join(', ');
    default: return m[m.type]?.caption ?? '';
  }
}

/** Flattens a Meta webhook payload into inbox items. */
export function extractEvents(payload) {
  const out = [];
  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value ?? {};
      const names = new Map((value.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]));
      for (const m of value.messages ?? []) {
        const item = { id: String(m.id ?? ''), from: String(m.from ?? ''), text: messageText(m), at: toIso(m.timestamp), type: String(m.type ?? 'unknown') };
        const name = names.get(m.from);
        if (name) item.name = name;
        out.push(item);
      }
      for (const st of value.statuses ?? []) {
        out.push({ id: String(st.id ?? ''), from: String(st.recipient_id ?? ''), text: '', at: toIso(st.timestamp), type: 'status', status: String(st.status ?? '') });
      }
    }
  }
  return out;
}

export function verifySignature(rawBody, header, appSecret) {
  if (!header || !String(header).startsWith('sha256=')) return false;
  const expected = `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  return safeEqual(String(header), expected);
}

export async function webhookVerify({ url, cfg }) {
  const token = cfg.whatsapp.verifyToken;
  if (!token) throw new HttpError(503, 'whatsapp_not_configured', 'WHATSAPP_VERIFY_TOKEN לא הוגדר בשרת');
  const p = url.searchParams;
  if (p.get('hub.mode') !== 'subscribe' || !safeEqual(p.get('hub.verify_token') ?? '', token)) {
    throw new HttpError(403, 'webhook_verify_failed', 'אימות ה-Webhook נכשל');
  }
  return { status: 200, text: p.get('hub.challenge') ?? '' };
}

export async function webhookReceive({ req, cfg }) {
  const raw = await readBody(req);
  const secret = cfg.whatsapp.appSecret;
  if (secret && !verifySignature(raw, req.headers['x-hub-signature-256'], secret)) {
    throw new HttpError(401, 'invalid_signature', 'חתימת ה-Webhook אינה תקינה');
  }
  const events = extractEvents(parseJson(raw));
  let added = 0;
  for (const e of events) if (inbox.add(e)) added++;
  return { status: 200, body: { ok: true, received: events.length, added } };
}

export async function inboxList({ url }) {
  const since = url.searchParams.get('since');
  let sinceMs = -Infinity;
  if (since) {
    sinceMs = Date.parse(since);
    if (Number.isNaN(sinceMs)) {
      throw new HttpError(400, 'validation_error', 'הפרמטר since חייב להיות תאריך ISO', { fields: [{ field: 'since' }] });
    }
  }
  const cursor = inbox.cursor;
  return { status: 200, body: { items: inbox.since(sinceMs), cursor: cursor ? new Date(cursor).toISOString() : null } };
}
