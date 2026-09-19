import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export function validateConfig(config) {
  const fail = message => { throw new Error(message); };
  if (!config || typeof config !== 'object' || Array.isArray(config)) fail('deployment.json must be an object.');
  for (const key of ['account_id', 'database_id', 'admin_host', 'access_issuer', 'access_aud', 'owner_email']) if (typeof config[key] !== 'string') fail(`${key} is required.`);
  if (!/^[a-f0-9]{32}$/.test(config.account_id) || /^0+$/.test(config.account_id)) fail('account_id must be the real 32-character Cloudflare account ID.');
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(config.database_id) || /^0+-0+-0+-0+-0+$/.test(config.database_id)) fail('database_id must be the D1 database UUID.');
  const host = value => typeof value === 'string' && value.length <= 253 && value.includes('.') && !value.endsWith('.') && value.split('.').every(v => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(v)) && !/^\d+(\.\d+){3}$/.test(value);
  if (!host(config.admin_host)) fail('admin_host must be a lowercase DNS hostname, not a URL.');
  if (!Array.isArray(config.redirect_hosts) || !config.redirect_hosts.length || config.redirect_hosts.length > 50 || config.redirect_hosts.some(value => !host(value) || value === config.admin_host) || new Set(config.redirect_hosts).size !== config.redirect_hosts.length) fail('redirect_hosts needs 1–50 distinct DNS hostnames, separate from admin_host.');
  if (!/^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.cloudflareaccess\.com$/.test(config.access_issuer)) fail('access_issuer must be https://YOUR-TEAM.cloudflareaccess.com, without a trailing slash.');
  if (!/^[a-zA-Z0-9_-]{16,256}$/.test(config.access_aud) || /YOUR|REPLACE/.test(config.access_aud)) fail('access_aud must be the Access application audience.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.owner_email) || config.owner_email.length > 254) fail('owner_email must be the first owner’s Access email.');
  if (config.browser_timezone_enabled !== undefined && typeof config.browser_timezone_enabled !== 'boolean') fail('browser_timezone_enabled must be a boolean.');
  if ('BROWSER_CHECK_SECRET' in config || 'browser_check_secret' in config) fail('Set BROWSER_CHECK_SECRET using Wrangler secrets on both Workers, never in deployment.json.');
  if (config.cloudflare_device_type_enabled !== undefined && typeof config.cloudflare_device_type_enabled !== 'boolean') fail('cloudflare_device_type_enabled must be a boolean.');
  if (config.analytics_enabled !== undefined && typeof config.analytics_enabled !== 'boolean') fail('analytics_enabled must be a boolean.');
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(config.analytics_dataset ?? 'linro_clicks')) fail('Invalid analytics_dataset.');
  if (!/^[a-z0-9][a-z0-9-]{0,50}$/.test(config.database_name ?? 'linro')) fail('Invalid database_name.');
  for (const key of ['admin_worker_name', 'redirect_worker_name']) {
    if (config[key] !== undefined && (typeof config[key] !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(config[key]))) fail(`Invalid ${key}.`);
  }
  if ((config.admin_worker_name ?? 'linro-admin') === (config.redirect_worker_name ?? 'linro-redirect')) fail('Admin and redirect Worker names must be different.');
  if (config.source_url !== undefined && config.source_url !== '') {
    let u; try { u = new URL(config.source_url); } catch { fail('source_url must be a public HTTPS Corresponding Source URL.'); }
    if (typeof config.source_url !== 'string' || config.source_url.length > 2048 || /[\s<>"\\]/.test(config.source_url) || u.protocol !== 'https:' || !u.hostname.includes('.') || u.username || u.password || u.search || u.hash || u.hostname === config.admin_host || config.redirect_hosts.includes(u.hostname)) fail('source_url must be a credential-free public HTTPS URL without query/fragment, separate from this deployment.');
  }
  const namespaces = [['auth_rate_namespace', '21001'], ['write_rate_namespace', '21002'], ['redirect_rate_namespace', '21003'], ['password_rate_namespace', '21004']].map(([key, fallback]) => {
    const value = String(config[key] ?? fallback);
    if (!/^[1-9][0-9]{0,9}$/.test(value)) fail(`Invalid ${key}.`);
    return value;
  });
  if (new Set(namespaces).size !== namespaces.length) fail('Rate limiting namespaces must be different.');
  if (!Number.isSafeInteger(config.redirect_rate_limit ?? 300) || (config.redirect_rate_limit ?? 300) < 1 || (config.redirect_rate_limit ?? 300) > 100000) fail('redirect_rate_limit must be an integer from 1 to 100000 per minute.');
  if (!Number.isSafeInteger(config.password_rate_limit ?? 5) || (config.password_rate_limit ?? 5) < 1 || (config.password_rate_limit ?? 5) > 30) fail('password_rate_limit must be an integer from 1 to 30 per minute.');
  if (!Number.isSafeInteger(config.redirect_cache_ttl ?? 300) || (config.redirect_cache_ttl ?? 300) < 60 || (config.redirect_cache_ttl ?? 300) > 86400) fail('redirect_cache_ttl must be an integer from 60 to 86400 seconds.');
  if (config.redirect_cache_namespace_id !== undefined && config.redirect_cache_namespace_id !== '' && (typeof config.redirect_cache_namespace_id !== 'string' || !/^[a-f0-9]{32}$/.test(config.redirect_cache_namespace_id) || /^0+$/.test(config.redirect_cache_namespace_id))) fail('redirect_cache_namespace_id must be an actual KV namespace ID, or an empty string to disable KV.');
  if ('LINK_PASSWORD_SECRET' in config || 'link_password_secret' in config) fail('Set LINK_PASSWORD_SECRET using Wrangler secrets on both Workers, never in deployment.json.');
  if (![404, 410].includes(config.expired_link_status ?? 404)) fail('expired_link_status must be 404 or 410.');
  const keys = config.query_forward_allowlist ?? ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
  if (!Array.isArray(keys) || keys.length > 32 || new Set(keys).size !== keys.length || keys.some(k => typeof k !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(k) || sensitiveKey(k))) fail('query_forward_allowlist must contain distinct reviewed lower-case keys; sensitive keys are prohibited.');
  const hosts = config.private_target_allowlist ?? [];
  if (!Array.isArray(hosts) || hosts.length > 32 || new Set(hosts).size !== hosts.length || JSON.stringify(hosts).length > 4096 || hosts.some(h => !policyHost(h))) fail('private_target_allowlist must contain up to 32 exact canonical hostnames/IP literals, without ports, wildcards or CIDR.');
  if (hosts.some(h => h === config.admin_host || config.redirect_hosts.includes(h))) fail('Private exceptions cannot include administration or redirect hosts.');
  return config;
}
// Duplicated only for dependency-free configuration before TypeScript is built;
// security-config regression tests compare this contract to Worker policy.ts.
function sensitiveKey(key) {
  const folded = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return /(?:token|password|passwd|secret|credential|session|redirect|return|callback|continue|nonce|assertion)/.test(folded) ||
    ['next', 'url', 'uri', 'dest', 'destination', 'goto', 'code', 'state', 'clientid', 'responsetype', 'scope', 'auth', 'authorization', 'samlrequest', 'samlresponse', 'relaystate'].includes(folded);
}
function policyHost(value) {
  try {
    if (typeof value !== 'string') return false;
    const u = new URL(`http://${value}/`); const h = u.hostname.toLowerCase().replace(/\.$/, '');
    return value === h && !u.port && !u.username && !u.password && u.pathname === '/' && !u.search && !u.hash &&
      (h.startsWith('[') || h.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)));
  } catch { return false; }
}
export function configs(c) {
  validateConfig(c);
  const db = { binding: 'DB', database_name: c.database_name ?? 'linro', database_id: c.database_id, migrations_dir: '../../migrations' };
  const security = { SOURCE_URL: c.source_url ?? '', BROWSER_TIMEZONE_ENABLED: String(c.browser_timezone_enabled ?? true), CLOUDFLARE_DEVICE_TYPE_ENABLED: String(c.cloudflare_device_type_enabled ?? false), REDIRECT_CACHE_TTL: String(c.redirect_cache_ttl ?? 300), QUERY_FORWARD_ALLOWLIST: JSON.stringify(c.query_forward_allowlist ?? ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']), PRIVATE_TARGET_ALLOWLIST: JSON.stringify(c.private_target_allowlist ?? []), EXPIRED_LINK_STATUS: String(c.expired_link_status ?? 404) };
  const common = { '$schema': '../../node_modules/wrangler/config-schema.json', account_id: c.account_id, compatibility_date: '2026-09-15', workers_dev: false, preview_urls: false, observability: { enabled: false }, d1_databases: [db], ...(c.redirect_cache_namespace_id ? { kv_namespaces: [{ binding: 'REDIRECT_CACHE', id: c.redirect_cache_namespace_id }] } : {}) };
  const admin = {
    ...structuredClone(common), name: c.admin_worker_name ?? 'linro-admin', main: 'src/worker/index.ts',
    assets: { directory: './dist', binding: 'ASSETS', not_found_handling: 'single-page-application', run_worker_first: true },
    routes: [{ pattern: c.admin_host, custom_domain: true }],
    vars: { ...security, ENVIRONMENT: 'production', ADMIN_ORIGIN: `https://${c.admin_host}`, ACCESS_ISSUER: c.access_issuer, ACCESS_AUD: c.access_aud, BOOTSTRAP_OWNER_EMAIL: c.owner_email.toLowerCase(), CLOUDFLARE_ACCOUNT_ID: c.account_id, ANALYTICS_ENABLED: String(c.analytics_enabled ?? false), ANALYTICS_DATASET: c.analytics_dataset ?? 'linro_clicks' },
    ratelimits: [
      { name: 'AUTH_LIMITER', namespace_id: String(c.auth_rate_namespace ?? '21001'), simple: { limit: 300, period: 60 } },
      { name: 'WRITE_LIMITER', namespace_id: String(c.write_rate_namespace ?? '21002'), simple: { limit: 120, period: 60 } },
    ],
    ...(c.analytics_enabled ? { triggers: { crons: ['*/15 * * * *'] } } : {}),
  };
  const redirect = {
    ...structuredClone(common), name: c.redirect_worker_name ?? 'linro-redirect', main: 'src/index.ts', routes: c.redirect_hosts.map(pattern => ({ pattern, custom_domain: true })),
    vars: { ...security, ENVIRONMENT: 'production', ADMIN_ORIGIN: `https://${c.admin_host}`, ANALYTICS_ENABLED: String(c.analytics_enabled ?? false) },
    ratelimits: [{ name: 'REDIRECT_LIMITER', namespace_id: String(c.redirect_rate_namespace ?? '21003'), simple: { limit: c.redirect_rate_limit ?? 300, period: 60 } }, { name: 'PASSWORD_LIMITER', namespace_id: String(c.password_rate_namespace ?? '21004'), simple: { limit: c.password_rate_limit ?? 5, period: 60 } }],
    ...(c.analytics_enabled ? { analytics_engine_datasets: [{ binding: 'ANALYTICS', dataset: c.analytics_dataset ?? 'linro_clicks' }] } : {}),
  };
  return { admin, redirect };
}
export const outputPaths = { admin: resolve(ROOT, 'apps/admin/wrangler.jsonc'), redirect: resolve(ROOT, 'apps/redirect/wrangler.jsonc') };
