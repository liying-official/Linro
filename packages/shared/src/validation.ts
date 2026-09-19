import { fail, text, integer } from './http.js';
import type { Link } from './platform.js';
import { DEFAULT_QUERY_KEYS, sensitiveQueryKey, sensitiveTarget } from './policy.js';
export const RESERVED = new Set(['admin', 'api', 'linro', 'health', 'assets', 'robots', 'favicon', 'cdn-cgi', '.well-known']);
export function slug(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value) || RESERVED.has(value.toLowerCase()) || value.toLowerCase().startsWith('__linro_')) fail(400, 'invalid_slug', 'Slug must contain 1–64 ASCII letters, digits, _ or -, and must not be reserved.');
  return value;
}
export function randomSlug(length = 8): string {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  let value = '';
  while (value.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    // Rejection sampling removes modulo bias (248 is divisible by 62).
    for (const b of bytes) { if (b < 248) value += alphabet[b % 62]; if (value.length === length) return value; }
  }
  return value;
}
export function hostname(value: unknown, local = false): string {
  const s = text(value, 'hostname', 253).toLowerCase();
  if (local && (s === 'localhost' || s === '127.0.0.1')) return s;
  if (s.endsWith('.') || s !== s.trim() || !s.includes('.') || /^\d+(\.\d+){3}$/.test(s)) fail(400, 'invalid_hostname', 'Use a DNS hostname without scheme, path, port or trailing dot.');
  if (s.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) fail(400, 'invalid_hostname', 'Use a valid ASCII/punycode DNS hostname.');
  return s;
}
export function targetURL(value: unknown): string {
  const raw = text(value, 'target_url', 4096);
  if (!raw || raw !== raw.trim() || /[\u0000-\u0020\u007F\\]/.test(raw) || /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(raw)) fail(400, 'invalid_url', 'URL contains whitespace, controls or backslashes.');
  let url: URL; try { url = new URL(raw); } catch { return fail(400, 'invalid_url', 'Enter an absolute HTTP(S) URL.'); }
  if (!/^https?:\/\//i.test(raw) || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname) fail(400, 'invalid_url', 'Only absolute HTTP(S) URLs without credentials are allowed.');
  return url.href;
}
export function redirectCode(value: unknown): number {
  if (typeof value !== 'number' || ![301, 302, 307, 308].includes(value)) fail(400, 'invalid_code', 'Supported redirect codes: 301, 302, 307, 308.');
  return value;
}
export function queryMode(value: unknown): Link['query_mode'] {
  if (value !== 'discard' && value !== 'replace' && value !== 'merge') fail(400, 'invalid_query_mode', 'Use discard, replace or merge.');
  return value;
}
export function expiration(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return integer(value, 'expires_at (Unix seconds)', 1, 253402300799);
}
/** Forward only explicitly reviewed keys. Sensitive legacy destinations safely
 * behave as discard without rewriting stored records. Non-sensitive replace
 * retains its documented semantics, including clearing absent query params. */
export function buildTarget(stored: string, incoming: URL, mode: Link['query_mode'], allowedKeys: readonly string[] = DEFAULT_QUERY_KEYS): string {
  if (mode === 'discard' || sensitiveTarget(stored)) return stored;
  const target = new URL(stored);
  const allowed = new Set(allowedKeys);
  const filtered = new URLSearchParams();
  for (const [key, value] of incoming.searchParams) {
    if (allowed.has(key) && !sensitiveQueryKey(key) && !/[\u0000-\u001F\u007F]/.test(value)) filtered.append(key, value);
  }
  if (mode === 'replace') target.search = filtered.toString();
  else {
    const fixed = new Set(target.searchParams.keys());
    for (const [key, value] of filtered) if (!fixed.has(key)) target.searchParams.append(key, value);
  }
  if (target.href.length > 8192) fail(414, 'uri_too_long', 'Resulting redirect URL is too long.');
  return target.href;
}
export function cacheControl(ttl: number, expiresAt: number | null, now: number): string {
  const seconds = Math.max(0, Math.min(ttl, expiresAt === null ? ttl : expiresAt - now));
  return seconds > 0 ? `private, max-age=${seconds}, must-revalidate` : 'no-store, max-age=0';
}
export function email(value: unknown): string {
  const e = text(value, 'email', 254).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) fail(400, 'invalid_email', 'Invalid email address.');
  return e;
}
export function safeAuditURL(value: string): string {
  try { const u = new URL(value); return `${u.origin}${u.pathname}${u.search ? '?[redacted]' : ''}${u.hash ? '#[redacted]' : ''}`; } catch { return '[invalid URL]'; }
}
