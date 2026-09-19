import type { Context, Env, Link } from './platform.js';
import { nowSeconds } from './http.js';
import { targetURL } from './validation.js';
import { canonicalHost } from './policy.js';
import { chooseGeoTarget, storedGeoRules } from './geo.js';

const PREFIX = 'cf-links:route:v1:';
const MAX_CACHE_BYTES = 80000;
const routeKeys = ['id', 'domain_id', 'hostname', 'slug', 'target_url', 'redirect_code', 'query_mode', 'enabled', 'expires_at', 'cache_ttl', 'version', 'rule_revision', 'geo_rules'] as const;
type Route = Pick<Link, typeof routeKeys[number]>;
interface Entry { schema: 1; until: number; rule: Route }
interface Guard {
  id: string; domain_id: string; hostname: string; version: number; rule_revision: number;
  enabled: number; domain_enabled: number; expires_at: number | null;
  password_hash: string | null; max_redirects: number | null; redirect_count: number;
  target_managed: number; response_mode: 'redirect' | 'text'; block_vpn: number;
}
export interface Lookup { link: Link | null; checkedTarget?: string; targetManaged?: boolean; cache: 'hit' | 'miss' | 'disabled' }
export function cacheKey(host: string, keyword: string): string { return `${PREFIX}${host.toLowerCase()}:${keyword}`; }
function ttl(env: Env): number {
  const value = Number(env.REDIRECT_CACHE_TTL ?? 300);
  return Number.isSafeInteger(value) && value >= 60 && value <= 86400 ? value : 300;
}
async function bounded<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error('KV timeout')), ms); })]); }
  finally { if (timer !== undefined) clearTimeout(timer); }
}
function cacheFailure(operation: string): void { console.warn(JSON.stringify({ event: 'redirect_cache_unavailable', operation })); }
async function background(task: Promise<void>, ctx?: Context): Promise<void> {
  if (ctx) { try { ctx.waitUntil(task); return; } catch { /* tests/teardown: finish safely */ } }
  await task;
}
/** No password hashes, secrets, counters, user metadata or response objects in KV. */
export async function putRouteCache(env: Env, link: Link, ctx?: Context): Promise<void> {
  if (!env.REDIRECT_CACHE || !link.hostname) return;
  const task = (async () => {
    try {
      const now = nowSeconds();
      if (link.response_mode === 'text' || !link.enabled || link.domain_enabled === 0 || (link.expires_at !== null && link.expires_at <= now)) {
        await bounded(env.REDIRECT_CACHE!.delete(cacheKey(link.hostname!, link.slug)), 1000); return;
      }
      const rule = Object.fromEntries(routeKeys.map(k => [k, link[k]])) as Route;
      const entry: Entry = { schema: 1, until: Math.min(now + ttl(env), link.expires_at ?? Infinity), rule };
      const value = JSON.stringify(entry);
      if (new TextEncoder().encode(value).length > MAX_CACHE_BYTES) return;
      await bounded(env.REDIRECT_CACHE!.put(cacheKey(link.hostname!, link.slug), value, { expirationTtl: ttl(env) }), 1000);
    } catch { cacheFailure('put'); }
  })();
  await background(task, ctx);
}
export async function evictRouteCache(env: Env, host: string | undefined, keyword: string, ctx?: Context): Promise<void> {
  if (!env.REDIRECT_CACHE || !host) return;
  await background((async () => { try { await bounded(env.REDIRECT_CACHE!.delete(cacheKey(host, keyword)), 1000); } catch { cacheFailure('delete'); } })(), ctx);
}
function entry(raw: string, host: string, keyword: string, now: number): Entry | null {
  if (raw.length > MAX_CACHE_BYTES) return null;
  try {
    const data = JSON.parse(raw) as Entry;
    if (data?.schema !== 1 || !Number.isSafeInteger(data.until) || data.until <= now || data.until > now + 86400) return null;
    const r = data.rule;
    if (!r || r.hostname !== host || r.slug !== keyword || typeof r.id !== 'string' || !/^[a-f0-9-]{36}$/.test(r.id) || typeof r.domain_id !== 'string') return null;
    if (!Number.isSafeInteger(r.rule_revision) || r.rule_revision < 1 || !Number.isSafeInteger(r.version) || r.version < 1) return null;
    if (![301, 302, 307, 308].includes(r.redirect_code) || !['discard', 'merge', 'replace'].includes(r.query_mode) || !Number.isSafeInteger(r.cache_ttl) || r.cache_ttl < 0 || r.cache_ttl > 3600) return null;
    targetURL(r.target_url); storedGeoRules(r.geo_rules);
    // Select explicitly: unknown/untrusted fields may never overwrite D1 guards.
    return { schema: 1, until: data.until, rule: Object.fromEntries(routeKeys.map(k => [k, r[k]])) as Route };
  } catch { return null; }
}
/** KV-first lookup with a mandatory fresh D1 guard on hits. A purely KV-only
 * path would allow a stale public entry to bypass a newly-set password/limit.
 * Hit: one compact SQL gate (also checks destination domain registration).
 * Miss/no binding: authoritative D1 row, then normal target-policy check.
 * Do not replace this gate with a cached flag, replica or Analytics Engine. */
export async function lookupRedirect(env: Env, host: string, keyword: string, request: Request, ctx?: Context): Promise<Lookup> {
  if (env.REDIRECT_CACHE) {
    let cached: Entry | null = null;
    try {
      const raw = await bounded(env.REDIRECT_CACHE.get(cacheKey(host, keyword), { type: 'text', cacheTtl: 60 }), 200);
      if (raw !== null) cached = entry(raw, host, keyword, nowSeconds());
    } catch { cacheFailure('get'); }
    if (cached) {
      const r = cached.rule;
      const selected = chooseGeoTarget(storedGeoRules(r.geo_rules), r.target_url, request);
      const guard = await env.DB.prepare(`SELECT l.id,l.domain_id,l.version,l.rule_revision,l.enabled,l.expires_at,
        l.password_hash,l.max_redirects,l.redirect_count,l.response_mode,l.block_vpn,d.hostname,d.enabled AS domain_enabled,
        EXISTS(SELECT 1 FROM domains WHERE hostname=?) AS target_managed
        FROM links l JOIN domains d ON d.id=l.domain_id WHERE d.hostname=? AND l.slug=? LIMIT 1`)
        .bind(canonicalHost(new URL(selected).hostname), host, keyword).first<Guard>();
      if (!guard || !guard.enabled || !guard.domain_enabled) return { link: null, cache: 'hit' };
      if (guard.response_mode === 'redirect' && guard.id === r.id && guard.domain_id === r.domain_id && guard.rule_revision === r.rule_revision && guard.version === r.version) {
        const link: Link = { ...r, text_content: '', title: '', description: '', created_by: null, created_at: 0, updated_at: 0, ...guard };
        return { link, cache: 'hit', checkedTarget: selected, targetManaged: !!guard.target_managed };
      }
    }
  }
  const link = await env.DB.prepare(`SELECT l.*,d.hostname,d.enabled AS domain_enabled FROM links l JOIN domains d ON d.id=l.domain_id
    WHERE d.hostname=? AND d.enabled=1 AND l.slug=? LIMIT 1`).bind(host, keyword).first<Link>();
  if (link) await putRouteCache(env, link, ctx);
  return { link, cache: env.REDIRECT_CACHE ? 'miss' : 'disabled' };
}
