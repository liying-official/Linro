import { readFile } from 'node:fs/promises';
import { archiveSchedule, outputPaths, validateConfig } from './config-lib.mjs';
try {
  const a = JSON.parse(await readFile(outputPaths.admin, 'utf8'));
  const r = JSON.parse(await readFile(outputPaths.redirect, 'utf8'));
  const check = (value, message) => {
    if (!value) throw new Error(message);
  };
  for (const c of [a, r]) {
    check(
      c.vars?.ENVIRONMENT === 'production',
      'Production deployment may not use development authentication.',
    );
    check(
      c.workers_dev === false && c.preview_urls === false,
      'workers.dev and preview URLs must remain disabled.',
    );
    check(
      /^[a-f0-9]{32}$/.test(c.account_id ?? '') && !/^0+$/.test(c.account_id),
      'Run npm run configure with your real account ID first.',
    );
    check(
      Array.isArray(c.routes) &&
        c.routes.length &&
        c.routes.every(
          (route) => route.custom_domain === true && /^[a-z0-9.-]+$/.test(route.pattern),
        ),
      'Custom Domain routes are required.',
    );
    check(
      !JSON.stringify(c).includes('LOCAL_DEV_TOKEN'),
      'A local development secret is present in production configuration.',
    );
  }
  const flags = a.compatibility_flags === undefined ? [] : a.compatibility_flags;
  const date = a.compatibility_date;
  check(
    typeof date === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(date) &&
      Number.isFinite(Date.parse(date)) &&
      new Date(date).toISOString().slice(0, 10) === date,
    'Admin compatibility_date must be a valid YYYY-MM-DD date.',
  );
  check(
    Array.isArray(flags) &&
      flags.every((flag) => typeof flag === 'string') &&
      !flags.includes('disable_request_signal') &&
      (flags.includes('enable_request_signal') || date >= '2026-11-17'),
    'Admin incoming request cancellation requires enable_request_signal for compatibility dates before 2026-11-17 and cannot use disable_request_signal.',
  );
  check(
    a.assets?.run_worker_first === true && a.assets?.binding === 'ASSETS',
    'All admin static assets must pass through the Worker authentication gate.',
  );
  check(
    a.vars.ADMIN_ORIGIN === `https://${a.routes[0].pattern}`,
    'ADMIN_ORIGIN does not match its Custom Domain.',
  );
  check(
    !r.routes.some((route) => route.pattern === a.routes[0].pattern),
    'Admin and redirect domains must be separate.',
  );
  check(a.account_id === r.account_id, 'Admin and Redirect account_id must match.');
  check(
    a.vars.CLOUDFLARE_ACCOUNT_ID === a.account_id,
    'Admin CLOUDFLARE_ACCOUNT_ID must match account_id for Analytics queries.',
  );
  const dbBinding = (c) => (c.d1_databases ?? []).filter((entry) => entry.binding === 'DB');
  const [adb, rdb] = [dbBinding(a), dbBinding(r)];
  check(
    adb.length === 1 &&
      rdb.length === 1 &&
      adb[0].database_id === rdb[0].database_id &&
      adb[0].database_name === rdb[0].database_name,
    'The DB binding, database_id and database_name must match across Workers.',
  );
  check(
    /^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(a.vars.ACCESS_ISSUER ?? ''),
    'Missing Access issuer.',
  );
  check(
    /^[A-Za-z0-9_-]{16,256}$/.test(a.vars.ACCESS_AUD ?? '') &&
      !/YOUR|REPLACE/.test(a.vars.ACCESS_AUD),
    'Missing Access audience.',
  );
  check(
    a.ratelimits?.some((x) => x.name === 'WRITE_LIMITER') &&
      a.ratelimits?.some((x) => x.name === 'AUTH_LIMITER'),
    'Rate limiting bindings are required.',
  );
  check(
    r.vars.ADMIN_ORIGIN === a.vars.ADMIN_ORIGIN,
    'Redirect Worker must receive the same ADMIN_ORIGIN for target-policy revalidation.',
  );
  check(a.name !== r.name, 'Admin and redirect Worker names must be different.');
  check(
    (a.vars.SOURCE_URL ?? '') === (r.vars.SOURCE_URL ?? ''),
    'SOURCE_URL must match across both Workers.',
  );
  const names = ['AUTH_LIMITER', 'WRITE_LIMITER', 'REDIRECT_LIMITER', 'PASSWORD_LIMITER'];
  const bindings = [...(a.ratelimits ?? []), ...(r.ratelimits ?? [])];
  check(
    names.every((n) => bindings.filter((b) => b.name === n).length === 1) &&
      r.ratelimits?.some((b) => b.name === 'REDIRECT_LIMITER') &&
      r.ratelimits?.some((b) => b.name === 'PASSWORD_LIMITER'),
    'All four rate limiting bindings are required exactly once.',
  );
  const rate = (name) => bindings.find((b) => b.name === name);
  check(
    names.every(
      (n) =>
        Number.isSafeInteger(rate(n).simple?.limit) &&
        rate(n).simple.limit > 0 &&
        rate(n).simple.period === 60,
    ),
    'Rate limit windows must be 60 seconds with a positive integer limit.',
  );
  for (const key of [
    'BROWSER_TIMEZONE_ENABLED',
    'CLOUDFLARE_DEVICE_TYPE_ENABLED',
    'QUERY_FORWARD_ALLOWLIST',
    'PRIVATE_TARGET_ALLOWLIST',
    'EXPIRED_LINK_STATUS',
    'REDIRECT_CACHE_TTL',
  ]) {
    check(
      typeof a.vars[key] === 'string' && a.vars[key] === r.vars[key],
      `Security policy ${key} must be present and identical on both Workers. Re-run configure.`,
    );
  }
  check(
    ['true', 'false'].includes(a.vars.BROWSER_TIMEZONE_ENABLED),
    'BROWSER_TIMEZONE_ENABLED must be true or false.',
  );
  check(
    !Object.hasOwn(a.vars, 'BROWSER_CHECK_SECRET') &&
      !Object.hasOwn(r.vars, 'BROWSER_CHECK_SECRET'),
    'BROWSER_CHECK_SECRET must be stored as a Worker secret, not in vars.',
  );
  check(
    !Object.hasOwn(a.vars, 'RADAR_API_TOKEN') && !Object.hasOwn(r.vars, 'RADAR_API_TOKEN'),
    'Store RADAR_API_TOKEN as a secret on the Redirect Worker.',
  );
  check(
    ['true', 'false'].includes(a.vars.CLOUDFLARE_DEVICE_TYPE_ENABLED),
    'CLOUDFLARE_DEVICE_TYPE_ENABLED must be true or false.',
  );
  const cache = (c) => (c.kv_namespaces ?? []).filter((b) => b.binding === 'REDIRECT_CACHE');
  check(
    cache(a).length <= 1 &&
      cache(r).length <= 1 &&
      cache(a).length === cache(r).length &&
      cache(a)[0]?.id === cache(r)[0]?.id,
    'Both Workers must use the same optional REDIRECT_CACHE binding, or neither.',
  );
  check(
    !Object.hasOwn(a.vars, 'LINK_PASSWORD_SECRET') &&
      !Object.hasOwn(r.vars, 'LINK_PASSWORD_SECRET'),
    'LINK_PASSWORD_SECRET must be stored as a Worker secret, not in vars.',
  );
  const enabled = a.vars.ANALYTICS_ENABLED;
  check(
    ['true', 'false'].includes(enabled) && enabled === r.vars.ANALYTICS_ENABLED,
    'ANALYTICS_ENABLED must be true or false and match across Workers.',
  );
  // Configurations from before the independent archive switch use the original schedule.
  const rollupEnabled = a.vars.ANALYTICS_ROLLUP_ENABLED ?? enabled;
  const rollupInterval = Number(a.vars.ANALYTICS_ROLLUP_INTERVAL_MINUTES ?? 15);
  check(
    ['true', 'false'].includes(rollupEnabled) && (rollupEnabled !== 'true' || enabled === 'true'),
    'ANALYTICS_ROLLUP_ENABLED requires Analytics when true.',
  );
  const crons = a.triggers?.crons ?? [];
  const expectedCrons = rollupEnabled === 'true' ? [archiveSchedule(rollupInterval)] : [];
  check(
    Array.isArray(crons) && JSON.stringify(crons) === JSON.stringify(expectedCrons),
    'Admin triggers.crons must match the configured Analytics archive schedule.',
  );
  check((r.triggers?.crons ?? []).length === 0, 'Redirect triggers.crons must be empty.');
  const writers = (r.analytics_engine_datasets ?? []).filter(
    (binding) => binding.binding === 'ANALYTICS',
  );
  check(
    !(a.analytics_engine_datasets ?? []).some((binding) => binding.binding === 'ANALYTICS'),
    'Only Redirect may have the ANALYTICS write binding.',
  );
  check(typeof a.vars.ANALYTICS_DATASET === 'string', 'Admin ANALYTICS_DATASET is required.');
  if (enabled === 'true') {
    check(
      writers.length === 1,
      'Redirect requires exactly one ANALYTICS binding when Analytics is enabled.',
    );
    check(
      writers[0].dataset === a.vars.ANALYTICS_DATASET,
      'Redirect ANALYTICS dataset must match Admin ANALYTICS_DATASET.',
    );
  } else {
    check(
      writers.length === 0,
      'Remove the Redirect ANALYTICS write binding when Analytics is disabled.',
    );
  }
  validateConfig({
    account_id: a.account_id,
    database_id: adb[0].database_id,
    database_name: adb[0].database_name,
    analytics_dataset: a.vars.ANALYTICS_DATASET,
    analytics_enabled: enabled === 'true',
    analytics_rollup_enabled: rollupEnabled === 'true',
    analytics_rollup_interval_minutes: rollupInterval,
    analytics_rollup_recheck_hours: Number(a.vars.ANALYTICS_ROLLUP_RECHECK_HOURS ?? 6),
    admin_worker_name: a.name,
    redirect_worker_name: r.name,
    source_url: a.vars.SOURCE_URL ?? '',
    admin_host: a.routes[0].pattern,
    redirect_hosts: r.routes.map((route) => route.pattern),
    access_issuer: a.vars.ACCESS_ISSUER,
    access_aud: a.vars.ACCESS_AUD,
    owner_email: a.vars.BOOTSTRAP_OWNER_EMAIL,
    browser_timezone_enabled: a.vars.BROWSER_TIMEZONE_ENABLED === 'true',
    cloudflare_device_type_enabled: a.vars.CLOUDFLARE_DEVICE_TYPE_ENABLED === 'true',
    auth_rate_namespace: rate('AUTH_LIMITER').namespace_id,
    write_rate_namespace: rate('WRITE_LIMITER').namespace_id,
    redirect_rate_namespace: rate('REDIRECT_LIMITER').namespace_id,
    redirect_rate_limit: rate('REDIRECT_LIMITER').simple.limit,
    password_rate_namespace: rate('PASSWORD_LIMITER').namespace_id,
    password_rate_limit: rate('PASSWORD_LIMITER').simple.limit,
    redirect_cache_namespace_id: cache(a)[0]?.id ?? '',
    redirect_cache_ttl: Number(a.vars.REDIRECT_CACHE_TTL),
    query_forward_allowlist: JSON.parse(a.vars.QUERY_FORWARD_ALLOWLIST),
    private_target_allowlist: JSON.parse(a.vars.PRIVATE_TARGET_ALLOWLIST),
    expired_link_status: Number(a.vars.EXPIRED_LINK_STATUS),
  });
  if (!a.vars.SOURCE_URL)
    console.warn(
      'Before network use: publish Corresponding Source and set source_url (AGPL-3.0-only, see docs/LICENSING.md). No archive is uploaded by this check.',
    );
  console.log(
    'Configuration preflight passed. This is a local check, not a Cloudflare account/DNS/Access connectivity test.',
  );
} catch (error) {
  console.error('Preflight blocked deployment:', error.message);
  process.exitCode = 1;
}
