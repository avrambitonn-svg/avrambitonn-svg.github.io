// Uploaded files: streamed to DATA_DIR/files/<id> (with <id>.json beside it), served back only to
// signed-in users (or through a portal link when the doc is visible to the customer), and copied
// into a Google Drive folder when the request names one and Drive is configured.
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { HttpError } from './http.js';
import { requireStore } from './db/index.js';
import { requireSession } from './auth.js';
import { googleFeatures, safeFileName, safeMime, uploadBufferToDrive } from './google.js';

const FILE_ID_RE = /^f[a-f0-9]{24}$/;
const INLINE = /^(image\/(png|jpe?g|gif|webp|avif|bmp|heic|heif)|application\/pdf|text\/plain|video\/[a-z0-9.+-]+|audio\/[a-z0-9.+-]+)$/;

export function filesDir(cfg) {
  return cfg.db.mode === 'file' ? resolve(cfg.db.dataDir, 'files') : join(tmpdir(), `genair-files-${process.pid}`);
}

const tooLarge = (limit) =>
  new HttpError(413, 'payload_too_large', `הקובץ גדול מדי (מקסימום ${Math.round(limit / 1024 / 1024)}MB)`, { limitBytes: limit });

/** Streams the request body into a new file. Returns its meta ({ id, name, mime, size, ... }). */
export async function storeUpload(req, cfg, { maxBytes = cfg.db.filesMaxBytes, meta = {} } = {}) {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge(maxBytes);
  const dir = filesDir(cfg);
  await mkdir(dir, { recursive: true });
  const id = `f${randomBytes(12).toString('hex')}`;
  const tmp = join(dir, `${id}.part`);
  let size = 0;
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      size += chunk.length;
      if (size > maxBytes) cb(tooLarge(maxBytes));
      else cb(null, chunk);
    },
  });
  try {
    if (Buffer.isBuffer(req.rawBody)) {
      if (req.rawBody.length > maxBytes) throw tooLarge(maxBytes);
      size = req.rawBody.length;
      await writeFile(tmp, req.rawBody);
    } else {
      await pipeline(req, counter, createWriteStream(tmp, { flags: 'wx' }));
    }
  } catch (err) {
    await rm(tmp, { force: true });
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, 'upload_failed', 'העלאת הקובץ נכשלה');
  }
  if (!size) {
    await rm(tmp, { force: true });
    throw new HttpError(400, 'validation_error', 'הקובץ ריק');
  }
  const info = {
    id,
    name: safeFileName(req.headers['x-file-name']),
    mime: safeMime(req.headers['content-type']),
    size,
    at: new Date().toISOString(),
    ...meta,
  };
  await writeFile(join(dir, `${id}.json`), JSON.stringify(info));
  await rename(tmp, join(dir, id));
  return info;
}

export async function readFileMeta(cfg, id) {
  if (!FILE_ID_RE.test(String(id ?? ''))) return null;
  try {
    return JSON.parse(await readFile(join(filesDir(cfg), `${id}.json`), 'utf8'));
  } catch {
    return null;
  }
}

/** Streams a stored file with safe headers (no inline HTML/SVG, sandboxed). Returns null (response handled). */
export async function sendStoredFile(res, cfg, id, { download = false } = {}) {
  const meta = await readFileMeta(cfg, id);
  if (!meta) throw new HttpError(404, 'not_found', 'הקובץ לא נמצא');
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
  await pipeline(createReadStream(join(filesDir(cfg), meta.id)), res).catch(() => res.destroy());
  return null;
}

/** POST /api/files - raw body. Headers: content-type, x-file-name (URI-encoded), optional x-case-id, x-folder, x-drive-folder-id. */
export async function uploadFile({ req, res, cfg }) {
  const store = await requireStore(cfg);
  const s = requireSession(req, res, store, cfg);
  const caseId = String(req.headers['x-case-id'] ?? '').slice(0, 128) || undefined;
  const folder = String(req.headers['x-folder'] ?? '').slice(0, 40) || undefined;
  const meta = await storeUpload(req, cfg, { meta: { by: s.user.id, caseId, folder } });
  const out = { fileId: meta.id, name: meta.name, mime: meta.mime, size: meta.size };
  const driveFolder = String(req.headers['x-drive-folder-id'] ?? '');
  if (driveFolder && googleFeatures(cfg).drive) {
    try {
      const data = await readFile(join(filesDir(cfg), meta.id));
      const d = await uploadBufferToDrive(cfg, { name: meta.name, mime: meta.mime, data, folderId: driveFolder });
      out.driveFileId = d.id;
      out.webViewLink = d.webViewLink;
    } catch (err) {
      out.driveError = err?.message ?? 'Drive';
    }
  }
  return { status: 201, body: out };
}

/** GET /api/files/:id[?download=1] */
export async function downloadFile({ req, res, cfg, params, url }) {
  const store = await requireStore(cfg);
  requireSession(req, res, store, cfg);
  return sendStoredFile(res, cfg, params.id, { download: url.searchParams.get('download') === '1' });
}
