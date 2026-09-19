import type { Env, Link } from './platform.js';
import { fail, nowSeconds } from './http.js';
const encode = (value: string): Uint8Array => new TextEncoder().encode(value);
const b64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function unb64(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid encoding.');
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)), c => c.charCodeAt(0));
}
export const PASSWORD_ITERATIONS = 100000;
export const UNLOCK_SECONDS = 900;
/** Pepper is independent of D1 and doubles as the session signing root with
 * separate purpose labels. Store the SAME random secret on both Workers. */
export function passwordsConfigured(env: Env): boolean {
  return typeof env.LINK_PASSWORD_SECRET === 'string' && /^[A-Za-z0-9_-]{43,128}$/.test(env.LINK_PASSWORD_SECRET);
}
function secret(env: Env): string {
  if (!passwordsConfigured(env)) fail(503, 'link_password_unconfigured', 'Configure the same LINK_PASSWORD_SECRET on both Workers before using link passwords.');
  return env.LINK_PASSWORD_SECRET!;
}
async function mac(env: Env, purpose: string, value: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encode(secret(env)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encode(`cf-links:${purpose}\0${value}`)));
}
export function validPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 12 && value.length <= 128 && !/[\u0000-\u001F\u007F]/.test(value) && encode(value).length <= 512;
}
async function derive(password: string, salt: Uint8Array, env: Env): Promise<Uint8Array> {
  const input = await mac(env, 'password-pepper-v1', password);
  const key = await crypto.subtle.importKey('raw', input, 'PBKDF2', false, ['deriveBits']);
  // Use 100,000 iterations for the historically constrained workerd API and
  // verify on the installed native runtime. Never downgrade on an error.
  // Independent secret pepper + >=12 characters are required.
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PASSWORD_ITERATIONS }, key, 256));
}
export async function hashLinkPassword(value: unknown, env: Env): Promise<string> {
  if (!validPassword(value)) fail(400, 'invalid_link_password', 'Link passwords must contain 12–128 characters without control characters.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `v1$pbkdf2-sha256$${PASSWORD_ITERATIONS}$${b64(salt)}$${b64(await derive(value, salt, env))}`;
}
export function validPasswordHash(value: unknown): value is string {
  return typeof value === 'string' && /^v1\$pbkdf2-sha256\$100000\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/.test(value);
}
function constantEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ (b[i] ?? 0);
  return diff === 0;
}
export async function verifyLinkPassword(value: unknown, stored: string, env: Env): Promise<boolean> {
  secret(env);
  if (!validPasswordHash(stored)) fail(503, 'invalid_password_record', 'Invalid stored link password.');
  if (!validPassword(value)) return false;
  const parts = stored.split('$');
  return constantEqual(await derive(value, unb64(parts[3]!), env), unb64(parts[4]!));
}
export function unlockCookieName(linkId: string, env: Env): string {
  return `${env.ENVIRONMENT === 'development' ? '' : '__Host-'}Linro_unlock_${linkId.replace(/-/g, '')}`;
}
export async function issueUnlockCookie(link: Link, host: string, env: Env): Promise<string> {
  const token = b64(encode(JSON.stringify({ id: link.id, host, revision: link.rule_revision, exp: nowSeconds() + UNLOCK_SECONDS })));
  const signature = b64(await mac(env, 'unlock-cookie-v1', token));
  return `${unlockCookieName(link.id, env)}=${token}.${signature}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${UNLOCK_SECONDS}${env.ENVIRONMENT === 'development' ? '' : '; Secure'}`;
}
export async function hasUnlockCookie(request: Request, link: Link, env: Env): Promise<boolean> {
  secret(env);
  const header = request.headers.get('cookie') ?? '';
  if (header.length > 16384) return false;
  const name = unlockCookieName(link.id, env);
  const values = header.split(';').map(s => s.trim()).filter(s => s.startsWith(name + '='));
  if (values.length !== 1) return false;
  const value = values[0]!.slice(name.length + 1);
  if (value.length > 1024) return false;
  try {
    const parts = value.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
    if (!constantEqual(await mac(env, 'unlock-cookie-v1', parts[0]), unb64(parts[1]))) return false;
    const claims: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(unb64(parts[0])));
    if (!claims || typeof claims !== 'object') return false;
    const c = claims as Record<string, unknown>;
    const now = nowSeconds();
    return c.id === link.id && c.host === new URL(request.url).host && c.revision === link.rule_revision &&
      typeof c.exp === 'number' && Number.isSafeInteger(c.exp) && c.exp > now && c.exp <= now + UNLOCK_SECONDS;
  } catch { return false; }
}
