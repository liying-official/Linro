import type { Context, SharedEnv, KVBinding, Link, RedirectEnv } from './platform.js';
import { nowSeconds } from './http.js';
import { targetURL } from './validation.js';
import { canonicalHost } from './policy.js';
import { storedGeoRules } from './geo.js';
import { browserCollectionEnabled, collectsBrowserTimezone } from './browser-check.js';
import { DEFAULT_REDIRECT_CACHE_TTL_SECONDS } from './limits.js';

const PREFIX = 'cf-links:route:v1:';
const MAX_CACHE_BYTES = 80000;
const MAX_WRITE_SLOTS = 1024;
const MAX_LOCAL_ENTRIES = 256;
const routeKeys = [
  'id',
  'domain_id',
  'hostname',
  'slug',
  'target_url',
  'redirect_code',
  'query_mode',
  'enabled',
  'expires_at',
  'cache_ttl',
  'kv_cache_ttl',
  'version',
  'rule_revision',
  'geo_rules',
] as const;
type Route = Pick<Link, (typeof routeKeys)[number]>;
interface Entry {
  schema: 2;
  at: number;
  until: number;
  ttl: number;
  rule: Route;
}
interface Guard {
  id: string;
  domain_id: string;
  hostname: string;
  slug: string;
  version: number;
  rule_revision: number;
  enabled: number;
  domain_enabled: number;
  expires_at: number | null;
  kv_cache_ttl: number | null;
  password_hash: string | null;
  max_redirects: number | null;
  redirect_count: number;
  geo_rules: string;
  checked_host: string | null;
  target_managed: number;
  response_mode: 'redirect' | 'text';
  block_vpn: number;
}
interface Probe
  extends Guard, Pick<Link, 'redirect_code' | 'query_mode' | 'cache_ttl' | 'text_content'> {
  target_url: string | null;
}
export interface Lookup {
  link: Link | null;
  checkedHost?: string;
  targetManaged?: boolean;
  cache: 'hit' | 'miss' | 'disabled';
}
export function cacheKey(host: string, keyword: string): string {
  return `${PREFIX}${host.toLowerCase()}:${keyword}`;
}
export function defaultRouteCacheTTL(env: SharedEnv): number {
  const value = Number(env.REDIRECT_CACHE_TTL ?? DEFAULT_REDIRECT_CACHE_TTL_SECONDS);
  return Number.isSafeInteger(value) && value >= 60 && value <= 86400
    ? value
    : DEFAULT_REDIRECT_CACHE_TTL_SECONDS;
}
export function routeCacheTTL(env: SharedEnv, link: Pick<Link, 'kv_cache_ttl'>): number {
  const value = link.kv_cache_ttl;
  if (value == null) return defaultRouteCacheTTL(env);
  return Number.isSafeInteger(value) && value >= 60 && value <= 86400 ? value : 0;
}
/** Eligibility is not authorization. Cached requests still get a fresh
 * post-KV D1 guard, including protection and target-registration state. */
export function cacheEligible(
  env: SharedEnv,
  link: Pick<
    Link,
    | 'enabled'
    | 'domain_enabled'
    | 'response_mode'
    | 'password_hash'
    | 'max_redirects'
    | 'block_vpn'
    | 'geo_rules'
    | 'expires_at'
    | 'kv_cache_ttl'
  >,
  collectingTimezone = browserCollectionEnabled(env),
): boolean {
  return (
    !!env.REDIRECT_CACHE &&
    !collectingTimezone &&
    link.enabled === 1 &&
    link.domain_enabled !== 0 &&
    link.response_mode === 'redirect' &&
    link.password_hash === null &&
    link.max_redirects === null &&
    link.block_vpn === 0 &&
    link.geo_rules === '[]' &&
    link.expires_at === null &&
    routeCacheTTL(env, link) > 0
  );
}
async function bounded<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('KV timeout')), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
function cacheFailure(operation: string): void {
  console.warn(JSON.stringify({ event: 'redirect_cache_unavailable', operation }));
}
async function background(task: Promise<void>, ctx?: Context): Promise<void> {
  if (ctx) {
    try {
      ctx.waitUntil(task);
      return;
    } catch {
      /* tests/teardown: finish safely */
    }
  }
  await task;
}
// Bounded, per-binding/per-isolate suppression, not a distributed lock or daily
// quota guarantee. Failed attempts cool down too, preventing a put per request.
const writeSlots = new WeakMap<KVBinding, Map<string, { fingerprint: string; until: number }>>();
function slots(kv: KVBinding) {
  let result = writeSlots.get(kv);
  if (!result) {
    result = new Map();
    writeSlots.set(kv, result);
  }
  return result;
}
/** No passwords, secrets, counters, user metadata or response bodies in KV. */
export async function putRouteCache(
  env: SharedEnv,
  link: Link,
  ctx?: Context,
  collectingTimezone = browserCollectionEnabled(env),
): Promise<void> {
  if (!cacheEligible(env, link, collectingTimezone) || !link.hostname || !env.REDIRECT_CACHE)
    return;
  const kv = env.REDIRECT_CACHE,
    key = cacheKey(link.hostname, link.slug),
    ttl = routeCacheTTL(env, link),
    now = nowSeconds();
  const rule = Object.fromEntries(routeKeys.map((k) => [k, link[k]])) as Route;
  const value = JSON.stringify({ schema: 2, at: now, until: now + ttl, ttl, rule } satisfies Entry);
  if (new TextEncoder().encode(value).length > MAX_CACHE_BYTES) return;
  const fingerprint = `${link.id}:${link.version}:${link.rule_revision}:${ttl}`;
  const state = slots(kv),
    previous = state.get(key);
  if (previous?.fingerprint === fingerprint && previous.until > now) return;
  for (const [name, slot] of state) if (slot.until <= now) state.delete(name);
  if (state.size >= MAX_WRITE_SLOTS && !state.has(key)) state.delete(state.keys().next().value!);
  state.set(key, { fingerprint, until: now + ttl });
  await background(
    (async () => {
      try {
        await bounded(kv.put(key, value, { expirationTtl: ttl }), 1000);
      } catch {
        cacheFailure('put');
      }
    })(),
    ctx,
  );
}
export async function evictRouteCache(
  env: SharedEnv,
  host: string | undefined,
  keyword: string,
  ctx?: Context,
  previous?: Link,
): Promise<void> {
  if (!env.REDIRECT_CACHE || !host) return;
  const key = cacheKey(host, keyword);
  slots(env.REDIRECT_CACHE).delete(key);
  localEntries.get(env.REDIRECT_CACHE)?.delete(key);
  if (previous && !cacheEligible(env, previous)) return;
  await background(
    (async () => {
      try {
        await bounded(env.REDIRECT_CACHE!.delete(key), 1000);
      } catch {
        cacheFailure('delete');
      }
    })(),
    ctx,
  );
}
function entry(raw: string, host: string, keyword: string, now: number, ttl: number): Entry | null {
  if (raw.length > MAX_CACHE_BYTES) return null;
  try {
    const data = JSON.parse(raw) as Entry;
    if (
      data?.schema !== 2 ||
      data.ttl !== ttl ||
      !Number.isSafeInteger(data.at) ||
      data.at > now ||
      !Number.isSafeInteger(data.until) ||
      data.until !== data.at + ttl ||
      data.until <= now
    )
      return null;
    const r = data.rule;
    if (
      !r ||
      r.hostname !== host ||
      r.slug !== keyword ||
      typeof r.id !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(r.id) ||
      typeof r.domain_id !== 'string'
    )
      return null;
    if (
      !Number.isSafeInteger(r.rule_revision) ||
      r.rule_revision < 1 ||
      !Number.isSafeInteger(r.version) ||
      r.version < 1
    )
      return null;
    if (
      ![301, 302, 307, 308].includes(r.redirect_code) ||
      !['discard', 'merge', 'replace'].includes(r.query_mode) ||
      !Number.isSafeInteger(r.cache_ttl) ||
      r.cache_ttl < 0 ||
      r.cache_ttl > 3600
    )
      return null;
    if (
      r.kv_cache_ttl !== null &&
      (!Number.isSafeInteger(r.kv_cache_ttl) || r.kv_cache_ttl < 60 || r.kv_cache_ttl > 86400)
    )
      return null;
    targetURL(r.target_url);
    if (storedGeoRules(r.geo_rules).length || r.geo_rules !== '[]') return null;
    return {
      schema: 2,
      at: data.at,
      until: data.until,
      ttl,
      rule: Object.fromEntries(routeKeys.map((k) => [k, r[k]])) as Route,
    };
  } catch {
    return null;
  }
}
const guardColumns = `l.id,l.domain_id,l.slug,l.version,l.rule_revision,l.enabled,l.expires_at,l.kv_cache_ttl,
  l.password_hash,l.max_redirects,l.redirect_count,l.response_mode,l.block_vpn,l.geo_rules,d.hostname,d.enabled AS domain_enabled`;
const needsPrimaryHost = `l.response_mode='redirect' AND l.password_hash IS NULL
  AND l.max_redirects IS NULL AND l.block_vpn=0`;
const cacheSettings = `l.geo_rules='[]' AND l.expires_at IS NULL AND (l.kv_cache_ttl IS NULL
  OR (typeof(l.kv_cache_ttl)='integer' AND l.kv_cache_ttl BETWEEN 60 AND 86400))`;
const eligibleSQL = `${needsPrimaryHost} AND ${cacheSettings}`;

// A KV snapshot already read by this isolate can be compared directly with D1
// on the next visit. Only validated public snapshots live here, scoped to their
// binding, bounded in size/count and never usable beyond the KV envelope TTL.
const localEntries = new WeakMap<KVBinding, Map<string, Entry>>();
function remember(kv: KVBinding, key: string, value: Entry): void {
  let entries = localEntries.get(kv);
  if (!entries) {
    entries = new Map();
    localEntries.set(kv, entries);
  }
  if (entries.size >= MAX_LOCAL_ENTRIES && !entries.has(key))
    entries.delete(entries.keys().next().value!);
  entries.set(key, value);
}

// A single indexed read can return both current policy and the primary target's
// managed-domain status. If a KV candidate is supplied, return the target URL
// only when D1 disagrees, including same-version malformed/corrupt KV values.
async function readRoute(
  env: SharedEnv,
  host: string,
  keyword: string,
  mode: 'direct' | 'guarded' | 'eligibility' | Entry,
): Promise<Probe | null> {
  let target = 'l.target_url';
  let checkedHost = 'h.hostname';
  let hostJoin = `LEFT JOIN link_destination_hosts h
    ON h.link_id=(CASE WHEN ${needsPrimaryHost} THEN l.id END) AND h.position=-1`;
  const args: unknown[] = [];
  if (mode === 'guarded') {
    checkedHost = 'NULL';
    hostJoin = '';
  } else if (mode === 'eligibility') {
    target = `CASE WHEN ${eligibleSQL} THEN NULL ELSE l.target_url END`;
    // The eligible route gets its target check after KV. Skip the index read
    // until then; ineligible routes still finish in this query.
    hostJoin = `LEFT JOIN link_destination_hosts h
      ON h.link_id=(CASE WHEN ${needsPrimaryHost} AND NOT (${cacheSettings}) THEN l.id END) AND h.position=-1`;
  } else if (mode !== 'direct') {
    const r = mode.rule;
    target = `CASE WHEN ${eligibleSQL} AND l.id=? AND l.domain_id=? AND l.version=? AND l.rule_revision=?
      AND l.kv_cache_ttl IS ? AND l.target_url=? THEN NULL ELSE l.target_url END`;
    args.push(r.id, r.domain_id, r.version, r.rule_revision, r.kv_cache_ttl, r.target_url);
    // KV already supplies the hostname. The redirect handler accepts this
    // lookup only when it matches the host of the actual current destination.
    const candidateHost = canonicalHost(new URL(r.target_url).hostname);
    checkedHost = '?';
    hostJoin = '';
    args.push(candidateHost, candidateHost);
  }
  return env.DB.prepare(
    `SELECT ${guardColumns}, l.redirect_code,l.query_mode,l.cache_ttl,
       CASE WHEN l.response_mode='text' THEN l.text_content ELSE '' END AS text_content,
       ${target} AS target_url, ${checkedHost} AS checked_host,
       EXISTS(SELECT 1 FROM domains WHERE hostname=${checkedHost}) AS target_managed
     FROM domains d JOIN links l ON l.domain_id=d.id
     ${hostJoin}
     WHERE d.hostname=? AND d.enabled=1 AND l.slug=? AND l.enabled=1 LIMIT 1`,
  )
    .bind(...args, host, keyword)
    .first<Probe>();
}

function resolved(probe: Probe | null, cache: Lookup['cache'], snapshot?: Entry): Lookup {
  if (!probe) return { link: null, cache };
  return {
    link: {
      ...probe,
      target_url: probe.target_url ?? snapshot!.rule.target_url,
      title: '',
      description: '',
      created_by: null,
      created_at: 0,
      updated_at: 0,
    },
    checkedHost: probe.checked_host ?? undefined,
    targetManaged: !!probe.target_managed,
    cache,
  };
}

export async function lookupRedirect(
  env: RedirectEnv,
  host: string,
  keyword: string,
  request: Request,
  ctx?: Context,
): Promise<Lookup> {
  const kv = env.REDIRECT_CACHE;
  // A form POST never emits the destination. Effective browser collection (and
  // per-link protection below) checks it in the final authorization statement.
  if (request.method === 'POST' || collectsBrowserTimezone(env))
    return resolved(await readRoute(env, host, keyword, 'guarded'), 'disabled');
  if (!kv) return resolved(await readRoute(env, host, keyword, 'direct'), 'disabled');

  const key = cacheKey(host, keyword);
  const memory = localEntries.get(kv);
  const local = memory?.get(key);
  if (local) {
    if (local.until > nowSeconds() && routeCacheTTL(env, local.rule) === local.ttl) {
      const current = await readRoute(env, host, keyword, local);
      if (current && current.target_url === null) return resolved(current, 'hit', local);
      memory!.delete(key);
      const fallback = resolved(current, 'miss');
      if (fallback.link) await putRouteCache(env, fallback.link, ctx, false);
      return fallback;
    }
    memory!.delete(key);
  }

  // Missing, disabled, protected and per-link-disabled routes finish in D1
  // without a KV operation. Eligible routes must be authorized AFTER KV I/O.
  const probe = await readRoute(env, host, keyword, 'eligibility');
  if (!probe || probe.target_url !== null) return resolved(probe, 'disabled');
  let cached: Entry | null = null;
  let mayFill = true;
  try {
    const raw = await bounded(kv.get(key, { type: 'text', cacheTtl: 60 }), 750);
    if (raw !== null) cached = entry(raw, host, keyword, nowSeconds(), routeCacheTTL(env, probe));
  } catch {
    cacheFailure('get');
    mayFill = false;
  }
  const current = await readRoute(env, host, keyword, cached ?? 'direct');
  if (cached && current && current.target_url === null) {
    remember(kv, key, cached);
    return resolved(current, 'hit', cached);
  }
  const fallback = resolved(current, 'miss');
  if (fallback.link && mayFill) await putRouteCache(env, fallback.link, ctx, false);
  return fallback;
}
