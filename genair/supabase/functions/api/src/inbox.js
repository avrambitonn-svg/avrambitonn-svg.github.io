// WhatsApp webhook and inbox on the database (sys_inbox_add / sys_inbox_since) instead of the server's
// in-memory ring buffer. Meta retries deliveries and sends one status event per step (sent, delivered, read)
// under the same message id, so each event is stored under "<type>|<id>|<status>" (like the server's dedup
// key) and by its arrival time; the app gets back the item exactly as before.
import { HttpError, parseJson, readBody } from '../../../../server/src/http.js';
import { extractEvents, verifySignature } from '../../../../server/src/whatsapp.js';

const keyOf = (e) => `${e.type}|${e.id}|${e.status ?? ''}`;

export async function webhookReceive({ req, cfg }) {
  const secret = cfg.whatsapp.appSecret;
  // without the app secret there is no way to tell Meta's calls from anyone else's: refuse rather than fill the inbox with fakes
  if (!secret) throw new HttpError(503, 'whatsapp_not_configured', 'WHATSAPP_APP_SECRET לא הוגדר בשרת, ולכן ה-Webhook לא מקבל הודעות');
  const raw = await readBody(req);
  if (!verifySignature(raw, req.headers['x-hub-signature-256'], secret)) {
    throw new HttpError(401, 'invalid_signature', 'חתימת ה-Webhook אינה תקינה');
  }
  const events = extractEvents(parseJson(raw));
  const arrived = new Date().toISOString();
  const items = events.map((e) => ({ ...e, id: keyOf(e), msgId: e.id, msgAt: e.at, at: arrived }));
  const added = items.length ? Number(await cfg.edge.rpc('sys_inbox_add', { items })) || 0 : 0;
  return { status: 200, body: { ok: true, received: events.length, added } };
}

export async function inboxList({ url, cfg }) {
  const since = url.searchParams.get('since');
  let sinceIso = null;
  if (since) {
    const ms = Date.parse(since);
    if (Number.isNaN(ms)) throw new HttpError(400, 'validation_error', 'הפרמטר since חייב להיות תאריך ISO', { fields: [{ field: 'since' }] });
    sinceIso = new Date(ms).toISOString();
  }
  const r = (await cfg.edge.rpc('sys_inbox_since', { since: sinceIso })) ?? {};
  const stored = r.items ?? [];
  const items = stored.map(({ msgId, msgAt, ...rest }) => ({ ...rest, id: msgId ?? rest.id, at: msgAt ?? rest.at }));
  // up to 500 a call: the cursor is where this page ended, so the next call picks up the rest
  const cursor = stored.length ? stored[stored.length - 1].at : r.cursor;
  return { status: 200, body: { items, cursor: cursor ? new Date(cursor).toISOString() : null } };
}
