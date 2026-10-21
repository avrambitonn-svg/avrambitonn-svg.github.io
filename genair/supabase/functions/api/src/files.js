// Stands in for server/src/files.js inside the Edge Function (the bundler swaps it in). Files live in the
// private Storage bucket "files": a member's upload at <auth uid>/<fileId>-<name>, the portal's and the lead
// form's at portal/<caseId>/<fileId>-<name>. Who uploaded what for which case is recorded with sys_file_save
// (the database checks it when a doc points at a file). Served back with the same safe headers as the server.
// No FILES_QUOTA_MB here: the bucket's own limit (25MB a file) and the project's storage quota apply.
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { HttpError } from '../../../../server/src/http.js';
import { googleFeatures, knownDriveFolder, safeFileName, safeMime, uploadBufferToDrive } from '../../../../server/src/google.js';
import { createWindowLimiter } from './limiter.js';
import { looksLike } from '../../../../server/src/filetype.js';
import { getStore } from './db.js';

const FILE_ID_RE = /^f[a-f0-9]{24}$/;
const INLINE = /^(image\/(png|jpe?g|gif|webp|avif|bmp|heic|heif)|application\/pdf|text\/plain|video\/[a-z0-9.+-]+|audio\/[a-z0-9.+-]+)$/;

// uploads per signed-in user (the portal and the lead form have their own limits)
const uploadsByUser = createWindowLimiter({ max: 120, windowMs: 10 * 60_000, name: 'files.upload' });
export const resetUploadLimits = () => uploadsByUser.clear();
export const resetFileQuota = () => {};
export const filesDir = () => 'storage:files';

const tooLarge = (limit) =>
  new HttpError(413, 'payload_too_large', `הקובץ גדול מדי (מקסימום ${Math.round(limit / 1024 / 1024)}MB)`, { limitBytes: limit });

// Storage keys: ASCII only (the real name is kept in app.files and on the doc)
const asciiName = (name) => String(name).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+/, '').slice(-80) || 'file';
const segment = (s) => String(s ?? '').replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 128);

async function save(cfg, data, { name, mime, meta }) {
  const id = `f${randomBytes(12).toString('hex')}`;
  const prefix = cfg.edge.authId ? segment(cfg.edge.authId) : `portal/${segment(meta.caseId) || 'public'}`;
  const path = `${prefix}/${id}-${asciiName(name)}`;
  await cfg.edge.sb.upload(path, data, mime);
  const info = { id, name, mime, size: data.length, at: new Date().toISOString(), ...meta };
  await cfg.edge.rpc('sys_file_save', {
    p: { id, path, caseId: meta.caseId ?? null, folder: meta.folder ?? null, by: meta.by ?? null, name, mime, size: data.length, source: meta.source ?? null },
  });
  return info;
}

/** The request body as a new stored file. Returns its meta ({ id, name, mime, size, ... }). */
export async function storeUpload(req, cfg, { maxBytes = cfg.db.filesMaxBytes, meta = {}, checkType = false } = {}) {
  const data = Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.alloc(0);
  if (data.length > maxBytes) throw tooLarge(maxBytes);
  if (!data.length) throw new HttpError(400, 'validation_error', 'הקובץ ריק');
  const mime = safeMime(req.headers['content-type']);
  // from the public portal the type is a stranger's claim: the bytes must agree with it
  if (checkType && !looksLike(mime, data.subarray(0, 16))) throw new HttpError(415, 'type_mismatch', 'תוכן הקובץ לא תואם לסוג שלו. אפשר להעלות תמונה או PDF');
  return save(cfg, data, { name: safeFileName(req.headers['x-file-name']), mime, meta });
}

/** Saves bytes the function already holds (a photo from the lead form) as a stored file. */
export async function storeBuffer(cfg, data, { name, mime, meta = {} }) {
  if (data.length > cfg.db.filesMaxBytes) throw tooLarge(cfg.db.filesMaxBytes);
  return save(cfg, data, { name: safeFileName(name), mime: safeMime(mime), meta });
}

export async function readFileMeta(cfg, id) {
  if (!FILE_ID_RE.test(String(id ?? ''))) return null;
  return (await cfg.edge.rpc('sys_file', { p_id: id })) ?? null;
}

/** The bytes of a stored file (a copy to Drive, a file sent to Priority), or null. */
export async function readStoredFile(cfg, id) {
  const meta = await readFileMeta(cfg, id);
  if (!meta) return null;
  const res = await cfg.edge.sb.download(meta.path);
  return res ? Buffer.from(await res.arrayBuffer()) : null;
}

/** Streams a stored file with safe headers (no inline HTML/SVG, sandboxed). Returns null (response handled). */
export async function sendStoredFile(res, cfg, id, { download = false } = {}) {
  const meta = await readFileMeta(cfg, id);
  if (!meta) throw new HttpError(404, 'not_found', 'הקובץ לא נמצא');
  const upstream = await cfg.edge.sb.download(meta.path);
  if (!upstream?.body) throw new HttpError(404, 'not_found', 'הקובץ לא נמצא');
  const inline = !download && INLINE.test(meta.mime);
  const ascii = meta.name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  res.writeHead(200, {
    'content-type': inline ? meta.mime : meta.mime === 'text/html' || meta.mime.includes('svg') ? 'application/octet-stream' : meta.mime,
    'content-length': String(meta.size),
    'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
    'cache-control': 'private, max-age=3600',
  });
  await pipeline(Readable.fromWeb(upstream.body), res).catch(() => res.destroy());
  return null;
}

/** POST /api/files - raw body. Headers: content-type, x-file-name (URI-encoded), optional x-case-id, x-folder, x-drive-folder-id. */
export async function uploadFile({ req, cfg, caller }) {
  const user = caller.user;
  const v = await uploadsByUser.hit(user.id);
  if (!v.allowed) {
    const e = new HttpError(429, 'too_many_requests', 'יותר מדי העלאות בזמן קצר. אפשר לנסות שוב בעוד כמה דקות');
    e.retryAfter = Math.ceil(v.retryAfterMs / 1000);
    throw e;
  }
  // the case may not have reached the server yet (opened offline); the doc that files it is checked on write
  const caseId = String(req.headers['x-case-id'] ?? '').slice(0, 128) || undefined;
  const folder = String(req.headers['x-folder'] ?? '').slice(0, 40) || undefined;
  const meta = await storeUpload(req, cfg, { meta: { by: user.id, caseId, folder } });
  const out = { fileId: meta.id, name: meta.name, mime: meta.mime, size: meta.size };
  const driveFolder = String(req.headers['x-drive-folder-id'] ?? '');
  // only into a folder the system opened for a case (or the configured parent), never any folder by id
  if (driveFolder && googleFeatures(cfg).drive) {
    if (!knownDriveFolder(await getStore(cfg), cfg, driveFolder)) out.driveError = 'תיקיית Drive לא מוכרת';
    else {
      try {
        const d = await uploadBufferToDrive(cfg, { name: meta.name, mime: meta.mime, data: req.rawBody, folderId: driveFolder });
        out.driveFileId = d.id;
        out.webViewLink = d.webViewLink;
      } catch (err) {
        out.driveError = err?.message ?? 'Drive';
      }
    }
  }
  return { status: 201, body: out };
}

/** GET /api/files/:id[?download=1] */
export async function downloadFile({ res, cfg, params, url }) {
  return sendStoredFile(res, cfg, params.id, { download: url.searchParams.get('download') === '1' });
}
