import { fail } from './http.js';

type SigningJWK = JsonWebKey & { kid?: string };
interface KeyCache { until: number; fetchedAt: number; keys: SigningJWK[]; pending?: Promise<SigningJWK[]> }
const caches = new Map<string, KeyCache>();
export interface AccessClaims { type: string; common_name?: string; iss: string; sub: string; email?: string; aud: string | string[]; exp: number; iat: number; nbf?: number }
function objectPart(part: string): Record<string, unknown> {
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(decode64(part));
    const value: unknown = JSON.parse(decoded);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { return fail(401, 'invalid_access_token', 'Invalid Access token.'); }
}
function decode64(part: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(part) || part.length % 4 === 1) fail(401, 'invalid_access_token', 'Invalid Access token.');
  const s = atob(part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - part.length % 4) % 4));
  return Uint8Array.from(s, c => c.charCodeAt(0));
}
export function validateAccessConfig(issuer: string, audience: string): void {
  if (!/^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.cloudflareaccess\.com$/.test(issuer) || !/^[a-zA-Z0-9_-]{16,256}$/.test(audience)) fail(503, 'access_not_configured', 'Access issuer/audience is not configured.');
}
async function fetchKeys(issuer: string, fetcher: typeof fetch, force: boolean): Promise<SigningJWK[]> {
  const now = Date.now();
  let cache = caches.get(issuer);
  if (cache?.pending) return cache.pending;
  if (cache && ((!force && cache.until > now) || (force && now - cache.fetchedAt < 30000))) return cache.keys;
  if (!cache) { cache = { until: 0, fetchedAt: 0, keys: [] }; caches.set(issuer, cache); }
  const current = cache;
  current.pending = (async () => {
    try {
      // Issuer is deployment configuration, never taken from the untrusted JWT.
      // manual works in the target runtime; reject non-2xx rather than following
      // redirects. Never fetch keys from a redirected, untrusted destination.
      const result = await fetcher(`${issuer}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(5000), redirect: 'manual' });
      if (!result.ok || !result.body) throw new Error();
      const reader = result.body.getReader(); let bytes = 0; let body = '';
      const decoder = new TextDecoder();
      try {
        for (;;) {
          const p = await reader.read(); if (p.done) break;
          bytes += p.value.length; if (bytes > 65536) { await reader.cancel(); throw new Error(); }
          body += decoder.decode(p.value, { stream: true });
        }
        body += decoder.decode();
      } finally { reader.releaseLock(); }
      const data = JSON.parse(body) as { keys?: SigningJWK[] };
      if (!Array.isArray(data.keys)) throw new Error();
      const keys = data.keys.filter(k => k && k.kty === 'RSA' && (k.use === undefined || k.use === 'sig') && (k.alg === undefined || k.alg === 'RS256') && typeof k.kid === 'string' && typeof k.n === 'string' && typeof k.e === 'string');
      if (!keys.length || keys.length > 10) throw new Error();
      current.keys = keys; current.until = Date.now() + 5 * 60 * 1000; current.fetchedAt = Date.now();
      return keys;
    } catch { return fail(503, 'access_keys_unavailable', 'Access signing keys are unavailable. Retry later.'); }
    finally { current.pending = undefined; }
  })();
  return current.pending;
}
/** Restricted RS256 verifier: fixed issuer, fixed audience, remote configured JWKS,
 * signature + exp/iat/nbf/sub checks. It never accepts jku/x5u/jwk from the token.
 * Native Web Crypto performs RSA verification; see tests/access.test.mjs.
 */
export async function verifyAccess(token: string, issuer: string, audience: string, fetcher: typeof fetch = fetch): Promise<AccessClaims> {
  validateAccessConfig(issuer, audience);
  if (token.length > 16384) fail(401, 'invalid_access_token', 'Invalid Access token.');
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) fail(401, 'invalid_access_token', 'Invalid Access token.');
  const header = objectPart(parts[0]); const claims = objectPart(parts[1]);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.kid.length > 200 || header.crit !== undefined || header.jku !== undefined || header.jwk !== undefined || header.x5u !== undefined) fail(401, 'invalid_access_token', 'Invalid Access token.');
  const now = Math.floor(Date.now() / 1000);
  const aud = claims.aud;
  // Cloudflare service-token application JWTs have sub="" and common_name.
  // They may cross the Access gate, but authenticate() still requires a Linro
  // Bearer token and never bootstraps a user from a service identity.
  const service = claims.sub === '' && typeof claims.common_name === 'string' && claims.common_name.length > 0 && claims.common_name.length <= 256 && !claims.email;
  if (claims.type !== 'app' || claims.iss !== issuer || !(aud === audience || (Array.isArray(aud) && aud.every(a => typeof a === 'string') && aud.includes(audience))) ||
      typeof claims.sub !== 'string' || (!claims.sub && !service) || claims.sub.length > 512 ||
      typeof claims.exp !== 'number' || !Number.isSafeInteger(claims.exp) || claims.exp <= now ||
      typeof claims.iat !== 'number' || !Number.isSafeInteger(claims.iat) || claims.iat > now + 30 || claims.iat >= claims.exp ||
      (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || !Number.isSafeInteger(claims.nbf) || claims.nbf > now + 30))) fail(401, 'invalid_access_token', 'Access token is expired or has invalid claims.');
  let keys = await fetchKeys(issuer, fetcher, false);
  let jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) { keys = await fetchKeys(issuer, fetcher, true); jwk = keys.find(k => k.kid === header.kid); }
  if (!jwk) fail(401, 'invalid_access_token', 'Unknown Access signing key.');
  try {
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    if ((key.algorithm as RsaHashedKeyAlgorithm).modulusLength < 2048) throw new Error();
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decode64(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!valid) throw new Error();
  } catch { return fail(401, 'invalid_access_token', 'Invalid Access signature.'); }
  return claims as unknown as AccessClaims;
}
