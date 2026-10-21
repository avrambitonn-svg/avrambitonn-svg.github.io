// Who is calling: a Supabase access token (Authorization: Bearer ...) of a member of the organization.
// The token is checked by Supabase Auth itself and the member is looked up with sys_member_by_auth;
// a deactivated user or one with no membership is 'revoked' (the app wipes the device's copy, as before).
import { HttpError } from '../../../../server/src/http.js';

export function bearer(req) {
  const h = String(req.headers.authorization ?? '');
  return h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : '';
}

/** The token's claims without checking them (only to tell a user's token from the project's anon key). */
function peekClaims(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

const unauthorized = (reason) =>
  new HttpError(401, 'unauthorized', reason === 'expired' ? 'פג תוקף ההתחברות, צריך להתחבר שוב' : 'צריך להתחבר למערכת', { reason });

async function resolve(cfg, req) {
  const token = bearer(req);
  // no token, or the publishable / anon key that supabase-js sends when nobody is signed in
  const claims = token && token.split('.').length === 3 ? peekClaims(token) : null;
  if (!token || (claims && !claims.sub) || /^sb_(publishable|secret)_/.test(token)) throw unauthorized('missing');
  const user = await cfg.edge.sb.getUser(token);
  if (!user) throw unauthorized('expired');
  const m = await cfg.edge.rpc('sys_member_by_auth', { p_auth_id: user.id });
  if (!m?.user) throw unauthorized('revoked');
  return { user: m.user, authId: user.id, mustChange: Boolean(m.mustChange) };
}

/** The signed-in member ({ user, authId, mustChange }) or a 401. Looked up once per request. */
export async function requireMember(cfg, req) {
  cfg.edge.member ??= resolve(cfg, req);
  const caller = await cfg.edge.member;
  cfg.edge.authId = caller.authId;
  return caller;
}

/** The member, or null for anyone else (health shows more to members). */
export async function optionalMember(cfg, req) {
  if (!bearer(req)) return null;
  try {
    return await requireMember(cfg, req);
  } catch {
    return null;
  }
}

export const isManager = (user) => user?.role === 'admin' || user?.role === 'office';
