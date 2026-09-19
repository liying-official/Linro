import type { Env, Principal, Role, User, Link } from '../../../../packages/shared/src/platform.js';
import { fail, nowSeconds } from '../../../../packages/shared/src/http.js';
import { email } from '../../../../packages/shared/src/validation.js';
import { verifyAccess } from '../../../../packages/shared/src/access.js';
import { equalSecret, sha256 } from '../../../../packages/shared/src/crypto.js';

export const ROLE_SCOPES: Record<Role, string[]> = {
  viewer: ['links:read', 'domains:read', 'analytics:read'],
  editor: ['links:read', 'domains:read', 'analytics:read', 'links:write', 'links:delete'],
  admin: ['links:read', 'domains:read', 'analytics:read', 'links:write', 'links:delete', 'domains:write', 'audit:read'],
  owner: ['links:read', 'domains:read', 'analytics:read', 'links:write', 'links:delete', 'domains:write', 'audit:read', 'users:write', 'settings:write'],
};
// Deliberately no administrative scopes in application tokens.
export const TOKEN_SCOPES = ['links:read', 'links:write', 'links:delete', 'domains:read', 'analytics:read'];
export function localMode(request: Request, env: Env): boolean {
  const u = new URL(request.url);
  return env.ENVIRONMENT === 'development' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) && u.origin === env.ADMIN_ORIGIN;
}
export function checkAdminHost(request: Request, env: Env): void {
  if (!env.ADMIN_ORIGIN || new URL(request.url).origin !== env.ADMIN_ORIGIN) fail(421, 'wrong_host', 'Unknown administration origin.');
  if (env.ENVIRONMENT !== 'development' && new URL(request.url).protocol !== 'https:') fail(400, 'https_required', 'HTTPS is required.');
}
async function resolveUser(env: Env, claimedEmail: string, sub: string): Promise<User> {
  const e = email(claimedEmail); const now = nowSeconds();
  let user = await env.DB.prepare('SELECT * FROM users WHERE email=?').bind(e).first<User>();
  if (!user && e === env.BOOTSTRAP_OWNER_EMAIL?.toLowerCase()) {
    const id = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO users(id,email,display_name,role,enabled,access_sub,created_at,updated_at)
        SELECT ?,?,?,'owner',1,?,?,? WHERE NOT EXISTS(SELECT 1 FROM users)`).bind(id, e, e.split('@')[0] ?? e, sub, now, now),
      env.DB.prepare(`INSERT INTO audit_logs(id,user_id,actor_email,action,resource_type,resource_id,details,request_id,created_at)
        SELECT ?,?,?,'bootstrap_owner','user',?,'{}','bootstrap',? WHERE changes()=1`).bind(crypto.randomUUID(), id, e, id, now),
    ]);
    user = await env.DB.prepare('SELECT * FROM users WHERE email=?').bind(e).first<User>();
  }
  if (!user || !user.enabled || (user.access_sub && user.access_sub !== sub)) fail(403, 'user_not_allowed', 'This identity is not an enabled Linro user.');
  if (!user.access_sub) {
    await env.DB.prepare('UPDATE users SET access_sub=? WHERE id=? AND access_sub IS NULL').bind(sub, user.id).run();
    user = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(user.id).first<User>();
    if (!user || !user.enabled || user.access_sub !== sub) fail(403, 'user_not_allowed', 'Identity binding failed.');
  }
  return user;
}
export async function authenticate(request: Request, env: Env): Promise<Principal> {
  const authorization = request.headers.get('authorization');
  const isLocal = localMode(request, env);
  let accessClaims: Awaited<ReturnType<typeof verifyAccess>> | undefined;
  if (!isLocal) {
    const assertion = request.headers.get('Cf-Access-Jwt-Assertion');
    if (!assertion) fail(401, 'access_required', 'Sign in through Cloudflare Access.');
    accessClaims = await verifyAccess(assertion, env.ACCESS_ISSUER, env.ACCESS_AUD);
  }
  if (authorization !== null) {
    const match = /^Bearer (Linro_[A-Za-z0-9_-]{43})$/.exec(authorization);
    if (!match?.[1]) fail(401, 'invalid_token', 'Invalid API token.');
    const row = await env.DB.prepare(`SELECT t.id AS token_id,t.scopes,t.expires_at,t.revoked_at,u.*
      FROM api_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=?`).bind(await sha256(match[1])).first<User & { token_id: string; scopes: string; expires_at: number; revoked_at: number | null }>();
    if (!row || !row.enabled || row.revoked_at !== null || row.expires_at <= nowSeconds()) fail(401, 'invalid_token', 'API token is expired or revoked.');
    let scopes: unknown; try { scopes = JSON.parse(row.scopes); } catch { fail(401, 'invalid_token', 'Invalid API token.'); }
    if (!Array.isArray(scopes)) fail(401, 'invalid_token', 'Invalid API token.');
    const allowed = scopes.filter((s): s is string => typeof s === 'string' && TOKEN_SCOPES.includes(s) && ROLE_SCOPES[row.role].includes(s));
    return { user: row, kind: 'token', token_id: row.token_id, scopes: allowed };
  }
  if (isLocal) {
    const token = request.headers.get('X-Linro-Dev') ?? '';
    if (!env.LOCAL_DEV_TOKEN || env.LOCAL_DEV_TOKEN.length < 32 || token.length > 256 || !await equalSecret(token, env.LOCAL_DEV_TOKEN)) fail(401, 'local_token_required', 'Enter the local development token printed by local:init.');
    const user = await resolveUser(env, env.BOOTSTRAP_OWNER_EMAIL, 'cf-links-local-owner');
    return { user, kind: 'local', scopes: ROLE_SCOPES[user.role] };
  }
  if (!accessClaims?.email || !accessClaims.sub) fail(403, 'human_identity_required', 'Service identities must also supply a Linro API token.');
  const user = await resolveUser(env, accessClaims.email, accessClaims.sub);
  return { user, kind: 'access', scopes: ROLE_SCOPES[user.role] };
}
export function requireScope(principal: Principal, scope: string): void {
  if (!principal.scopes.includes(scope)) fail(403, 'forbidden', 'Your role or token scope does not allow this operation.');
}
export function requireBrowser(principal: Principal): void {
  if (principal.kind === 'token') fail(403, 'interactive_only', 'This operation requires an interactive Access session.');
}
export function checkCSRF(request: Request, principal: Principal, env: Env): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
  if (principal.kind !== 'access') return; // Explicit bearer/development secrets are not ambient cookies.
  if (request.headers.get('Origin') !== env.ADMIN_ORIGIN || request.headers.get('X-Linro-CSRF') !== '1' || request.headers.get('Sec-Fetch-Site') === 'cross-site') fail(403, 'csrf', 'Cross-origin mutation rejected.');
}

/** Team reads remain shared. Interactive Owner/Admin sessions may administer all
 * links. Editors and EVERY application token are constrained to their user ID.
 * This is user ownership, not per-token isolation: use a dedicated CI account. */
export function linkWriteScope(p: Principal): 'owned' | 'workspace' {
  return p.kind !== 'token' && (p.user.role === 'owner' || p.user.role === 'admin') ? 'workspace' : 'owned';
}
export function canMutateLink(p: Principal, link: Pick<Link, 'created_by'>): boolean {
  return linkWriteScope(p) === 'workspace' || link.created_by === p.user.id;
}
export function requireLinkOwner(p: Principal, link: Pick<Link, 'created_by'>): void {
  if (!canMutateLink(p, link)) fail(403, 'link_owner_required', 'Editors and application tokens may modify only links created by their own user.');
}
