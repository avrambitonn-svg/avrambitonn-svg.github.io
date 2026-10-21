// Supabase Edge Function "api": everything the Node server (genair/server) did besides the database.
// Deployed as one bundled file (dist/index.js, see ../build.mjs) with verify_jwt off: access is checked here.
// Routes are the server's (/api/...), see ../../CONTRACT.md "Edge Function api".
import { handle } from './src/router.js';

export { handle };
// the tests' fake Priority throws the same error class the engine recognizes
export { HttpError } from '../../../server/src/http.js';

declare const Deno: { serve?: (h: (r: Request) => Response | Promise<Response>) => unknown; env: { toObject(): Record<string, string> } } | undefined;
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

if (typeof Deno !== 'undefined' && typeof Deno.serve === 'function') {
  const waitUntil = typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil ? (p: Promise<unknown>) => EdgeRuntime.waitUntil(p) : undefined;
  Deno.serve((request: Request) => handle(request, Deno.env.toObject(), { waitUntil }));
}
