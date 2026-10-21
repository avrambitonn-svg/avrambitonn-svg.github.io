// Local entry point: `node src/server.js` (PORT defaults to 8787).
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { handler } from './app.js';
import { flushAll, getStore } from './db/index.js';
import { setupCode } from './auth.js';
import { loadConfig } from './config.js';
import { startPrioritySync, stopPrioritySync } from './psync/index.js';

// Load genair/server/.env if present (real environment variables win).
const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

// Node's global fetch ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY=1 (Node >= 22.21 / 24.5),
// and that flag is read only at startup. Behind a proxy, re-run ourselves with it set.
function needsProxyRespawn() {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  if (!proxy || process.env.NODE_USE_ENV_PROXY !== undefined) return false;
  const [major, minor] = process.versions.node.split('.').map(Number);
  return (major === 22 && minor >= 21) || (major === 24 && minor >= 5) || major >= 25;
}

/** What the person running the server needs to know at start: the setup code, and settings that leave the door open. */
async function announce(cfg) {
  if (cfg.db.mode !== 'off') {
    const store = await getStore(cfg);
    if (store?.isEmpty()) console.log(`[setup] המערכת עדיין לא הוקמה. קוד ההקמה (יידרש במסך ההקמה הראשונה): ${setupCode(store, cfg)}`);
    if (cfg.db.mode === 'file' && !cfg.db.authSecret) console.warn('[security] AUTH_SECRET לא הוגדר: סוד החתימה נשמר בתוך db.json. מומלץ להגדיר אותו במשתני הסביבה ולא להעתיק את הקובץ הזה הלאה.');
  } else if (!cfg.appToken) {
    console.warn('[security] DB_MODE=off בלי APP_TOKEN: נתיבי האינטגרציה סגורים לגמרי עד שמגדירים APP_TOKEN.');
  }
  if (cfg.allowedOrigins.includes('*')) console.warn('[security] ALLOWED_ORIGINS=* מאפשר לכל אתר לקרוא לשרת מהדפדפן. להגדיר את הדומיין של האפליקציה בלבד.');
  if (cfg.db.trustProxy && cfg.db.trustProxyHops < 1) console.warn('[security] TRUST_PROXY_HOPS לא תקין.');
}

if (needsProxyRespawn()) {
  const execArgv = process.execArgv.filter((a) => !a.startsWith('--watch'));
  const child = spawn(process.execPath, ['--disable-warning=UNDICI-EHPA', ...execArgv, ...process.argv.slice(1)], {
    stdio: 'inherit',
    env: { ...process.env, NODE_USE_ENV_PROXY: '1' },
  });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
} else {
  const port = Number(process.env.PORT) || 8787;
  const host = process.env.HOST || '0.0.0.0';
  const server = createServer((req, res) => {
    const started = Date.now();
    // Path only: query strings may contain customer names / phone numbers.
    res.on('finish', () => console.log(`${req.method} ${(req.url ?? '').split('?')[0]} ${res.statusCode} ${Date.now() - started}ms`));
    handler(req, res);
  });
  server.requestTimeout = 330_000; // AI calls may legitimately take minutes.
  server.keepAliveTimeout = 65_000; // longer than the load balancers in front (Render, Fly, nginx)
  server.listen(port, host, () => {
    console.log(`genair-server listening on http://localhost:${port}`);
    announce(loadConfig()).catch((e) => console.error('[startup] check failed:', e?.message ?? e));
    startPrioritySync(loadConfig()).catch((e) => console.error('[priority-sync] did not start:', e?.message ?? e));
  });
  // A promise nobody awaited must not take the whole server down; a real crash writes the database first and lets the
  // supervisor (Docker, systemd, Render) start a clean process.
  process.on('unhandledRejection', (reason) => console.error('[genair-server] unhandled rejection:', reason?.message ?? reason));
  process.on('uncaughtException', (err) => {
    console.error('[genair-server] uncaught exception:', err?.stack ?? err);
    Promise.race([flushAll(), new Promise((r) => setTimeout(r, 3000))]).finally(() => process.exit(1));
  });
  // Write the shared database before exiting; open SSE / long-poll connections are cut.
  const stop = async () => {
    server.close();
    server.closeAllConnections?.();
    await stopPrioritySync();
    await flushAll();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
