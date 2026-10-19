// Local entry point: `node src/server.js` (PORT defaults to 8787).
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { handler } from './app.js';
import { flushAll } from './db/index.js';

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
  server.listen(port, host, () => console.log(`genair-server listening on http://localhost:${port}`));
  // Write the shared database before exiting; open SSE / long-poll connections are cut.
  const stop = async () => {
    server.close();
    server.closeAllConnections?.();
    await flushAll();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
