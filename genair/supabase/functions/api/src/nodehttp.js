// The server's modules speak Node's req / res. Here a Web Request becomes a small req (headers, method, url,
// the body already read into req.rawBody, which http.js readBody uses) and res is a Writable whose bytes
// become a streaming Response: JSON, file downloads and the AI proxy's server-sent events all go through it.
import { Writable } from 'node:stream';
import { HttpError, MAX_BODY_BYTES } from '../../../../server/src/http.js';

const NULL_BODY = new Set([101, 103, 204, 205, 304]);

const tooLarge = (limit) =>
  new HttpError(413, 'payload_too_large', `גוף הבקשה גדול מדי (מקסימום ${Math.round(limit / 1024 / 1024)}MB)`, { limitBytes: limit });

/** The caller's address: Supabase's edge sits behind Cloudflare, which sets cf-connecting-ip. */
export function remoteAddress(headers) {
  const cf = headers.get('cf-connecting-ip') || headers.get('x-real-ip');
  if (cf) return cf.trim();
  const list = String(headers.get('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return list[list.length - 1] ?? 'unknown';
}

export function nodeRequest(request, path) {
  const headers = {};
  for (const [k, v] of request.headers) headers[k] = v; // already lowercase
  return { method: request.method, url: path, headers, rawBody: Buffer.alloc(0), socket: { remoteAddress: remoteAddress(request.headers) } };
}

/** Reads the body (up to `limit` bytes) into a Buffer. */
export async function readRequestBody(request, limit = MAX_BODY_BYTES) {
  if (request.method === 'GET' || request.method === 'HEAD' || !request.body) return Buffer.alloc(0);
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) throw tooLarge(limit);
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      reader.cancel().catch(() => {});
      throw tooLarge(limit);
    }
    chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
  }
  return Buffer.concat(chunks, size);
}

export class EdgeResponse extends Writable {
  constructor() {
    super();
    this.statusCode = 200;
    this.headersSent = false;
    this.head = new Map();
    this.waiting = null;
    this.response = new Promise((resolve) => (this.resolveResponse = resolve));
    this.body = new ReadableStream(
      {
        start: (c) => (this.ctrl = c),
        pull: () => {
          const cb = this.waiting;
          this.waiting = null;
          cb?.();
        },
        cancel: () => this.destroy(), // the client went away
      },
      { highWaterMark: 4 },
    );
  }

  setHeader(name, value) {
    this.head.set(String(name).toLowerCase(), value);
    return this;
  }
  getHeader(name) {
    return this.head.get(String(name).toLowerCase());
  }
  hasHeader(name) {
    return this.head.has(String(name).toLowerCase());
  }
  removeHeader(name) {
    this.head.delete(String(name).toLowerCase());
  }

  writeHead(status, headers = {}) {
    if (this.headersSent) return this;
    this.statusCode = status;
    for (const [k, v] of Object.entries(headers)) if (v !== undefined) this.setHeader(k, v);
    this.headersSent = true;
    const h = new Headers();
    for (const [k, v] of this.head) h.set(k, Array.isArray(v) ? v.join(', ') : String(v));
    const empty = NULL_BODY.has(status);
    if (empty) {
      try {
        this.ctrl.close();
      } catch {
        /* closed */
      }
    }
    this.resolveResponse(new Response(empty ? null : this.body, { status, headers: h }));
    return this;
  }

  flushHeaders() {
    this.writeHead(this.statusCode);
  }

  _write(chunk, _enc, cb) {
    if (!this.headersSent) this.writeHead(this.statusCode);
    if (NULL_BODY.has(this.statusCode)) return cb();
    try {
      this.ctrl.enqueue(new Uint8Array(chunk));
    } catch (e) {
      return cb(e);
    }
    if (this.ctrl.desiredSize > 0) cb();
    else this.waiting = cb;
  }

  _final(cb) {
    if (!this.headersSent) this.writeHead(this.statusCode);
    try {
      this.ctrl.close();
    } catch {
      /* closed */
    }
    cb();
  }

  _destroy(err, cb) {
    if (!this.headersSent) {
      this.headersSent = true;
      this.resolveResponse(new Response(null, { status: 500 }));
    }
    try {
      this.ctrl.error(err ?? new Error('aborted'));
    } catch {
      /* closed */
    }
    const w = this.waiting;
    this.waiting = null;
    w?.();
    cb(err);
  }
}
