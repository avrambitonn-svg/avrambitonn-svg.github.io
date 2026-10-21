// Storage adapters for the document store. Interface (kept small so Postgres can replace it):
//   load(): Promise<state | null>      - the whole state written by the last save, or null when empty
//   save(state, info?): Promise<void>  - persist the state; must be atomic (all or nothing)
// A database adapter would ignore the full state and upsert only the changed rows.
import { mkdir, open, readFile, readdir, rename, rm, copyFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// With DB_ENCRYPTION_KEY the file (and so every daily backup copied from it) is AES-256-GCM encrypted: the
// password hashes, the token secret and the customers' details are not readable from a copied disk or backup.
const ENVELOPE = 'genair-encrypted-v1';
const keyOf = (secret) => createHash('sha256').update(String(secret), 'utf8').digest();

export function encryptState(text, secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyOf(secret), iv);
  const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return JSON.stringify({ format: ENVELOPE, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') });
}

export function decryptState(env, secret, file) {
  if (!secret) throw new Error(`${file} is encrypted; set DB_ENCRYPTION_KEY to the key it was written with`);
  try {
    const decipher = createDecipheriv('aes-256-gcm', keyOf(secret), Buffer.from(env.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(env.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(env.data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error(`${file} could not be decrypted: DB_ENCRYPTION_KEY is not the key it was written with`);
  }
}

export class MemoryAdapter {
  constructor(initial = null) {
    this.state = initial;
    this.saves = 0;
  }
  async load() {
    return this.state ? structuredClone(this.state) : null;
  }
  async save(state) {
    this.saves++;
    this.state = structuredClone(state);
  }
}

/** db.json under DATA_DIR, written to a temp file, fsynced and renamed over the old one. Daily copies in backups/. */
export class JsonFileAdapter {
  constructor(dir, { keepBackups = 14, encryptionKey = '' } = {}) {
    this.dir = resolve(dir);
    this.key = encryptionKey;
    this.file = join(this.dir, 'db.json');
    this.keepBackups = keepBackups;
    this.lastBackupDay = '';
  }

  async load() {
    let text;
    try {
      text = await readFile(this.file, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
    let state;
    try {
      state = JSON.parse(text);
    } catch {
      // Never start empty over an existing file: an empty store would accept a new bootstrap.
      throw new Error(`${this.file} is not valid JSON; restore it from ${join(this.dir, 'backups')} before starting`);
    }
    // a plain file is read as is and written encrypted from the next save on
    return state?.format === ENVELOPE ? JSON.parse(decryptState(state, this.key, this.file)) : state;
  }

  async save(state) {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await this.#backup();
    const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    const fh = await open(tmp, 'w', 0o600);
    try {
      const text = JSON.stringify(state);
      await fh.writeFile(this.key ? encryptState(text, this.key) : text);
      await fh.sync();
    } finally {
      await fh.close();
    }
    await rename(tmp, this.file);
  }

  async #backup() {
    const day = new Date().toISOString().slice(0, 10);
    if (day === this.lastBackupDay) return;
    this.lastBackupDay = day;
    try {
      await stat(this.file);
    } catch {
      return;
    }
    const dir = join(this.dir, 'backups');
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await copyFile(this.file, join(dir, `db-${day}.json`));
    const old = (await readdir(dir)).filter((f) => /^db-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().slice(0, -this.keepBackups);
    await Promise.all(old.map((f) => rm(join(dir, f), { force: true })));
  }
}
