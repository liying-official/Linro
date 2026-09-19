import type { Env } from '../../../../packages/shared/src/platform.js';
import { fail, nowSeconds } from '../../../../packages/shared/src/http.js';
export function analyticsConfigured(env: Env): boolean {
  return env.ANALYTICS_ENABLED === 'true' && /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(env.ANALYTICS_DATASET ?? '') && /^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID ?? '') && !!env.ANALYTICS_API_TOKEN;
}
export async function queryAnalytics(env: Env, sql: string): Promise<Record<string, unknown>[]> {
  if (!analyticsConfigured(env)) fail(503, 'analytics_not_configured', 'Analytics Engine querying is not configured.');
  // Never follow a provider redirect with the Analytics Read bearer secret.
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/analytics_engine/sql`, {
    method: 'POST', headers: { Authorization: `Bearer ${env.ANALYTICS_API_TOKEN}`, 'Content-Type': 'text/plain' },
    body: sql, signal: AbortSignal.timeout(10000), redirect: 'manual',
  });
  if (!response.ok) fail(502, 'analytics_query_failed', 'Analytics provider query failed. Check the account, dataset and Analytics Read token.');
  const result = await response.json() as { data?: Record<string, unknown>[] };
  if (!Array.isArray(result.data)) fail(502, 'analytics_query_failed', 'Analytics provider returned an invalid response.');
  return result.data;
}
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
export const MAX_STATS_LINKS = 50;
/** null means ALL; an explicit empty/invalid selection must never expand to all. */
export function validateStatsIds(ids: string[] | string | null): string[] | null {
  if (ids === null) return null;
  const values = typeof ids === 'string' ? [ids] : ids;
  if (!Array.isArray(values) || !values.length || values.length > MAX_STATS_LINKS ||
      values.some(id => typeof id !== 'string' || !UUID.test(id)))
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
export async function checkStatsSelection(env: Env, ids: string[] | null): Promise<void> {
  if (!ids) return;
  // The existing workspace-wide analytics:read scope is retained. Do not
  // silently omit deleted/unknown IDs: that could change the requested scope.
  const found = await env.DB.prepare(`SELECT id FROM links WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all();
  if (found.results.length !== ids.length) fail(404, 'stats_link_not_found', 'One or more selected links no longer exist. Refresh the selection.');
}
function dimensionRows(rows: Record<string, unknown>[], key: string, normalize: (s: unknown) => string) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const name = normalize(row[key]); const count = Number(row.clicks);
    if (!Number.isFinite(count) || count < 0) fail(502, 'analytics_query_failed', 'Invalid analytics counts.');
    totals.set(name, (totals.get(name) ?? 0) + count);
  }
  return [...totals].sort((a, b) => b[1] - a[1]).map(([name, clicks]) => ({ [key]: name, clicks }));
}
export async function stats(env: Env, days: number, linkIds: string[] | string | null): Promise<unknown> {
  const ids = validateStatsIds(linkIds);
  if (!Number.isSafeInteger(days) || days < 1 || days > 90) fail(400, 'invalid_field', 'Invalid days.');
  await checkStatsSelection(env, ids);
  if (!analyticsConfigured(env)) return { available: false, reason: 'Analytics Engine is disabled or the Analytics Read secret is not configured.', sampled: true, link_ids: ids };
  const dataset = env.ANALYTICS_DATASET!;
  const filter = !ids ? '' : ids.length === 1 ? ` AND index1='${ids[0]}'` : ` AND index1 IN (${ids.map(id => `'${id}'`).join(',')})`;
  const where = `timestamp >= now() - INTERVAL '${days}' DAY${filter}`;
  const sum = 'sum(_sample_interval * double1)';
  const successWhere = `${where} AND double1 > 0`;
  // Existing double1 remains successful GETs only. New terminal rejection
  // events have zero double1 and independent counters, so they cannot inflate
  // clicks, traffic charts, rankings or the legacy daily archive.
  const vpnSum = 'sum(_sample_interval * double3)';
  const queries = [
    `SELECT ${sum} AS clicks, ${vpnSum} AS suspected_vpn_visits, sum(_sample_interval * double1 * double3) AS suspected_vpn_successes, sum(_sample_interval * double4) AS blocked_vpn_visits, sum(_sample_interval * double5) AS unknown_timezone_blocks, sum(_sample_interval * double6) AS unknown_timezone_successes, sum(_sample_interval * double7) AS tor_visits FROM ${dataset} WHERE ${where} FORMAT JSON`,
    `SELECT formatDateTime(timestamp, '%Y-%m-%d') AS date, ${sum} AS clicks FROM ${dataset} WHERE ${successWhere} GROUP BY date ORDER BY date FORMAT JSON`,
    `SELECT index1 AS link_id, blob1 AS hostname, blob2 AS slug, ${sum} AS clicks FROM ${dataset} WHERE ${successWhere} GROUP BY link_id,hostname,slug ORDER BY clicks DESC LIMIT 50 FORMAT JSON`,
    `SELECT blob3 AS country, ${sum} AS clicks FROM ${dataset} WHERE ${successWhere} GROUP BY country ORDER BY clicks DESC LIMIT 20 FORMAT JSON`,
    `SELECT blob4 AS referrer, ${sum} AS clicks FROM ${dataset} WHERE ${successWhere} GROUP BY referrer ORDER BY clicks DESC LIMIT 20 FORMAT JSON`,
    `SELECT blob9 AS timezone, ${sum} AS clicks FROM ${dataset} WHERE ${successWhere} GROUP BY timezone ORDER BY clicks DESC LIMIT 1000 FORMAT JSON`,
    `SELECT blob6 AS timezone, ${sum} AS clicks FROM ${dataset} WHERE ${successWhere} GROUP BY timezone ORDER BY clicks DESC LIMIT 1000 FORMAT JSON`,
    `SELECT blob7 AS device, ${sum} AS clicks FROM ${dataset} WHERE ${successWhere} GROUP BY device ORDER BY clicks DESC LIMIT 32 FORMAT JSON`,
  ];
  // Bounded sequential queries, no retry storm when the provider returns 429.
  const result: Record<string, unknown>[][] = [];
  for (const sql of queries) result.push(await queryAnalytics(env, sql));
  const [summary, timeline, top, countries, referrers, timezones, ipTimezones, devices] = result;
  const count = (key: string): number => {
    const value = Number(summary?.[0]?.[key] ?? 0);
    if (!Number.isFinite(value) || value < 0) fail(502, 'analytics_query_failed', 'Invalid analytics counts.');
    return value;
  };
  return { available: true, sampled: true, timezone: 'UTC', days, link_ids: ids,
    suspected_vpn_visits: count('suspected_vpn_visits'), suspected_vpn_successes: count('suspected_vpn_successes'),
    blocked_vpn_visits: count('blocked_vpn_visits'), unknown_timezone_blocks: count('unknown_timezone_blocks'),
    unknown_timezone_successes: count('unknown_timezone_successes'), tor_visits: count('tor_visits'),
    vpn_scope: 'terminal_successes_and_policy_denials_not_unique_users',
    clicks: count('clicks'), timeline, top, countries, referrers,
    timezones: dimensionRows(timezones ?? [], 'timezone', value => typeof value === 'string' && value.length > 0 ? value : 'none'),
    ip_timezones: dimensionRows(ipTimezones ?? [], 'timezone', value => typeof value === 'string' && value.length > 0 ? value : 'none'),
    devices: dimensionRows(devices ?? [], 'device', value => value === 'mobile' || value === 'pc' ? value : 'none'),
    dimension_sources: { timezone: 'javascript_client_reported', ip_timezone: 'cloudflare_ip_geolocation', device: 'cloudflare_generated_header', browser_timezone: 'javascript_client_reported_untrusted', tor: 'cloudflare_request_cf_country_T1', device_header_enabled: env.CLOUDFLARE_DEVICE_TYPE_ENABLED === 'true' },
    success_scope: 'authorized_get_redirect_or_text',
  };
}
/** Incremental, idempotent archive. Each invocation handles up to 400 link/day
 * groups using at most 43 D1 statements (10 rows per UPSERT). The checkpoint and
 * rows commit together; retries overwrite estimates instead of double-counting.
 * A completed pass refreshes the previous two complete UTC dates.
 */
export async function rollup(env: Env): Promise<void> {
  if (!analyticsConfigured(env)) return;
  const now = nowSeconds(); const midnight = Math.floor(now / 86400) * 86400;
  type Cursor = { start: number; end: number; date: string; link_id: string };
  let cursor: Cursor = { start: midnight - 172800, end: midnight, date: '', link_id: '' };
  const saved = await env.DB.prepare("SELECT value FROM settings WHERE key='analytics_rollup_cursor'").first<{ value: string }>();
  if (saved) {
    const parsed = JSON.parse(saved.value) as Cursor;
    if (!Number.isSafeInteger(parsed.start) || !Number.isSafeInteger(parsed.end) || parsed.start < 0 || parsed.end > midnight || parsed.end - parsed.start !== 172800 || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.date) || !/^[0-9a-f-]{36}$/.test(parsed.link_id)) throw new Error('invalid_rollup_cursor');
    cursor = parsed;
  }
  const after = cursor.date ? ` AND (formatDateTime(timestamp, '%Y-%m-%d') > '${cursor.date}' OR (formatDateTime(timestamp, '%Y-%m-%d') = '${cursor.date}' AND index1 > '${cursor.link_id}'))` : '';
  const rows = await queryAnalytics(env, `SELECT index1 AS link_id,formatDateTime(timestamp, '%Y-%m-%d') AS date,sum(_sample_interval * double1) AS clicks
    FROM ${env.ANALYTICS_DATASET} WHERE double1 > 0 AND timestamp >= toDateTime(${cursor.start}) AND timestamp < toDateTime(${cursor.end})${after}
    GROUP BY link_id,date ORDER BY date,link_id LIMIT 401 FORMAT JSON`);
  if (rows.length > 401) throw new Error('rollup_provider_limit_violation');
  const selected = rows.slice(0, 400);
  for (const row of selected) {
    if (typeof row.link_id !== 'string' || !/^[0-9a-f-]{36}$/.test(row.link_id) || typeof row.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !Number.isFinite(Number(row.clicks)) || Number(row.clicks) < 0) throw new Error('rollup_invalid_row');
  }
  const statements = [];
  for (let i = 0; i < selected.length; i += 10) {
    const group = selected.slice(i, i + 10);
    const selects = group.map(() => 'SELECT ? AS link_id, ? AS date, ? AS clicks, ? AS updated_at').join(' UNION ALL ');
    statements.push(env.DB.prepare(`INSERT INTO daily_stats(link_id,date,clicks,updated_at)
      SELECT v.link_id,v.date,v.clicks,v.updated_at FROM (${selects}) v JOIN links l ON l.id=v.link_id WHERE 1
      ON CONFLICT(link_id,date) DO UPDATE SET clicks=excluded.clicks,updated_at=excluded.updated_at`)
      .bind(...group.flatMap(row => [row.link_id, row.date, Number(row.clicks), now])));
  }
  if (rows.length <= 400) {
    statements.push(env.DB.prepare("DELETE FROM settings WHERE key='analytics_rollup_cursor'"));
    statements.push(env.DB.prepare(`INSERT INTO settings(key,value,updated_at) VALUES('analytics_rollup_last_success',?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).bind(String(now), now));
  } else {
    const last = selected[selected.length - 1]!;
    const next = JSON.stringify({ ...cursor, date: last.date, link_id: last.link_id });
    statements.push(env.DB.prepare(`INSERT INTO settings(key,value,updated_at) VALUES('analytics_rollup_cursor',?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).bind(next, now));
  }
  await env.DB.batch(statements);
}
