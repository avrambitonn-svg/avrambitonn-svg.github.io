// Storage adapters for the document store. Interface (kept small so Postgres can replace it):
//   load(): Promise<state | null>      - the whole state written by the last save, or null when empty
//   save(state, info?): Promise<void>  - persist the state; must be atomic (all or nothing)
// A database adapter would ignore the full state and upsert only the changed rows.
import { mkdir, open, readFile, readdir, rename, rm, copyFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

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
  constructor(dir, { keepBackups = 14 } = {}) {
    this.dir = resolve(dir);
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
    try {
      return JSON.parse(text);
    } catch {
      // Never start empty over an existing file: an empty store would accept a new bootstrap.
      throw new Error(`${this.file} is not valid JSON; restore it from ${join(this.dir, 'backups')} before starting`);
    }
  }

  async save(state) {
    await mkdir(this.dir, { recursive: true });
    await this.#backup();
    const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    const fh = await open(tmp, 'w');
    try {
      await fh.writeFile(JSON.stringify(state));
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
    await mkdir(dir, { recursive: true });
    await copyFile(this.file, join(dir, `db-${day}.json`));
    const old = (await readdir(dir)).filter((f) => /^db-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().slice(0, -this.keepBackups);
    await Promise.all(old.map((f) => rm(join(dir, f), { force: true })));
  }
}
