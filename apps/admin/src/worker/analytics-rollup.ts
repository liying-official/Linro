import type { AdminEnv } from '../../../../packages/shared/src/platform.js';
import { nowSeconds } from '../../../../packages/shared/src/http.js';
import { analyticsConfigured, queryAnalytics } from './analytics-provider.js';

const DAY = 86400;
const WINDOW = 2 * DAY;
const PAGE = 400;
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
interface Cursor {
  start: number;
  end: number;
  date: string;
  link_id: string;
}
interface Watermark {
  end: number;
  generation: string;
}

function readCursor(raw: string, midnight: number): Cursor {
  const c: Cursor = JSON.parse(raw);
  if (
    !Number.isSafeInteger(c.start) ||
    !Number.isSafeInteger(c.end) ||
    c.start < 0 ||
    c.end > midnight ||
    c.end - c.start !== WINDOW ||
    !DATE.test(c.date) ||
    !UUID.test(c.link_id)
  )
    throw new Error('invalid_rollup_cursor');
  return c;
}

/** The cursor and estimates commit in the same batch. The watermark records the
 * last completed window, independently of a partial pass that may span midnight.
 * A conditional generation change prevents an older concurrent invocation from
 * overwriting newer estimates or moving its cursor back. */
export async function rollup(env: AdminEnv): Promise<void> {
  if (!analyticsConfigured(env) || (env.ANALYTICS_ROLLUP_ENABLED ?? 'true') !== 'true') return;
  const now = nowSeconds();
  const midnight = Math.floor(now / DAY) * DAY;
  const { results } = await env.DB.prepare(
    "SELECT key,value,updated_at FROM settings WHERE key IN ('analytics_rollup_cursor','analytics_rollup_watermark')",
  ).all<{ key: string; value: string; updated_at: number }>();
  const saved = results.find((r) => r.key === 'analytics_rollup_cursor');
  const mark = results.find((r) => r.key === 'analytics_rollup_watermark');
  const previous: Watermark | undefined = mark && JSON.parse(mark.value);
  if (
    mark &&
    (!previous ||
      !Number.isSafeInteger(previous.end) ||
      previous.end < 0 ||
      previous.end > midnight ||
      previous.end % DAY !== 0)
  )
    throw new Error('invalid_rollup_watermark');
  const hours = Number(env.ANALYTICS_ROLLUP_RECHECK_HOURS ?? 6);
  if (!Number.isInteger(hours) || hours < 1 || hours > 24)
    throw new Error('invalid_rollup_recheck_hours');
  if (!saved && previous?.end === midnight && now - mark!.updated_at < hours * 3600) return;
  const end = previous?.end ? Math.min(midnight, previous.end + WINDOW) : midnight;
  const cursor: Cursor = saved
    ? readCursor(saved.value, midnight)
    : { start: end - WINDOW, end, date: '', link_id: '' };
  const after = cursor.date
    ? ` AND (formatDateTime(timestamp, '%Y-%m-%d') > '${cursor.date}' OR (formatDateTime(timestamp, '%Y-%m-%d') = '${cursor.date}' AND index1 > '${cursor.link_id}'))`
    : '';
  const rows = await queryAnalytics(
    env,
    `SELECT index1 AS link_id,formatDateTime(timestamp, '%Y-%m-%d') AS date,sum(_sample_interval * double1) AS clicks
    FROM ${env.ANALYTICS_DATASET} WHERE double1 > 0 AND timestamp >= toDateTime(${cursor.start}) AND timestamp < toDateTime(${cursor.end})${after}
    GROUP BY link_id,date ORDER BY date,link_id LIMIT 401 FORMAT JSON`,
  );
  if (rows.length > PAGE + 1) throw new Error('rollup_provider_limit_violation');
  const selected = rows.slice(0, PAGE);
  for (const row of selected) {
    if (
      typeof row.link_id !== 'string' ||
      !UUID.test(row.link_id) ||
      typeof row.date !== 'string' ||
      !DATE.test(row.date) ||
      (typeof row.clicks !== 'number' && (typeof row.clicks !== 'string' || !row.clicks.trim())) ||
      !Number.isFinite(Number(row.clicks)) ||
      Number(row.clicks) < 0
    )
      throw new Error('rollup_invalid_row');
    const day = Date.parse(row.date + 'T00:00:00Z') / 1000;
    if (
      !Number.isFinite(day) ||
      day < cursor.start ||
      day >= cursor.end ||
      (cursor.date &&
        (row.date < cursor.date || (row.date === cursor.date && row.link_id <= cursor.link_id)))
    )
      throw new Error('rollup_invalid_position');
  }
  const done = rows.length <= PAGE;
  const next = JSON.stringify({
    end: done ? cursor.end : (previous?.end ?? 0),
    generation: crypto.randomUUID(),
  } satisfies Watermark);
  const owns = "(SELECT value FROM settings WHERE key='analytics_rollup_watermark') = ?";
  const statements = [
    env.DB.prepare(
      `INSERT INTO settings(key,value,updated_at) VALUES('analytics_rollup_watermark',?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at WHERE settings.value IS ?`,
    ).bind(next, done ? now : (mark?.updated_at ?? 0), mark?.value ?? null),
  ];
  for (let i = 0; i < selected.length; i += 10) {
    const group = selected.slice(i, i + 10);
    const selects = group
      .map(() => 'SELECT ? AS link_id, ? AS date, ? AS clicks')
      .join(' UNION ALL ');
    statements.push(
      env.DB.prepare(
        `INSERT INTO daily_stats(link_id,date,clicks,updated_at)
      SELECT v.link_id,v.date,v.clicks,? FROM (${selects}) v JOIN links l ON l.id=v.link_id WHERE ${owns}
      ON CONFLICT(link_id,date) DO UPDATE SET clicks=excluded.clicks,updated_at=excluded.updated_at
      WHERE daily_stats.clicks <> excluded.clicks`,
      ).bind(now, ...group.flatMap((r) => [r.link_id, r.date, Number(r.clicks)]), next),
    );
  }
  if (done) {
    if (saved)
      statements.push(
        env.DB.prepare(`DELETE FROM settings WHERE key='analytics_rollup_cursor' AND ${owns}`).bind(
          next,
        ),
      );
    statements.push(
      env.DB.prepare(
        `INSERT INTO settings(key,value,updated_at) SELECT 'analytics_rollup_last_success',?,? WHERE ${owns}
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`,
      ).bind(String(now), now, next),
    );
  } else {
    const last = selected[selected.length - 1]!;
    const position = JSON.stringify({ ...cursor, date: last.date, link_id: last.link_id });
    statements.push(
      env.DB.prepare(
        `INSERT INTO settings(key,value,updated_at) SELECT 'analytics_rollup_cursor',?,? WHERE ${owns}
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`,
      ).bind(position, now, next),
    );
  }
  await env.DB.batch(statements);
}
