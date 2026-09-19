import type { Env, Link } from './platform.js';
import { fail } from './http.js';

export const DEFAULT_QUERY_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
export interface SecurityPolicy {
  queryKeys: string[];
  privateTargets: string[];
  expiredStatus: 404 | 410;
}
// Fold punctuation/case so redirect_uri, redirect-uri and redirectURI agree.
export function sensitiveQueryKey(key: string): boolean {
  const folded = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return /(?:token|password|passwd|secret|credential|session|redirect|return|callback|continue|nonce|assertion)/.test(folded) ||
    ['next', 'url', 'uri', 'dest', 'destination', 'goto', 'code', 'state', 'clientid', 'responsetype', 'scope', 'auth', 'authorization', 'samlrequest', 'samlresponse', 'relaystate'].includes(folded);
}
export function canonicalHost(host: string): string { return host.toLowerCase().replace(/\.$/, ''); }
export function validPolicyHost(value: string): boolean {
  try {
    const parsed = new URL(`http://${value}/`);
    const host = canonicalHost(parsed.hostname);
    return value === host && !parsed.port && !parsed.username && !parsed.password && parsed.pathname === '/' && !parsed.search && !parsed.hash &&
      (host.startsWith('[') || host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)));
  } catch { return false; }
}
function list(raw: string | undefined, fallback: string[], name: string): string[] {
  if (raw === undefined) return [...fallback];
  try {
    if (raw.length > 4096) throw new Error();
    const values: unknown = JSON.parse(raw);
    if (!Array.isArray(values) || values.length > 32 || values.some(v => typeof v !== 'string') || new Set(values).size !== values.length) throw new Error();
    return values as string[];
  } catch { return fail(503, 'security_policy_invalid', `Invalid ${name} deployment policy.`); }
}
export function securityPolicy(env: Env): SecurityPolicy {
  const queryKeys = list(env.QUERY_FORWARD_ALLOWLIST, DEFAULT_QUERY_KEYS, 'QUERY_FORWARD_ALLOWLIST');
  if (queryKeys.some(k => !/^[a-z][a-z0-9_]{0,63}$/.test(k) || sensitiveQueryKey(k))) fail(503, 'security_policy_invalid', 'Invalid query forwarding allowlist. Sensitive keys are never permitted.');
  const privateTargets = list(env.PRIVATE_TARGET_ALLOWLIST, [], 'PRIVATE_TARGET_ALLOWLIST');
  if (privateTargets.some(h => !validPolicyHost(h))) fail(503, 'security_policy_invalid', 'Private target exceptions must be exact canonical hostnames or IP literals.');
  const expired = env.EXPIRED_LINK_STATUS ?? '404';
  if (expired !== '404' && expired !== '410') fail(503, 'security_policy_invalid', 'EXPIRED_LINK_STATUS must be 404 or 410.');
  return { queryKeys, privateTargets, expiredStatus: expired === '410' ? 410 : 404 };
}
/** Literal/local-name protection, NOT DNS resolution or a guarantee that a public
 * hostname cannot resolve to a private IP. Never fetch a user-provided target. */
export function isPrivateTarget(hostname: string): boolean {
  const host = canonicalHost(hostname);
  if (host.startsWith('[')) {
    // URL canonicalization expands IPv4-mapped syntax into hextets. Restrict to
    // global-unicast space and exclude transition/documentation ranges.
    const parts = host.slice(1, -1).split(':');
    const first = Number.parseInt(parts[0] ?? '', 16);
    const second = Number.parseInt(parts[1] || '0', 16);
    return !(first >= 0x2000 && first <= 0x3fff) || first === 0x2002 ||
      (first === 0x2001 && (second === 0 || second === 0xdb8));
  }
  if (/^\d+(?:\.\d+){3}$/.test(host)) {
    const [a = 0, b = 0, c = 0] = host.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 192 && b === 88 && c === 99) ||
      (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113);
  }
  return !host.includes('.') || /(?:^|\.)(?:localhost|local|localdomain|internal|lan|home|test|invalid|onion)$/.test(host) || host.endsWith('.home.arpa') || host === 'home.arpa';
}
/** A conservative extra guard, not a complete classifier of all login URLs.
 * The allowlist is the primary boundary; use discard for any sensitive target. */
export function sensitiveTarget(target: string): boolean {
  const url = new URL(target);
  let path = url.pathname;
  try { path = decodeURIComponent(path); } catch { return true; }
  if (/(?:^|[\/._-])(?:auth|authorize|authorization|oauth2?|login|logon|signin|signout|logout|sso|callback|reset|password|token)(?:$|[\/._-])/i.test(path)) return true;
  if ([...url.searchParams.keys()].some(sensitiveQueryKey)) return true;
  // Includes SPA hash routes and fragment-carried OAuth response fields.
  const fragment = url.hash.slice(1);
  if (fragment && (/(?:auth|oauth|login|signin|callback|reset|password)/i.test(fragment) ||
      [...new URLSearchParams(fragment.replace(/^.*\?/, '')).keys()].some(sensitiveQueryKey))) return true;
  return false;
}
export function checkQueryPolicy(target: string, mode: Link['query_mode']): void {
  if (mode !== 'discard' && sensitiveTarget(target)) fail(400, 'unsafe_query_mode', 'Authentication, reset, token and redirect-parameter destinations must use discard.');
}
