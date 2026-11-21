import type { SharedEnv, Link } from './platform.js';
import {
  base64UrlDecode,
  base64UrlEncode,
  constantTimeEqual,
  encodeUTF8,
  makePurposeMac,
  validPurposeSecret,
} from './encoding.js';
import { fail, nowSeconds } from './http.js';
import { MAX_COOKIE_HEADER_CHARS } from './limits.js';
export const PASSWORD_ITERATIONS = 100000;
export const UNLOCK_SECONDS = 900;
/** Pepper is independent of D1 and doubles as the session signing root with
 * separate purpose labels. Store the SAME random secret on both Workers. */
export function passwordsConfigured(env: SharedEnv): boolean {
  return validPurposeSecret(env.LINK_PASSWORD_SECRET);
}
function secret(env: SharedEnv): string {
  if (!passwordsConfigured(env))
    fail(
      503,
      'link_password_unconfigured',
      'Configure the same LINK_PASSWORD_SECRET on both Workers before using link passwords.',
    );
  return env.LINK_PASSWORD_SECRET!;
}
async function mac(env: SharedEnv, purpose: string, value: string): Promise<Uint8Array> {
  return makePurposeMac(secret(env), purpose, value);
}
export function validPassword(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 12 &&
    value.length <= 128 &&
    !/[\u0000-\u001F\u007F]/.test(value) &&
    encodeUTF8(value).length <= 512
  );
}
async function derive(password: string, salt: Uint8Array, env: SharedEnv): Promise<Uint8Array> {
  const input = await mac(env, 'password-pepper-v1', password);
  const key = await crypto.subtle.importKey('raw', input, 'PBKDF2', false, ['deriveBits']);
  // Use 100,000 iterations for the historically constrained workerd API and
  // verify on the installed native runtime. Never downgrade on an error.
  // Independent secret pepper + >=12 characters are required.
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PASSWORD_ITERATIONS },
      key,
      256,
    ),
  );
}
export async function hashLinkPassword(value: unknown, env: SharedEnv): Promise<string> {
  if (!validPassword(value))
    fail(
      400,
      'invalid_link_password',
      'Link passwords must contain 12–128 characters without control characters.',
    );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `v1$pbkdf2-sha256$${PASSWORD_ITERATIONS}$${base64UrlEncode(salt)}$${base64UrlEncode(await derive(value, salt, env))}`;
}
export function validPasswordHash(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^v1\$pbkdf2-sha256\$100000\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/.test(value)
  );
}
export async function verifyLinkPassword(
  value: unknown,
  stored: string,
  env: SharedEnv,
): Promise<boolean> {
  secret(env);
  if (!validPasswordHash(stored))
    fail(503, 'invalid_password_record', 'Invalid stored link password.');
  if (!validPassword(value)) return false;
  const parts = stored.split('$');
  return constantTimeEqual(
    await derive(value, base64UrlDecode(parts[3]!), env),
    base64UrlDecode(parts[4]!),
  );
}
export function unlockCookieName(linkId: string, env: SharedEnv): string {
  return `${env.ENVIRONMENT === 'development' ? '' : '__Host-'}Linro_unlock_${linkId.replace(/-/g, '')}`;
}
export async function issueUnlockCookie(link: Link, host: string, env: SharedEnv): Promise<string> {
  const token = base64UrlEncode(
    encodeUTF8(
      JSON.stringify({
        id: link.id,
        host,
        revision: link.rule_revision,
        exp: nowSeconds() + UNLOCK_SECONDS,
      }),
    ),
  );
  const signature = base64UrlEncode(await mac(env, 'unlock-cookie-v1', token));
  return `${unlockCookieName(link.id, env)}=${token}.${signature}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${UNLOCK_SECONDS}${env.ENVIRONMENT === 'development' ? '' : '; Secure'}`;
}
export async function hasUnlockCookie(
  request: Request,
  link: Link,
  env: SharedEnv,
): Promise<boolean> {
  secret(env);
  const header = request.headers.get('cookie') ?? '';
  if (header.length > MAX_COOKIE_HEADER_CHARS) return false;
  const name = unlockCookieName(link.id, env);
  const values = header
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.startsWith(name + '='));
  if (values.length !== 1) return false;
  const value = values[0]!.slice(name.length + 1);
  if (value.length > 1024) return false;
  try {
    const parts = value.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
    if (!constantTimeEqual(await mac(env, 'unlock-cookie-v1', parts[0]), base64UrlDecode(parts[1])))
      return false;
    const claims: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(base64UrlDecode(parts[0])),
    );
    if (!claims || typeof claims !== 'object') return false;
    const c = claims as Record<string, unknown>;
    const now = nowSeconds();
    return (
      c.id === link.id &&
      c.host === new URL(request.url).host &&
      c.revision === link.rule_revision &&
      typeof c.exp === 'number' &&
      Number.isSafeInteger(c.exp) &&
      c.exp > now &&
      c.exp <= now + UNLOCK_SECONDS
    );
  } catch {
    return false;
  }
}
