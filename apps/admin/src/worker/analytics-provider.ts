import type { AdminEnv } from '../../../../packages/shared/src/platform.js';
import { fail, HttpError } from '../../../../packages/shared/src/http.js';

export const ANALYTICS_DEADLINE_MS = 10000;

export function analyticsConfigured(env: AdminEnv): boolean {
  return (
    env.ANALYTICS_ENABLED === 'true' &&
    /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(env.ANALYTICS_DATASET ?? '') &&
    /^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID ?? '') &&
    !!env.ANALYTICS_API_TOKEN
  );
}

export async function queryAnalytics(
  env: AdminEnv,
  sql: string,
  signal = AbortSignal.timeout(ANALYTICS_DEADLINE_MS),
): Promise<Record<string, unknown>[]> {
  if (!analyticsConfigured(env))
    fail(503, 'analytics_not_configured', 'Analytics Engine querying is not configured.');
  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/analytics_engine/sql`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.ANALYTICS_API_TOKEN}`,
          'Content-Type': 'text/plain',
        },
        body: sql,
        signal,
        redirect: 'manual',
      },
    );
    if (!response.ok)
      fail(
        502,
        'analytics_query_failed',
        'Analytics provider query failed. Check the account, dataset and Analytics Read token.',
      );
    const result = (await response.json()) as { data?: Record<string, unknown>[] };
    if (!Array.isArray(result?.data))
      fail(502, 'analytics_query_failed', 'Analytics provider returned an invalid response.');
    return result.data;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (signal.aborted) {
      if (signal.reason instanceof HttpError) throw signal.reason;
      fail(504, 'analytics_timeout', 'The analytics request timed out.');
    }
    return fail(502, 'analytics_query_failed', 'Analytics provider query failed.');
  }
}
