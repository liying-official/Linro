import { VERSION } from '../../../../packages/shared/src/platform.js';
import { sourceURL } from '../../../../packages/shared/src/legal.js';
import {
  fail,
  json,
  nowSeconds,
  readJSON,
  rejectUnknown,
  text,
} from '../../../../packages/shared/src/http.js';
import {
  browserChecksConfigured,
  browserCollectionEnabled,
} from '../../../../packages/shared/src/browser-check.js';
import { securityPolicy } from '../../../../packages/shared/src/policy.js';
import { passwordsConfigured } from '../../../../packages/shared/src/link-password.js';
import { defaultRouteCacheTTL } from '../../../../packages/shared/src/redirect-cache.js';
import { linkWriteScope } from './auth.js';
import { audit } from './data.js';
import { analyticsConfigured } from './analytics.js';
import { userView } from './user-api.js';
import type { ApiContext } from './api-context.js';

export async function getSession({ env, principal }: ApiContext): Promise<Response> {
  const setting = await env.DB.prepare("SELECT value FROM settings WHERE key='site_name'").first<{
    value: string;
  }>();
  const policy = securityPolicy(env);
  return json({
    user: userView(principal.user),
    scopes: principal.scopes,
    source_url: sourceURL(env.SOURCE_URL),
    auth_kind: principal.kind,
    site_name: !setting?.value || setting.value === 'cf-links' ? 'Linro' : setting.value,
    analytics_configured: analyticsConfigured(env),
    link_write_scope: linkWriteScope(principal),
    features: {
      browser_timezone_collection_enabled: browserCollectionEnabled(env),
      browser_checks_configured: browserChecksConfigured(env),
      redirect_cache: !!env.REDIRECT_CACHE,
      cache_consistency: 'd1-guarded',
      redirect_cache_default_ttl: defaultRouteCacheTTL(env),
      passwords_configured: passwordsConfigured(env),
      text_responses: true,
      device_header_enabled: env.CLOUDFLARE_DEVICE_TYPE_ENABLED === 'true',
    },
    security: { queryKeys: policy.queryKeys, expiredStatus: policy.expiredStatus },
    version: VERSION,
  });
}

export async function getSummary({ env }: ApiContext): Promise<Response> {
  const now = nowSeconds();
  const counts = await env.DB.prepare(
    `SELECT
    (SELECT COUNT(*) FROM links) AS links,
    (SELECT COUNT(*) FROM links l JOIN domains d ON d.id=l.domain_id
      WHERE l.enabled=1 AND d.enabled=1
      AND (l.expires_at IS NULL OR l.expires_at>?)
      AND (l.max_redirects IS NULL OR l.redirect_count<l.max_redirects)) AS active,
    (SELECT COUNT(*) FROM links WHERE expires_at IS NOT NULL AND expires_at<=?) AS expired,
    (SELECT COUNT(*) FROM domains) AS domains`,
  )
    .bind(now, now)
    .first();
  return json(counts);
}

export async function getSettings({ env }: ApiContext): Promise<Response> {
  const data = await env.DB.prepare('SELECT * FROM settings ORDER BY key').all();
  return json(data.results);
}

export async function updateSettings(context: ApiContext): Promise<Response> {
  const { env, principal, request, requestId } = context;
  const body = await readJSON(request);
  rejectUnknown(body, ['site_name']);
  const name = text(body.site_name, 'site_name', 80);
  if (!name.trim()) fail(400, 'invalid_name', 'Site name is required.');
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO settings(key,value,updated_at)
      VALUES('site_name',?,?) ON CONFLICT(key)
      DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`,
    ).bind(name, nowSeconds()),
    audit(env.DB, principal, requestId, 'update', 'settings', 'site_name', { site_name: name }),
  ]);
  return json({ site_name: name });
}

export async function getSystemHealth({ env }: ApiContext): Promise<Response> {
  await env.DB.prepare('SELECT 1 AS ok').first();
  return json({
    worker: 'ok',
    database: 'ok',
    analytics: analyticsConfigured(env) ? 'configured_not_probed' : 'disabled_or_incomplete',
    version: VERSION,
  });
}
