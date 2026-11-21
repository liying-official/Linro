import type { SharedEnv, Link, RedirectEnv } from './platform.js';
import {
  base64UrlDecode,
  base64UrlEncode,
  constantTimeEqual,
  encodeUTF8,
  makePurposeMac,
  validPurposeSecret,
} from './encoding.js';
import { fail, nowSeconds } from './http.js';
import { MAX_BROWSER_TOKEN_CHARS, MAX_COOKIE_HEADER_CHARS } from './limits.js';
import { sha256 } from './crypto.js';
import { requestASN } from './radar-asn.js';

export const BROWSER_CHECK_SECONDS = 120;
export const BROWSER_CHECK_MARKER = '_Linro_check';
export type VPNReason =
  | 'tor'
  | 'timezone_mismatch'
  | 'asn_category'
  | 'latency_mismatch'
  | 'asn_unavailable'
  | 'latency_unavailable'
  | 'match'
  | 'unknown';
export interface BrowserObservation {
  browserTimezone: string;
  ipTimezone: string;
  reason: VPNReason;
  suspected: boolean;
  tor: boolean;
  referrer?: string;
}
interface Claims {
  phase: 'challenge' | 'proof';
  id: string;
  host: string;
  revision: number;
  query: string;
  network: string;
  exp: number;
  nonce: string;
  referrer: string;
  timezone?: string;
  vpn?: true;
}
export function browserCollectionEnabled(env: SharedEnv): boolean {
  return env.BROWSER_TIMEZONE_ENABLED === 'true' && env.ANALYTICS_ENABLED === 'true';
}
// Only the Redirect Worker has a writer. Admin can report the configured flags.
export function collectsBrowserTimezone(env: RedirectEnv): boolean {
  return browserCollectionEnabled(env) && typeof env.ANALYTICS?.writeDataPoint === 'function';
}
export function browserChecksConfigured(env: SharedEnv): boolean {
  return validPurposeSecret(env.BROWSER_CHECK_SECRET);
}
async function mac(env: SharedEnv, purpose: string, value: string): Promise<Uint8Array> {
  if (!browserChecksConfigured(env))
    fail(
      503,
      'browser_check_unconfigured',
      'Configure BROWSER_CHECK_SECRET before enabling browser checks.',
    );
  return makePurposeMac(env.BROWSER_CHECK_SECRET!, purpose, value);
}
/** Canonicalize both values in the SAME runtime to avoid alias-only mismatches.
 * Compare zone identities, not today's UTC offset. Missing/invalid != a match.
 * Client reports are untrusted and this check is NOT VPN attestation. */
export function canonicalTimezone(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    value.length > 64 ||
    !/^[A-Za-z][A-Za-z0-9._+\-]*(?:\/[A-Za-z0-9._+\-]+){0,3}$/.test(value)
  )
    return null;
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}
export function isTorRequest(request: Request): boolean {
  // request.cf.country is Cloudflare-provided and has the same country value as
  // CF-IPCountry. T1 is its documented Tor code. Never trust a visitor header.
  return (request as Request & { cf?: { country?: unknown } }).cf?.country === 'T1';
}
export function observeBrowser(
  request: Request,
  browserTimezone?: unknown,
  referrer?: string,
): BrowserObservation {
  const cf = (request as Request & { cf?: { timezone?: unknown } }).cf;
  const ip = canonicalTimezone(cf?.timezone);
  const browser = canonicalTimezone(browserTimezone);
  const tor = isTorRequest(request);
  const reason: VPNReason = tor
    ? 'tor'
    : !ip || !browser
      ? 'unknown'
      : ip !== browser
        ? 'timezone_mismatch'
        : 'match';
  return {
    browserTimezone: browser ?? 'none',
    ipTimezone: ip ?? 'none',
    reason,
    suspected: reason === 'tor' || reason === 'timezone_mismatch',
    tor,
    ...(referrer === undefined ? {} : { referrer }),
  };
}
export function cleanBrowserURL(request: Request): URL {
  const url = new URL(request.url);
  url.searchParams.delete(BROWSER_CHECK_MARKER);
  return url;
}
function referrerHost(request: Request): string {
  try {
    return new URL(request.headers.get('referer') ?? '').hostname.slice(0, 253);
  } catch {
    return '';
  }
}
async function networkBinding(request: Request, env: SharedEnv, vpn: boolean): Promise<string> {
  const cf = (request as Request & { cf?: { country?: unknown; timezone?: unknown } }).cf;
  // Only a short-lived keyed digest is put in the client token. No raw IP, CF
  // timezone, UA fingerprint or expected answer is exposed in the challenge.
  const ip = request.headers.get('cf-connecting-ip') ?? '';
  if (!ip && env.ENVIRONMENT !== 'development')
    fail(503, 'browser_ip_unavailable', 'Browser check metadata is unavailable.');
  return base64UrlEncode(
    await mac(
      env,
      'browser-network-v1',
      JSON.stringify([
        ip,
        canonicalTimezone(cf?.timezone),
        typeof cf?.country === 'string' ? cf.country : null,
        ...(vpn ? [requestASN(request)] : []),
      ]),
    ),
  );
}
async function sign(claims: Claims, env: SharedEnv): Promise<string> {
  const token = base64UrlEncode(encodeUTF8(JSON.stringify(claims)));
  return `${token}.${base64UrlEncode(await mac(env, 'browser-token-v2', token))}`;
}
async function readToken(
  token: string,
  phase: Claims['phase'],
  request: Request,
  link: Link | undefined,
  env: SharedEnv,
): Promise<Claims | null> {
  if (token.length > MAX_BROWSER_TOKEN_CHARS) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    if (
      !constantTimeEqual(
        await mac(env, 'browser-token-v2', parts[0]),
        base64UrlDecode(parts[1], true),
      )
    )
      return null;
    const value: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(base64UrlDecode(parts[0], true)),
    );
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const c = value as Claims;
    const url = cleanBrowserURL(request);
    const now = nowSeconds();
    // Probes can validate a VPN challenge without a database round trip.
    // The form POST and the final request always supply the current D1 link.
    const requiresVPN = link ? !!link.block_vpn : true;
    if (
      c.phase !== phase ||
      requiresVPN !== (c.vpn === true) ||
      (link && (c.id !== link.id || c.revision !== link.rule_revision)) ||
      c.host !== url.host ||
      !Number.isSafeInteger(c.exp) ||
      c.exp <= now ||
      c.exp > now + BROWSER_CHECK_SECONDS ||
      typeof c.nonce !== 'string' ||
      !/^[A-Za-z0-9_-]{22}$/.test(c.nonce) ||
      typeof c.referrer !== 'string' ||
      c.referrer.length > 253 ||
      /[\s<>"']/.test(c.referrer) ||
      c.query !== (await sha256(url.search)) ||
      c.network !== (await networkBinding(request, env, c.vpn === true))
    )
      return null;
    if (phase === 'proof' && c.timezone !== 'none' && canonicalTimezone(c.timezone) === null)
      return null;
    if (phase === 'challenge' && c.timezone !== undefined) return null;
    return c;
  } catch {
    return null;
  }
}
export async function createBrowserChallenge(
  request: Request,
  link: Link,
  env: SharedEnv,
): Promise<string> {
  const url = cleanBrowserURL(request);
  return sign(
    {
      phase: 'challenge',
      id: link.id,
      host: url.host,
      revision: link.rule_revision,
      query: await sha256(url.search),
      network: await networkBinding(request, env, !!link.block_vpn),
      ...(link.block_vpn ? { vpn: true } : {}),
      exp: nowSeconds() + BROWSER_CHECK_SECONDS,
      nonce: base64UrlEncode(crypto.getRandomValues(new Uint8Array(16))),
      referrer: referrerHost(request),
    },
    env,
  );
}
export async function validateBrowserChallenge(
  token: string,
  request: Request,
  link: Link | undefined,
  env: SharedEnv,
): Promise<Claims | null> {
  return readToken(token, 'challenge', request, link, env);
}
export function browserCookieName(link: Link, env: SharedEnv): string {
  return `${env.ENVIRONMENT === 'development' ? '' : '__Host-'}Linro_browser_${link.id.replace(/-/g, '')}`;
}
function cookieAttributes(env: SharedEnv, seconds: number): string {
  return `; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${env.ENVIRONMENT === 'development' ? '' : '; Secure'}`;
}
export async function issueBrowserCookie(
  challenge: Claims,
  timezone: string,
  link: Link,
  env: SharedEnv,
): Promise<string> {
  // Do not extend the challenge's original validity; a replay cannot refresh it.
  return `${browserCookieName(link, env)}=${await sign({ ...challenge, phase: 'proof', timezone }, env)}${cookieAttributes(env, Math.max(0, challenge.exp - nowSeconds()))}`;
}
export function clearBrowserCookie(link: Link, env: SharedEnv): string {
  return `${browserCookieName(link, env)}=${cookieAttributes(env, 0)}`;
}
export async function readBrowserCookie(
  request: Request,
  link: Link,
  env: SharedEnv,
): Promise<BrowserObservation | null> {
  const markers = new URL(request.url).searchParams.getAll(BROWSER_CHECK_MARKER);
  if (markers.length !== 1 || markers[0] !== '1') return null;
  const header = request.headers.get('cookie') ?? '';
  if (header.length > MAX_COOKIE_HEADER_CHARS) return null;
  const name = browserCookieName(link, env) + '=';
  const values = header
    .split(';')
    .map((value) => value.trim())
    .filter((value) => value.startsWith(name));
  if (values.length !== 1) return null;
  const c = await readToken(values[0]!.slice(name.length), 'proof', request, link, env);
  return c ? observeBrowser(request, c.timezone, c.referrer) : null;
}
