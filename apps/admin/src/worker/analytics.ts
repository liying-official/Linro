import type { AdminEnv } from '../../../../packages/shared/src/platform.js';
import { fail, HttpError } from '../../../../packages/shared/src/http.js';
import {
  ANALYTICS_DEADLINE_MS,
  analyticsConfigured,
  queryAnalytics,
} from './analytics-provider.js';
export { analyticsConfigured, queryAnalytics } from './analytics-provider.js';
export { rollup } from './analytics-rollup.js';
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
export const MAX_STATS_LINKS = 50;
/** null means ALL; an explicit empty/invalid selection must never expand to all. */
export function validateStatsIds(ids: string[] | string | null): string[] | null {
  if (ids === null) return null;
  const values = typeof ids === 'string' ? [ids] : ids;
  if (
    !Array.isArray(values) ||
    !values.length ||
    values.length > MAX_STATS_LINKS ||
    values.some((id) => typeof id !== 'string' || !UUID.test(id))
  )
    fail(400, 'invalid_link_id', 'Select 1–50 valid link IDs.');
  return [...new Set(values)];
}
export function statsSelection(url: URL): string[] | null {
  const single = url.searchParams.getAll('link_id');
  const multi = url.searchParams.getAll('link_ids');
  if (single.length > 1 || multi.length > 1 || (single.length && multi.length))
    fail(400, 'invalid_link_id', 'Use link_id or comma-separated link_ids, not both.');
  if (single.length) return validateStatsIds(single[0]!);
  if (multi.length) return validateStatsIds(multi[0]!.split(','));
  return null;
}
export async function checkStatsSelection(env: AdminEnv, ids: string[] | null): Promise<void> {
  if (!ids) return;
  // The existing workspace-wide analytics:read scope is retained. Do not
  // silently omit deleted/unknown IDs: that could change the requested scope.
  const found = await env.DB.prepare(
    `SELECT id FROM links WHERE id IN (${ids.map(() => '?').join(',')})`,
  )
    .bind(...ids)
    .all();
  if (found.results.length !== ids.length)
    fail(
      404,
      'stats_link_not_found',
      'One or more selected links no longer exist. Refresh the selection.',
    );
}
function dimensionRows(
  rows: Record<string, unknown>[],
  key: string,
  normalize: (s: unknown) => string,
) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const name = normalize(row[key]);
    const count = Number(row.clicks);
    if (!Number.isFinite(count) || count < 0)
      fail(502, 'analytics_query_failed', 'Invalid analytics counts.');
    totals.set(name, (totals.get(name) ?? 0) + count);
  }
  return [...totals].sort((a, b) => b[1] - a[1]).map(([name, clicks]) => ({ [key]: name, clicks }));
}
type StatsView = 'dashboard' | 'full';
type ResultData = Record<string, unknown>;
interface StatsCache {
  token: string;
  results: Map<string, { until: number; data: ResultData }>;
}
// Only completed plain data is reused. Streams and promises belong to the
// originating Workers request. Every caller still passes auth and the D1 ID check.
const resultCaches = new WeakMap<AdminEnv, StatsCache>();
const CACHE_MS = 15000;
const MAX_CACHED_SELECTIONS = 16;
export function statsView(url: URL): StatsView {
  const values = url.searchParams.getAll('view');
  if (!values.length) return 'full';
  if (values.length !== 1 || (values[0] !== 'full' && values[0] !== 'dashboard'))
    fail(400, 'invalid_stats_view', 'Use dashboard or full for the statistics view.');
  return values[0] as StatsView;
}

export async function stats(
  env: AdminEnv,
  days: number,
  linkIds: string[] | string | null,
  view: StatsView = 'full',
  caller?: AbortSignal,
): Promise<ResultData> {
  const ids = validateStatsIds(linkIds);
  if (!Number.isSafeInteger(days) || days < 1 || days > 90)
    fail(400, 'invalid_field', 'Invalid days.');
  if (caller?.aborted) fail(408, 'request_aborted', 'The request was cancelled.');
  await checkStatsSelection(env, ids);
  if (caller?.aborted) fail(408, 'request_aborted', 'The request was cancelled.');
  if (!analyticsConfigured(env))
    return {
      available: false,
      reason: 'Analytics Engine is disabled or the Analytics Read secret is not configured.',
      sampled: true,
      link_ids: ids,
    };
  let cache = resultCaches.get(env);
  if (!cache || cache.token !== env.ANALYTICS_API_TOKEN) {
    cache = { token: env.ANALYTICS_API_TOKEN!, results: new Map() };
    resultCaches.set(env, cache);
  }
  const key = JSON.stringify([
    env.CLOUDFLARE_ACCOUNT_ID,
    env.ANALYTICS_DATASET,
    env.CLOUDFLARE_DEVICE_TYPE_ENABLED,
    days,
    view,
    ids && [...ids].sort(),
  ]);
  const hit = cache.results.get(key);
  if (hit && hit.until > Date.now()) return { ...hit.data, link_ids: ids };
  const controller = new AbortController();
  const cancel = () =>
    controller.abort(new HttpError(408, 'request_aborted', 'The request was cancelled.'));
  caller?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(
    () =>
      controller.abort(new HttpError(504, 'analytics_timeout', 'The analytics request timed out.')),
    ANALYTICS_DEADLINE_MS,
  );
  try {
    const data = await loadStats(env, days, ids, view, controller.signal);
    controller.signal.throwIfAborted();
    cache.results.delete(key);
    if (cache.results.size >= MAX_CACHED_SELECTIONS)
      cache.results.delete(cache.results.keys().next().value!);
    cache.results.set(key, { until: Date.now() + CACHE_MS, data });
    return { ...data, link_ids: ids };
  } finally {
    clearTimeout(timer);
    caller?.removeEventListener('abort', cancel);
    controller.abort();
  }
}

function countValue(raw: unknown): number {
  const value = Number(raw ?? 0);
  if (!Number.isFinite(value) || value < 0)
    fail(502, 'analytics_query_failed', 'Invalid analytics counts.');
  return value;
}

async function loadStats(
  env: AdminEnv,
  days: number,
  ids: string[] | null,
  view: StatsView,
  signal: AbortSignal,
): Promise<ResultData> {
  const dataset = env.ANALYTICS_DATASET!;
  const filter = !ids
    ? ''
    : ids.length === 1
      ? ` AND index1='${ids[0]}'`
      : ` AND index1 IN (${ids.map((id) => `'${id}'`).join(',')})`;
  const where = `timestamp >= now() - INTERVAL '${days}' DAY${filter}`;
  const sum = 'sum(_sample_interval * double1)';
  const successWhere = `${where} AND double1 > 0`;
  const timelineSQL = `SELECT formatDateTime(timestamp, '%Y-%m-%d') AS date, ${sum} AS clicks FROM ${dataset} WHERE ${successWhere} GROUP BY date ORDER BY date FORMAT JSON`;
  if (view === 'dashboard') {
    const timeline = await queryAnalytics(env, timelineSQL, signal);
    return {
      available: true,
      sampled: true,
      timezone: 'UTC',
      days,
      timeline,
      clicks: timeline.reduce((n, row) => n + countValue(row.clicks), 0),
    };
  }
  // Existing double1 remains successful GETs only. New terminal rejection
  // events have zero double1 and independent counters, so they cannot inflate
  // clicks, traffic charts, rankings or the legacy daily archive.
  const vpnSum = 'sum(_sample_interval * double3)';
  const queries = [
    `SELECT ${sum} AS clicks,
      ${vpnSum} AS suspected_vpn_visits,
      sum(_sample_interval * double1 * double3) AS suspected_vpn_successes,
      sum(_sample_interval * double4) AS blocked_vpn_visits,
      sum(_sample_interval * double5) AS unknown_timezone_blocks,
      sumIf(_sample_interval, blob11 = 'unknown_blocked') AS unverifiable_blocks,
      sum(_sample_interval * double6) AS unknown_timezone_successes,
      sum(_sample_interval * double7) AS tor_visits
      FROM ${dataset} WHERE ${where} FORMAT JSON`,
    timelineSQL,
    `SELECT index1 AS link_id, blob1 AS hostname, blob2 AS slug, ${sum} AS clicks FROM ${dataset} WHERE ${successWhere} GROUP BY link_id,hostname,slug ORDER BY clicks DESC LIMIT 50 FORMAT JSON`,
    `SELECT blob3 AS country, ${sum} AS clicks FROM ${dataset} WHERE ${successWhere} GROUP BY country ORDER BY clicks DESC LIMIT 20 FORMAT JSON`,
    `SELECT blob4 AS referrer, ${sum} AS clicks FROM ${dataset} WHERE ${successWhere} GROUP BY referrer ORDER BY clicks DESC LIMIT 20 FORMAT JSON`,
    `SELECT blob9 AS timezone, ${sum} AS clicks FROM ${dataset} WHERE ${successWhere} GROUP BY timezone ORDER BY clicks DESC LIMIT 1000 FORMAT JSON`,
    `SELECT blob6 AS timezone, ${sum} AS clicks FROM ${dataset} WHERE ${successWhere} GROUP BY timezone ORDER BY clicks DESC LIMIT 1000 FORMAT JSON`,
    `SELECT blob7 AS device, ${sum} AS clicks FROM ${dataset} WHERE ${successWhere} GROUP BY device ORDER BY clicks DESC LIMIT 32 FORMAT JSON`,
  ];
  // Each pair shares the invocation deadline. A failed pair stops further queries.
  const result: Record<string, unknown>[][] = [];
  for (let i = 0; i < queries.length; i += 2) {
    signal.throwIfAborted();
    result.push(
      ...(await Promise.all(
        queries.slice(i, i + 2).map((sql) => queryAnalytics(env, sql, signal)),
      )),
    );
  }
  const [summary, timeline, top, countries, referrers, timezones, ipTimezones, devices] = result;
  const count = (key: string): number => countValue(summary?.[0]?.[key]);
  return {
    available: true,
    sampled: true,
    timezone: 'UTC',
    days,
    link_ids: ids,
    suspected_vpn_visits: count('suspected_vpn_visits'),
    suspected_vpn_successes: count('suspected_vpn_successes'),
    blocked_vpn_visits: count('blocked_vpn_visits'),
    unknown_timezone_blocks: count('unknown_timezone_blocks'),
    unverifiable_blocks: count('unverifiable_blocks'),
    unknown_timezone_successes: count('unknown_timezone_successes'),
    tor_visits: count('tor_visits'),
    vpn_scope: 'terminal_successes_and_policy_denials_not_unique_users',
    clicks: count('clicks'),
    timeline,
    top,
    countries,
    referrers,
    timezones: dimensionRows(timezones ?? [], 'timezone', (value) =>
      typeof value === 'string' && value.length > 0 ? value : 'none',
    ),
    ip_timezones: dimensionRows(ipTimezones ?? [], 'timezone', (value) =>
      typeof value === 'string' && value.length > 0 ? value : 'none',
    ),
    devices: dimensionRows(devices ?? [], 'device', (value) =>
      value === 'mobile' || value === 'pc' ? value : 'none',
    ),
    dimension_sources: {
      timezone: 'javascript_client_reported',
      ip_timezone: 'cloudflare_ip_geolocation',
      device: 'cloudflare_generated_header',
      browser_timezone: 'javascript_client_reported_untrusted',
      tor: 'cloudflare_request_cf_country_T1',
      device_header_enabled: env.CLOUDFLARE_DEVICE_TYPE_ENABLED === 'true',
    },
    success_scope: 'authorized_get_redirect_or_text',
  };
}
