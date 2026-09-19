import { readFile } from 'node:fs/promises';
import { outputPaths, validateConfig } from './config-lib.mjs';
try {
  const a = JSON.parse(await readFile(outputPaths.admin, 'utf8'));
  const r = JSON.parse(await readFile(outputPaths.redirect, 'utf8'));
  const check = (value, message) => { if (!value) throw new Error(message); };
  for (const c of [a, r]) {
    check(c.vars?.ENVIRONMENT === 'production', 'Production deployment may not use development authentication.');
    check(c.workers_dev === false && c.preview_urls === false, 'workers.dev and preview URLs must remain disabled.');
    check(/^[a-f0-9]{32}$/.test(c.account_id ?? '') && !/^0+$/.test(c.account_id), 'Run npm run configure with your real account ID first.');
    check(Array.isArray(c.routes) && c.routes.length && c.routes.every(route => route.custom_domain === true && /^[a-z0-9.-]+$/.test(route.pattern)), 'Custom Domain routes are required.');
    check(!JSON.stringify(c).includes('LOCAL_DEV_TOKEN'), 'A local development secret is present in production configuration.');
  }
  check(a.assets?.run_worker_first === true && a.assets?.binding === 'ASSETS', 'All admin static assets must pass through the Worker authentication gate.');
  check(a.vars.ADMIN_ORIGIN === `https://${a.routes[0].pattern}`, 'ADMIN_ORIGIN does not match its Custom Domain.');
  check(!r.routes.some(route => route.pattern === a.routes[0].pattern), 'Admin and redirect domains must be separate.');
  check(a.d1_databases?.[0]?.database_id === r.d1_databases?.[0]?.database_id, 'Both Workers must reference the same D1 database.');
  check(/^[a-f0-9-]{36}$/.test(a.d1_databases?.[0]?.database_id ?? ''), 'Invalid D1 database ID.');
  check(/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(a.vars.ACCESS_ISSUER ?? ''), 'Missing Access issuer.');
  check(/^[A-Za-z0-9_-]{16,256}$/.test(a.vars.ACCESS_AUD ?? '') && !/YOUR|REPLACE/.test(a.vars.ACCESS_AUD), 'Missing Access audience.');
  check(a.ratelimits?.some(x => x.name === 'WRITE_LIMITER') && a.ratelimits?.some(x => x.name === 'AUTH_LIMITER'), 'Rate limiting bindings are required.');
  check(r.vars.ADMIN_ORIGIN === a.vars.ADMIN_ORIGIN, 'Redirect Worker must receive the same ADMIN_ORIGIN for target-policy revalidation.');
  check(a.name !== r.name, 'Admin and redirect Worker names must be different.');
  check((a.vars.SOURCE_URL ?? '') === (r.vars.SOURCE_URL ?? ''), 'SOURCE_URL must match across both Workers.');
  const names = ['AUTH_LIMITER', 'WRITE_LIMITER', 'REDIRECT_LIMITER', 'PASSWORD_LIMITER'];
  const bindings = [...(a.ratelimits ?? []), ...(r.ratelimits ?? [])];
  check(names.every(n => bindings.filter(b => b.name === n).length === 1) && r.ratelimits?.some(b => b.name === 'REDIRECT_LIMITER') && r.ratelimits?.some(b => b.name === 'PASSWORD_LIMITER'), 'All four rate limiting bindings are required exactly once.');
  const rate = name => bindings.find(b => b.name === name);
  check(names.every(n => Number.isSafeInteger(rate(n).simple?.limit) && rate(n).simple.limit > 0 && rate(n).simple.period === 60), 'Rate limit windows must be 60 seconds with a positive integer limit.');
  for (const key of ['BROWSER_TIMEZONE_ENABLED', 'CLOUDFLARE_DEVICE_TYPE_ENABLED', 'QUERY_FORWARD_ALLOWLIST', 'PRIVATE_TARGET_ALLOWLIST', 'EXPIRED_LINK_STATUS', 'REDIRECT_CACHE_TTL']) {
    check(typeof a.vars[key] === 'string' && a.vars[key] === r.vars[key], `Security policy ${key} must be present and identical on both Workers. Re-run configure.`);
  }
  check(['true', 'false'].includes(a.vars.BROWSER_TIMEZONE_ENABLED), 'BROWSER_TIMEZONE_ENABLED must be true or false.');
  check(!Object.hasOwn(a.vars, 'BROWSER_CHECK_SECRET') && !Object.hasOwn(r.vars, 'BROWSER_CHECK_SECRET'), 'BROWSER_CHECK_SECRET must be stored as a Worker secret, not in vars.');
  check(['true', 'false'].includes(a.vars.CLOUDFLARE_DEVICE_TYPE_ENABLED), 'CLOUDFLARE_DEVICE_TYPE_ENABLED must be true or false.');
  const cache = c => (c.kv_namespaces ?? []).filter(b => b.binding === 'REDIRECT_CACHE');
  check(cache(a).length <= 1 && cache(r).length <= 1 && cache(a).length === cache(r).length && cache(a)[0]?.id === cache(r)[0]?.id, 'Both Workers must use the same optional REDIRECT_CACHE binding, or neither.');
  check(!Object.hasOwn(a.vars, 'LINK_PASSWORD_SECRET') && !Object.hasOwn(r.vars, 'LINK_PASSWORD_SECRET'), 'LINK_PASSWORD_SECRET must be stored as a Worker secret, not in vars.');
  validateConfig({ account_id: a.account_id, database_id: a.d1_databases[0].database_id,
    admin_worker_name: a.name, redirect_worker_name: r.name, source_url: a.vars.SOURCE_URL ?? '',
    admin_host: a.routes[0].pattern, redirect_hosts: r.routes.map(route => route.pattern),
    access_issuer: a.vars.ACCESS_ISSUER, access_aud: a.vars.ACCESS_AUD, owner_email: a.vars.BOOTSTRAP_OWNER_EMAIL,
    browser_timezone_enabled: a.vars.BROWSER_TIMEZONE_ENABLED === 'true',
    cloudflare_device_type_enabled: a.vars.CLOUDFLARE_DEVICE_TYPE_ENABLED === 'true',
    auth_rate_namespace: rate('AUTH_LIMITER').namespace_id, write_rate_namespace: rate('WRITE_LIMITER').namespace_id,
    redirect_rate_namespace: rate('REDIRECT_LIMITER').namespace_id, redirect_rate_limit: rate('REDIRECT_LIMITER').simple.limit,
    password_rate_namespace: rate('PASSWORD_LIMITER').namespace_id, password_rate_limit: rate('PASSWORD_LIMITER').simple.limit,
    redirect_cache_namespace_id: cache(a)[0]?.id ?? '', redirect_cache_ttl: Number(a.vars.REDIRECT_CACHE_TTL),
    query_forward_allowlist: JSON.parse(a.vars.QUERY_FORWARD_ALLOWLIST), private_target_allowlist: JSON.parse(a.vars.PRIVATE_TARGET_ALLOWLIST), expired_link_status: Number(a.vars.EXPIRED_LINK_STATUS),
  });
  check(a.vars.ANALYTICS_ENABLED === r.vars.ANALYTICS_ENABLED, 'Analytics flags differ across Workers.');
  if (!a.vars.SOURCE_URL) console.warn('Before network use: publish Corresponding Source and set source_url (AGPL-3.0-only, see docs/LICENSING.md). No archive is uploaded by this check.');
  console.log('Configuration preflight passed. This is a local check, not a Cloudflare account/DNS/Access connectivity test.');
} catch (error) { console.error('Preflight blocked deployment:', error.message); process.exitCode = 1; }
