// SPDX-License-Identifier: AGPL-3.0-only
// Linro modifications: 2026-09-18; inherited attribution is in NOTICE.
import type { Context, RedirectEnv, Link } from '../../../packages/shared/src/platform.js';
import { addSourceLink } from '../../../packages/shared/src/legal.js';
import { VERSION } from '../../../packages/shared/src/platform.js';
import {
  buildTarget,
  cacheControl,
  slug,
  targetURL,
} from '../../../packages/shared/src/validation.js';
import {
  validateDestination,
  validateDestinationHost,
} from '../../../packages/shared/src/destination.js';
import { canonicalHost, securityPolicy } from '../../../packages/shared/src/policy.js';
import { sha256 } from '../../../packages/shared/src/crypto.js';
import { errorResponse, HttpError, nowSeconds, secure } from '../../../packages/shared/src/http.js';
import { MAX_URL_CHARS } from '../../../packages/shared/src/limits.js';
import { lookupRedirect } from '../../../packages/shared/src/redirect-cache.js';
import { chooseGeoTarget, storedGeoRules } from '../../../packages/shared/src/geo.js';
import {
  hasUnlockCookie,
  issueUnlockCookie,
  passwordsConfigured,
  validPasswordHash,
  verifyLinkPassword,
} from '../../../packages/shared/src/link-password.js';
import {
  limitResponse,
  passwordPage,
  PASSWORD_CSS,
  PASSWORD_JS,
  readPasswordForm,
  unlockForbiddenResponse,
} from './public-pages.js';
import { plainText, responseMode } from '../../../packages/shared/src/text-response.js';
import { visitorDimensions } from '../../../packages/shared/src/visitor-dimensions.js';
import { radarClassification } from '../../../packages/shared/src/radar-asn.js';
import { LATENCY_PATH, latencyResult } from '../../../packages/shared/src/vpn-latency.js';
import {
  BROWSER_CHECK_MARKER,
  browserChecksConfigured,
  collectsBrowserTimezone,
  cleanBrowserURL,
  clearBrowserCookie,
  issueBrowserCookie,
  observeBrowser,
  readBrowserCookie,
  validateBrowserChallenge,
  type BrowserObservation,
} from '../../../packages/shared/src/browser-check.js';
import {
  browserCheckPage,
  browserDenied,
  BROWSER_JS,
  latencyProbe,
  prefersJSON,
  readBrowserForm,
} from './browser-page.js';
import { isSameOriginUnlock } from './unlock-origin.js';
import { PUBLIC_ASSETS } from './public-asset-paths.js';

type LookupResult = Awaited<ReturnType<typeof lookupRedirect>>;
type RedirectPolicy = ReturnType<typeof securityPolicy>;

interface RequestRoute {
  url: URL;
  browserPost?: string;
  unlock?: string;
  rejection?: Response;
}

interface BrowserFlowResult {
  enabled: boolean;
  observation?: BrowserObservation;
  response?: Response;
}

function reply(message: string, status: number, extra: Record<string, string> = {}): Response {
  return new Response(message, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extra,
    },
  });
}

function record(
  env: RedirectEnv,
  request: Request,
  link: Link,
  observation?: BrowserObservation,
  event: 'success' | 'vpn_blocked' | 'unknown_blocked' = 'success',
): void {
  // Successful GETs retain the original double1 contract. Terminal browser-check
  // denials are separate events with double1=0; intermediate pages/303s do not log.
  if (
    env.ANALYTICS_ENABLED !== 'true' ||
    !env.ANALYTICS ||
    (request.method !== 'GET' && !(request.method === 'POST' && event !== 'success'))
  ) {
    return;
  }
  try {
    observation ??= observeBrowser(request);
    const cf = (request as Request & { cf?: { country?: string } }).cf;
    const dimensions = visitorDimensions(request, env);
    let referrer = '';
    try {
      referrer = new URL(request.headers.get('referer') ?? '').hostname.slice(0, 253);
    } catch {
      // Absent or invalid.
    }
    if (observation.referrer !== undefined) referrer = observation.referrer;
    const userAgent = request.headers.get('user-agent') ?? '';
    const agent = /bot|spider|crawler|headless/i.test(userAgent)
      ? 'bot'
      : /Edg\//.test(userAgent)
        ? 'Edge'
        : /Firefox\//.test(userAgent)
          ? 'Firefox'
          : /Chrome\//.test(userAgent)
            ? 'Chrome'
            : /Safari\//.test(userAgent)
              ? 'Safari'
              : 'other';
    // writeDataPoint is synchronous and non-blocking; it is NOT a Promise.
    env.ANALYTICS.writeDataPoint({
      indexes: [link.id],
      blobs: [
        link.hostname ?? '',
        link.slug,
        cf?.country ?? 'XX',
        referrer,
        agent,
        dimensions.timezone,
        dimensions.device,
        link.response_mode,
        observation.browserTimezone,
        observation.reason,
        event,
      ],
      doubles: [
        event === 'success' ? 1 : 0,
        event === 'success' ? (link.response_mode === 'text' ? 200 : link.redirect_code) : 403,
        observation.suspected ? 1 : 0,
        event === 'vpn_blocked' ? 1 : 0,
        event === 'unknown_blocked' && observation.reason === 'unknown' ? 1 : 0,
        event === 'success' && observation.reason === 'unknown' ? 1 : 0,
        observation.tor ? 1 : 0,
      ],
    });
  } catch {
    console.warn(JSON.stringify({ event: 'analytics_write_failed' }));
  }
}

function denyBrowserPolicy(
  request: Request,
  env: RedirectEnv,
  link: Link,
  observation: BrowserObservation,
  logEvent = true,
): Response {
  if (logEvent)
    record(
      env,
      request,
      link,
      observation,
      observation.suspected ? 'vpn_blocked' : 'unknown_blocked',
    );
  return browserDenied(request, observation.suspected ? 'vpn' : 'unknown', link.slug);
}

async function consumeQuota(
  env: RedirectEnv,
  link: Link,
  host: string,
  targetHost: string | null,
  request: Request,
): Promise<Response | null> {
  if (link.max_redirects !== null) {
    // One atomic conditional write. Never read-then-UPDATE an unchecked counter,
    // never use KV/AE, and never retry an ambiguous commit. Both GET and HEAD
    // consume one slot for a final authorized redirect or plain-text response.
    const accepted = await env.DB.prepare(
      `UPDATE links SET redirect_count=redirect_count+1
      WHERE id=? AND version=? AND rule_revision=? AND enabled=1
        AND max_redirects IS NOT NULL AND redirect_count<max_redirects
        AND (expires_at IS NULL OR expires_at>unixepoch())
        AND EXISTS(SELECT 1 FROM domains d
          WHERE d.id=links.domain_id AND d.hostname=? AND d.enabled=1)
        AND (? IS NULL OR NOT EXISTS(SELECT 1 FROM domains WHERE hostname=?))
      RETURNING redirect_count`,
    )
      .bind(link.id, link.version, link.rule_revision, host, targetHost, targetHost)
      .first<{ redirect_count: number }>();
    if (!accepted) {
      const fresh = await env.DB.prepare(
        `SELECT max_redirects,redirect_count FROM links
        WHERE id=? AND version=? AND rule_revision=?`,
      )
        .bind(link.id, link.version, link.rule_revision)
        .first<{ max_redirects: number | null; redirect_count: number }>();
      if (
        fresh?.max_redirects !== null &&
        fresh?.max_redirects !== undefined &&
        fresh.redirect_count >= fresh.max_redirects
      ) {
        return limitResponse(request);
      }
      return reply('Link changed. Please retry.', 503, { 'Retry-After': '1' });
    }
  } else if (collectsBrowserTimezone(env) || link.block_vpn || link.password_hash !== null) {
    // A second primary read at the final boundary catches a rule/policy change
    // during challenge/proof validation, including text contents and passwords.
    // This is not a promise to cancel a response already authorized in flight.
    const current = await env.DB.prepare(
      `SELECT id FROM links
      WHERE id=? AND version=? AND rule_revision=? AND enabled=1
        AND (expires_at IS NULL OR expires_at>unixepoch())
        AND EXISTS(SELECT 1 FROM domains d
          WHERE d.id=links.domain_id AND d.hostname=? AND d.enabled=1)
        AND (? IS NULL OR NOT EXISTS(SELECT 1 FROM domains WHERE hostname=?))`,
    )
      .bind(link.id, link.version, link.rule_revision, host, targetHost, targetHost)
      .first();
    if (!current) return reply('Link changed. Please retry.', 503, { 'Retry-After': '1' });
  }
  return null;
}

function parseRequestRoute(request: Request): RequestRoute {
  const url = new URL(request.url);
  const browserPath = /^\/__Linro_browser\/([A-Za-z0-9_-]{1,64})$/.exec(url.pathname)?.[1];
  const isLatencyProbe = url.pathname === LATENCY_PATH;
  if ((browserPath || isLatencyProbe) && request.method !== 'POST') {
    return { url, rejection: reply('Method Not Allowed', 405, { Allow: 'POST' }) };
  }
  const browserPost = request.method === 'POST' ? browserPath : undefined;
  const unlockPath = /^\/__Linro_unlock\/([A-Za-z0-9_-]{1,64})$/.exec(url.pathname)?.[1];
  // Uniform method response, including unknown slugs: no D1 lookup or disclosure.
  if (unlockPath && request.method !== 'POST') {
    return { url, rejection: reply('Method Not Allowed', 405, { Allow: 'POST' }) };
  }
  const unlock = request.method === 'POST' ? unlockPath : undefined;
  if (!['GET', 'HEAD'].includes(request.method) && !unlock && !browserPost && !isLatencyProbe) {
    return { url, rejection: reply('Method Not Allowed', 405, { Allow: 'GET, HEAD' }) };
  }
  return { url, browserPost, unlock };
}

async function enforceRedirectRateLimit(
  request: Request,
  env: RedirectEnv,
): Promise<Response | null> {
  // Runs before any D1 lookup, including unknown-slug scans. These best-effort
  // counters are per Cloudflare location, not a global request/quota firewall.
  if (!env.REDIRECT_LIMITER && env.ENVIRONMENT !== 'development') {
    return reply('Service temporarily unavailable.', 503, { 'Retry-After': '5' });
  }
  if (!env.REDIRECT_LIMITER) return null;
  try {
    // Do not accept X-Forwarded-For or visitor-selected slug/query keys.
    const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
    const limited = await env.REDIRECT_LIMITER.limit({ key: 'redirect:' + (await sha256(ip)) });
    return limited.success ? null : reply('Too Many Requests', 429, { 'Retry-After': '60' });
  } catch {
    return reply('Service temporarily unavailable.', 503, { 'Retry-After': '5' });
  }
}

const publicAssetContents = {
  'password.css': PASSWORD_CSS,
  'password.js': PASSWORD_JS,
  'browser.js': BROWSER_JS,
};
function publicEndpoint(url: URL): Response | null {
  if (url.pathname === '/health') {
    return new Response(JSON.stringify({ status: 'ok', version: VERSION }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
  if (url.pathname.startsWith('/__Linro_assets/')) {
    for (const name of Object.keys(PUBLIC_ASSETS) as (keyof typeof PUBLIC_ASSETS)[]) {
      const immutable = url.pathname === PUBLIC_ASSETS[name];
      if (immutable || url.pathname === '/__Linro_assets/' + name) {
        const type = name.endsWith('.css') ? 'text/css' : 'application/javascript';
        return new Response(publicAssetContents[name], {
          headers: {
            'Content-Type': type + '; charset=utf-8',
            'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-store',
          },
        });
      }
    }
    return reply('Not Found', 404);
  }
  if (url.pathname === '/robots.txt') return reply('User-agent: *\nDisallow: /\n', 200);
  if (url.pathname === '/') return reply('Linro — private link directory', 200);
  return null;
}

function invalidLinkResponse(link: Link): Response | null {
  if (
    ![0, 1].includes(link.block_vpn) ||
    !Number.isSafeInteger(link.cache_ttl) ||
    link.cache_ttl < 0 ||
    link.cache_ttl > 3600 ||
    ![301, 302, 307, 308].includes(link.redirect_code) ||
    !['discard', 'replace', 'merge'].includes(link.query_mode) ||
    (link.expires_at !== null && !Number.isSafeInteger(link.expires_at)) ||
    (link.max_redirects !== null &&
      (!Number.isSafeInteger(link.max_redirects) ||
        link.max_redirects < 1 ||
        link.max_redirects > 1_000_000_000)) ||
    !Number.isSafeInteger(link.redirect_count) ||
    link.redirect_count < 0 ||
    !Number.isSafeInteger(link.rule_revision) ||
    link.rule_revision < 1 ||
    (link.password_hash !== null && !validPasswordHash(link.password_hash))
  ) {
    return reply('Invalid link configuration.', 503);
  }
  try {
    responseMode(link.response_mode);
    if (link.response_mode === 'text') {
      plainText(link.text_content);
      if (storedGeoRules(link.geo_rules).length || link.query_mode !== 'discard') {
        return reply('Invalid link configuration.', 503);
      }
    }
  } catch {
    return reply('Invalid link configuration.', 503);
  }
  return null;
}

async function handleUnlockFlow(
  request: Request,
  env: RedirectEnv,
  url: URL,
  link: Link,
  keyword: string,
  unlock: string | undefined,
  browserPost: string | undefined,
): Promise<Response | null> {
  if (link.password_hash === null) {
    return unlock ? reply('Method Not Allowed', 405, { Allow: 'GET, HEAD' }) : null;
  }
  if (!passwordsConfigured(env)) {
    return reply('Link password service is not configured.', 503, { 'Retry-After': '5' });
  }
  if (env.ENVIRONMENT !== 'development' && url.protocol !== 'https:') {
    return reply('HTTPS is required.', 400);
  }
  if (unlock) {
    if (!isSameOriginUnlock(request)) return unlockForbiddenResponse(request);
    if (!env.PASSWORD_LIMITER && env.ENVIRONMENT !== 'development') {
      return reply('Password rate limiting is not configured.', 503);
    }
    if (env.PASSWORD_LIMITER) {
      try {
        // One IP bucket across all slugs: varying slugs cannot increase the
        // password-hashing allowance. Outer redirect limiter applies as well.
        const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
        const key = 'password:' + (await sha256(ip));
        if (!(await env.PASSWORD_LIMITER.limit({ key })).success) {
          return reply('Too Many Requests', 429, { 'Retry-After': '60' });
        }
      } catch {
        return reply('Service temporarily unavailable.', 503, { 'Retry-After': '5' });
      }
    }
    const password = await readPasswordForm(request);
    if (!(await verifyLinkPassword(password, link.password_hash, env))) {
      return passwordPage(request, keyword, true, env.SOURCE_URL);
    }
    // Neither unlock response consumes quota or records redirect analytics.
    // The next GET revalidates the rule and sends no password body to targets,
    // including when the link is configured as 307/308.
    const next = '/' + keyword + url.search;
    const headers: Record<string, string> = {
      'Set-Cookie': await issueUnlockCookie(link, url.host, env),
      'Cache-Control': 'no-store',
      'CDN-Cache-Control': 'no-store',
      Vary: 'Accept',
    };
    if (prefersJSON(request)) {
      headers['Content-Type'] = 'application/json; charset=utf-8';
      return new Response(JSON.stringify({ ok: true, data: { next } }), { headers });
    }
    return new Response(null, { status: 303, headers: { ...headers, Location: next } });
  }
  if (!(await hasUnlockCookie(request, link, env))) {
    return browserPost
      ? browserDenied(request, 'required', link.slug)
      : passwordPage(request, keyword, false, env.SOURCE_URL);
  }
  return null;
}

async function handleBrowserFlow(
  request: Request,
  env: RedirectEnv,
  url: URL,
  link: Link,
  keyword: string,
  browserPost: string | undefined,
): Promise<BrowserFlowResult> {
  const enabled = collectsBrowserTimezone(env) || !!link.block_vpn;
  if (!browserPost && !(enabled && (request.method === 'GET' || !!link.block_vpn))) {
    return { enabled };
  }
  let observation = observeBrowser(request);
  if (!enabled) {
    return {
      enabled,
      observation,
      response: reply('Method Not Allowed', 405, { Allow: 'GET, HEAD' }),
    };
  }
  if (!browserChecksConfigured(env)) {
    return {
      enabled,
      observation,
      response: reply('Browser timezone service is not configured.', 503, { 'Retry-After': '5' }),
    };
  }
  if (env.ENVIRONMENT !== 'development' && url.protocol !== 'https:') {
    return { enabled, observation, response: reply('HTTPS is required.', 400) };
  }
  if (browserPost) {
    if (!isSameOriginUnlock(request)) {
      return { enabled, observation, response: browserDenied(request, 'invalid', link.slug) };
    }
    const form = await readBrowserForm(request, !!link.block_vpn);
    const challenge = await validateBrowserChallenge(form.challenge, request, link, env);
    if (!challenge) {
      return { enabled, observation, response: browserDenied(request, 'invalid', link.slug) };
    }
    observation = observeBrowser(request, form.timezone, challenge.referrer);
    if (link.block_vpn && observation.reason === 'match') {
      observation.reason = await latencyResult(
        env.BROWSER_CHECK_SECRET!,
        form.challenge,
        form.latency,
      );
      observation.suspected = observation.reason === 'latency_mismatch';
    }
    if (link.block_vpn && observation.reason !== 'match') {
      return { enabled, observation, response: denyBrowserPolicy(request, env, link, observation) };
    }
    const resume = cleanBrowserURL(request);
    resume.pathname = '/' + keyword;
    resume.searchParams.set(BROWSER_CHECK_MARKER, '1');
    // Negotiate only the success representation after the same source,
    // password, challenge and policy checks. Neither form spends quota here.
    const next = resume.pathname + resume.search;
    const headers: Record<string, string> = {
      'Set-Cookie': await issueBrowserCookie(challenge, observation.browserTimezone, link, env),
      'Cache-Control': 'no-store',
      'CDN-Cache-Control': 'no-store',
      Vary: 'Accept',
    };
    if (prefersJSON(request)) {
      headers['Content-Type'] = 'application/json; charset=utf-8';
      return {
        enabled,
        observation,
        response: new Response(JSON.stringify({ ok: true, data: { next } }), {
          status: 200,
          headers,
        }),
      };
    }
    // Legacy form clients retain the original same-origin 303. A real browser
    // may block the later cross-origin hop; scripts use ordinary navigation.
    return {
      enabled,
      observation,
      response: new Response(null, { status: 303, headers: { ...headers, Location: next } }),
    };
  }
  const proof = await readBrowserCookie(request, link, env);
  if (!proof) {
    // A completion marker is not evidence. Stop cookie-blocked or expired loops
    // without ever allowing a protected target or consuming quota.
    const response = url.searchParams.has(BROWSER_CHECK_MARKER)
      ? browserDenied(request, 'invalid', link.slug)
      : request.method === 'HEAD'
        ? browserDenied(request, 'required', link.slug)
        : await browserCheckPage(request, link, env);
    return { enabled, observation, response };
  }
  observation = proof;
  if (link.block_vpn && proof.reason !== 'match') {
    return { enabled, observation, response: denyBrowserPolicy(request, env, link, proof) };
  }
  return { enabled, observation };
}

function finishBrowserFlow(
  response: Response,
  browserFlow: boolean,
  url: URL,
  link: Link,
  env: RedirectEnv,
): Response {
  if (browserFlow && url.searchParams.has(BROWSER_CHECK_MARKER)) {
    response.headers.append('Set-Cookie', clearBrowserCookie(link, env));
  }
  return response;
}

async function emitLinkResponse(
  request: Request,
  env: RedirectEnv,
  url: URL,
  link: Link,
  lookup: LookupResult,
  policy: RedirectPolicy,
  now: number,
  browserFlow: boolean,
  observation?: BrowserObservation,
): Promise<Response> {
  if (link.response_mode === 'text') {
    const response = finishBrowserFlow(
      reply(link.text_content, 200, {
        'CDN-Cache-Control': 'no-store',
        'Cloudflare-CDN-Cache-Control': 'no-store',
      }),
      browserFlow,
      url,
      link,
      env,
    );
    const rejected = await consumeQuota(env, link, url.hostname.toLowerCase(), null, request);
    if (rejected) return rejected;
    record(env, request, link, observation);
    return response;
  }

  const rules = storedGeoRules(link.geo_rules);
  const selected = chooseGeoTarget(rules, link.target_url, request);
  let stored: string;
  try {
    stored = targetURL(selected);
    const selectedHost = validateDestinationHost(stored, env);
    if (lookup.checkedHost === selectedHost) {
      if (lookup.targetManaged) {
        return reply('Invalid link configuration.', 503, { 'Retry-After': '5' });
      }
    } else if (!browserFlow && link.max_redirects === null && link.password_hash === null) {
      // A regional or unindexed destination needs its own check. Quota and
      // protected redirects check this exact host in the final D1 statement.
      await validateDestination(env.DB, stored, env);
    }
  } catch {
    return reply('Invalid link configuration.', 503, { 'Retry-After': '5' });
  }
  const incoming = cleanBrowserURL(request);
  incoming.searchParams.delete('_Linro_lang');
  const target = buildTarget(stored, incoming, link.query_mode, policy.queryKeys);
  const parsed = new URL(target);
  if (parsed.hostname === url.hostname && parsed.pathname === url.pathname) {
    return reply('Redirect loop detected.', 508);
  }
  const controlled =
    browserFlow || rules.length > 0 || link.password_hash !== null || link.max_redirects !== null;
  const response = finishBrowserFlow(
    new Response(null, {
      status: link.redirect_code,
      headers: {
        Location: target,
        'Cache-Control': controlled
          ? 'no-store, max-age=0'
          : cacheControl(link.cache_ttl, link.expires_at, now),
        'CDN-Cache-Control': 'no-store',
        'Cloudflare-CDN-Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      },
    }),
    browserFlow,
    url,
    link,
    env,
  );
  const rejected = await consumeQuota(
    env,
    link,
    url.hostname.toLowerCase(),
    canonicalHost(parsed.hostname),
    request,
  );
  if (rejected) return rejected;
  // Everything that can reject the redirect precedes the counter commit.
  // Client disconnects or failures at the destination cannot be observed here.
  record(env, request, link, observation);
  return response;
}

async function handle(request: Request, env: RedirectEnv, context?: Context): Promise<Response> {
  const route = parseRequestRoute(request);
  if (route.rejection) return route.rejection;
  const rateLimitResponse = await enforceRedirectRateLimit(request, env);
  if (rateLimitResponse) return rateLimitResponse;
  const publicResponse = publicEndpoint(route.url);
  if (publicResponse) return publicResponse;
  if (route.url.href.length > MAX_URL_CHARS) return reply('URI Too Long', 414);
  if (route.url.pathname === LATENCY_PATH) return latencyProbe(request, env);

  let keyword: string;
  try {
    keyword = slug(route.unlock ?? route.browserPost ?? route.url.pathname.slice(1));
  } catch {
    return reply('Not Found', 404);
  }
  const lookup = await lookupRedirect(
    env,
    route.url.hostname.toLowerCase(),
    keyword,
    request,
    context,
  );
  const link = lookup.link;
  if (!link || !link.enabled) return reply('Not Found', 404);

  const now = nowSeconds();
  const policy = securityPolicy(env);
  if (link.expires_at !== null && link.expires_at <= now) {
    return policy.expiredStatus === 410
      ? reply('This link has expired.', 410)
      : reply('Not Found', 404);
  }
  // Validate persisted fields before any password or limit decision. Database
  // errors and malformed security records never make protected links public.
  const invalid = invalidLinkResponse(link);
  if (invalid) return invalid;
  if (link.max_redirects !== null && link.redirect_count >= link.max_redirects) {
    return limitResponse(request);
  }
  if (link.block_vpn) {
    const observation = observeBrowser(request);
    const category = observation.tor ? null : await radarClassification(request, env);
    if (category !== 'ACCESS_ISP' && category !== 'ORGANIZATION') {
      if (category === 'HOSTING_CLOUD_CONTENT') {
        observation.reason = 'asn_category';
        observation.suspected = true;
      } else if (!observation.tor) {
        observation.reason = 'asn_unavailable';
      }
      return denyBrowserPolicy(request, env, link, observation, !route.unlock);
    }
  }

  const unlockResponse = await handleUnlockFlow(
    request,
    env,
    route.url,
    link,
    keyword,
    route.unlock,
    route.browserPost,
  );
  if (unlockResponse) return unlockResponse;
  const browser = await handleBrowserFlow(
    request,
    env,
    route.url,
    link,
    keyword,
    route.browserPost,
  );
  if (browser.response) return browser.response;
  return emitLinkResponse(
    request,
    env,
    route.url,
    link,
    lookup,
    policy,
    now,
    browser.enabled,
    browser.observation,
  );
}

export default {
  async fetch(request: Request, env: RedirectEnv, context?: Context): Promise<Response> {
    const requestId = crypto.randomUUID();
    let response: Response;
    try {
      response = await handle(request, env, context);
    } catch (error) {
      if (!(error instanceof HttpError)) {
        console.error(JSON.stringify({ event: 'redirect_lookup_failed', request_id: requestId }));
        response = reply('Service temporarily unavailable.', 503, { 'Retry-After': '5' });
      } else {
        response = errorResponse(error, requestId);
      }
    }
    response = secure(addSourceLink(response, env.SOURCE_URL), requestId, request);
    return request.method === 'HEAD'
      ? new Response(null, { status: response.status, headers: response.headers })
      : response;
  },
};
