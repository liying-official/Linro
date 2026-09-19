// SPDX-License-Identifier: AGPL-3.0-only
// Linro modifications: 2026-09-18; inherited attribution is in NOTICE.
import type { Env, Link, Context } from '../../../packages/shared/src/platform.js';
import { addSourceLink } from '../../../packages/shared/src/legal.js';
import { VERSION } from '../../../packages/shared/src/platform.js';
import { buildTarget, cacheControl, slug, targetURL } from '../../../packages/shared/src/validation.js';
import { validateDestination, validateDestinationHost } from '../../../packages/shared/src/destination.js';
import { securityPolicy, canonicalHost } from '../../../packages/shared/src/policy.js';
import { sha256 } from '../../../packages/shared/src/crypto.js';
import { errorResponse, HttpError, nowSeconds, secure } from '../../../packages/shared/src/http.js';
import { lookupRedirect } from '../../../packages/shared/src/redirect-cache.js';
import { storedGeoRules, chooseGeoTarget } from '../../../packages/shared/src/geo.js';
import { validPasswordHash, passwordsConfigured, hasUnlockCookie, verifyLinkPassword, issueUnlockCookie } from '../../../packages/shared/src/link-password.js';
import { limitResponse, passwordPage, readPasswordForm, PASSWORD_CSS, unlockForbiddenResponse } from './public-pages.js';
import { responseMode, plainText } from '../../../packages/shared/src/text-response.js';
import { visitorDimensions } from '../../../packages/shared/src/visitor-dimensions.js';
import { BROWSER_CHECK_MARKER, browserCollectionEnabled, browserChecksConfigured, observeBrowser, readBrowserCookie, validateBrowserChallenge, issueBrowserCookie, clearBrowserCookie, cleanBrowserURL, type BrowserObservation } from '../../../packages/shared/src/browser-check.js';
import { browserCheckPage, browserDenied, BROWSER_JS, readBrowserForm, prefersJSON } from './browser-page.js';
import { isSameOriginUnlock } from './unlock-origin.js';

function reply(message: string, status: number, extra: Record<string, string> = {}): Response {
  return new Response(message, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...extra } });
}
function record(env: Env, request: Request, link: Link, observation = observeBrowser(request), event: 'success' | 'vpn_blocked' | 'unknown_blocked' = 'success'): void {
  // Successful GETs retain the original double1 contract. Terminal browser-check
  // denials are separate events with double1=0; intermediate pages/303s do not log.
  if (env.ANALYTICS_ENABLED !== 'true' || !env.ANALYTICS || (request.method !== 'GET' && !(request.method === 'POST' && event !== 'success'))) return;
  try {
    const cf = (request as Request & { cf?: { country?: string } }).cf;
    const dimensions = visitorDimensions(request, env);
    let referer = '';
    try { referer = new URL(request.headers.get('referer') ?? '').hostname.slice(0, 253); } catch { /* absent/invalid */ }
    if (observation.referrer !== undefined) referer = observation.referrer;
    const ua = request.headers.get('user-agent') ?? '';
    const agent = /bot|spider|crawler|headless/i.test(ua) ? 'bot' : /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'other';
    // writeDataPoint is synchronous and non-blocking; it is NOT a Promise.
    env.ANALYTICS.writeDataPoint({ indexes: [link.id], blobs: [link.hostname ?? '', link.slug, cf?.country ?? 'XX', referer, agent, dimensions.timezone, dimensions.device, link.response_mode, observation.browserTimezone, observation.reason, event], doubles: [event === 'success' ? 1 : 0, event === 'success' ? (link.response_mode === 'text' ? 200 : link.redirect_code) : 403, observation.suspected ? 1 : 0, event === 'vpn_blocked' ? 1 : 0, event === 'unknown_blocked' ? 1 : 0, event === 'success' && observation.reason === 'unknown' ? 1 : 0, observation.tor ? 1 : 0] });
  } catch { console.warn(JSON.stringify({ event: 'analytics_write_failed' })); }
}
async function consumeQuota(env: Env, link: Link, host: string, targetHost: string | null, request: Request): Promise<Response | null> {
  if (link.max_redirects !== null) {
    // One atomic conditional write. Never read-then-UPDATE an unchecked counter,
    // never use KV/AE, and never retry an ambiguous commit. Both GET and HEAD
    // consume one slot for a final authorized redirect or plain-text response.
    const accepted = await env.DB.prepare(`UPDATE links SET redirect_count=redirect_count+1
      WHERE id=? AND version=? AND rule_revision=? AND enabled=1
        AND max_redirects IS NOT NULL AND redirect_count<max_redirects
        AND (expires_at IS NULL OR expires_at>unixepoch())
        AND EXISTS(SELECT 1 FROM domains d WHERE d.id=links.domain_id AND d.hostname=? AND d.enabled=1)
        AND (? IS NULL OR NOT EXISTS(SELECT 1 FROM domains WHERE hostname=?))
      RETURNING redirect_count`).bind(link.id, link.version, link.rule_revision, host, targetHost, targetHost).first<{ redirect_count: number }>();
    if (!accepted) {
      const fresh = await env.DB.prepare('SELECT max_redirects,redirect_count FROM links WHERE id=? AND version=? AND rule_revision=?')
        .bind(link.id, link.version, link.rule_revision).first<{ max_redirects: number | null; redirect_count: number }>();
      if (fresh?.max_redirects !== null && fresh?.max_redirects !== undefined && fresh.redirect_count >= fresh.max_redirects) return limitResponse(request);
      return reply('Link changed. Please retry.', 503, { 'Retry-After': '1' });
    }
  } else if (browserCollectionEnabled(env) || link.block_vpn) {
    // A second primary read at the final boundary catches a rule/policy change
    // during challenge/proof validation, including text contents and passwords.
    // This is not a promise to cancel a response already authorized in flight.
    const current = await env.DB.prepare(`SELECT id FROM links WHERE id=? AND version=? AND rule_revision=? AND enabled=1
      AND (expires_at IS NULL OR expires_at>unixepoch())
      AND EXISTS(SELECT 1 FROM domains d WHERE d.id=links.domain_id AND d.hostname=? AND d.enabled=1)
      AND (? IS NULL OR NOT EXISTS(SELECT 1 FROM domains WHERE hostname=?))`)
      .bind(link.id, link.version, link.rule_revision, host, targetHost, targetHost).first();
    if (!current) return reply('Link changed. Please retry.', 503, { 'Retry-After': '1' });
  }
  return null;
}
async function handle(request: Request, env: Env, ctx?: Context): Promise<Response> {
  const url = new URL(request.url);
  const browserPath = /^\/__Linro_browser\/([A-Za-z0-9_-]{1,64})$/.exec(url.pathname)?.[1];
  if (browserPath && request.method !== 'POST') return reply('Method Not Allowed', 405, { Allow: 'POST' });
  const browserPost = request.method === 'POST' ? browserPath : undefined;
  const unlockPath = /^\/__Linro_unlock\/([A-Za-z0-9_-]{1,64})$/.exec(url.pathname)?.[1];
  // Uniform method response, including unknown slugs: no D1 lookup or disclosure.
  if (unlockPath && request.method !== 'POST') return reply('Method Not Allowed', 405, { Allow: 'POST' });
  const unlock = request.method === 'POST' ? unlockPath : undefined;
  if (!['GET', 'HEAD'].includes(request.method) && !unlock && !browserPost) return reply('Method Not Allowed', 405, { Allow: 'GET, HEAD' });
  // Runs before any D1 lookup (including unknown-slug scans). These best-effort
  // counters are per Cloudflare location, NOT a global request/quota firewall.
  if (!env.REDIRECT_LIMITER && env.ENVIRONMENT !== 'development') return reply('Service temporarily unavailable.', 503, { 'Retry-After': '5' });
  if (env.REDIRECT_LIMITER) {
    try {
      // Do not accept X-Forwarded-For or visitor-selected slug/query keys.
      const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
      const limited = await env.REDIRECT_LIMITER.limit({ key: 'redirect:' + await sha256(ip) });
      if (!limited.success) return reply('Too Many Requests', 429, { 'Retry-After': '60' });
    } catch { return reply('Service temporarily unavailable.', 503, { 'Retry-After': '5' }); }
  }
  if (url.pathname === '/health') return new Response(JSON.stringify({ status: 'ok', version: VERSION }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  if (url.pathname === '/__Linro_assets/password.css') return new Response(PASSWORD_CSS, { headers: { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-store' } });
  if (url.pathname === '/__Linro_assets/browser.js') return new Response(BROWSER_JS, { headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' } });
  if (url.pathname === '/robots.txt') return reply('User-agent: *\nDisallow: /\n', 200);
  if (url.pathname === '/') return reply('Linro — private link directory', 200);
  if (url.href.length > 8192) return reply('URI Too Long', 414);
  let keyword: string;
  try { keyword = slug(unlock ?? browserPost ?? url.pathname.slice(1)); } catch { return reply('Not Found', 404); }
  const lookup = await lookupRedirect(env, url.hostname.toLowerCase(), keyword, request, ctx);
  const link = lookup.link;
  if (!link || !link.enabled) return reply('Not Found', 404);
  const now = nowSeconds();
  const policy = securityPolicy(env);
  if (link.expires_at !== null && link.expires_at <= now) return policy.expiredStatus === 410 ? reply('This link has expired.', 410) : reply('Not Found', 404);
  // Validate persisted fields before any password/limit decision. Database errors
  // or malformed security records never turn a protected link into a public one.
  if (![0, 1].includes(link.block_vpn) || !Number.isSafeInteger(link.cache_ttl) || link.cache_ttl < 0 || link.cache_ttl > 3600 ||
      ![301, 302, 307, 308].includes(link.redirect_code) || !['discard', 'replace', 'merge'].includes(link.query_mode) ||
      (link.expires_at !== null && !Number.isSafeInteger(link.expires_at)) ||
      (link.max_redirects !== null && (!Number.isSafeInteger(link.max_redirects) || link.max_redirects < 1 || link.max_redirects > 1000000000)) ||
      !Number.isSafeInteger(link.redirect_count) || link.redirect_count < 0 ||
      !Number.isSafeInteger(link.rule_revision) || link.rule_revision < 1 ||
      (link.password_hash !== null && !validPasswordHash(link.password_hash))) return reply('Invalid link configuration.', 503);
  try {
    responseMode(link.response_mode);
    if (link.response_mode === 'text') {
      plainText(link.text_content);
      if (storedGeoRules(link.geo_rules).length || link.query_mode !== 'discard') return reply('Invalid link configuration.', 503);
    }
  } catch { return reply('Invalid link configuration.', 503); }
  if (link.max_redirects !== null && link.redirect_count >= link.max_redirects) return limitResponse(request);
  if (link.block_vpn && observeBrowser(request).tor) {
    if (!unlock) record(env, request, link, observeBrowser(request), 'vpn_blocked');
    return browserDenied(request, 'vpn');
  }
  if (link.password_hash !== null) {
    if (!passwordsConfigured(env)) return reply('Link password service is not configured.', 503, { 'Retry-After': '5' });
    if (env.ENVIRONMENT !== 'development' && url.protocol !== 'https:') return reply('HTTPS is required.', 400);
    if (unlock) {
      if (!isSameOriginUnlock(request)) return unlockForbiddenResponse(request);
      if (!env.PASSWORD_LIMITER && env.ENVIRONMENT !== 'development') return reply('Password rate limiting is not configured.', 503);
      if (env.PASSWORD_LIMITER) {
        try {
          // One IP bucket across all slugs: varying slugs cannot increase the
          // password-hashing allowance. Outer redirect limiter applies as well.
          const key = 'password:' + await sha256(request.headers.get('cf-connecting-ip') ?? 'unknown');
          if (!(await env.PASSWORD_LIMITER.limit({ key })).success) return reply('Too Many Requests', 429, { 'Retry-After': '60' });
        } catch { return reply('Service temporarily unavailable.', 503, { 'Retry-After': '5' }); }
      }
      const password = await readPasswordForm(request);
      if (!await verifyLinkPassword(password, link.password_hash, env)) return passwordPage(request, keyword, true, env.SOURCE_URL);
      // This internal 303 never consumes quota or records redirect analytics.
      // The next GET revalidates the rule and sends no password body to targets,
      // including when the link is configured as 307/308.
      return new Response(null, { status: 303, headers: {
        Location: '/' + keyword + url.search, 'Set-Cookie': await issueUnlockCookie(link, url.host, env),
        'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store',
      } });
    }
    if (!await hasUnlockCookie(request, link, env)) return browserPost ? browserDenied(request, 'required') : passwordPage(request, keyword, false, env.SOURCE_URL);
  } else if (unlock) return reply('Method Not Allowed', 405, { Allow: 'GET, HEAD' });
  let observation: BrowserObservation = observeBrowser(request);
  const browserFlow = browserCollectionEnabled(env) || !!link.block_vpn;
  if (browserPost || (browserFlow && (request.method === 'GET' || !!link.block_vpn))) {
    if (!browserFlow) return reply('Method Not Allowed', 405, { Allow: 'GET, HEAD' });
    if (!browserChecksConfigured(env)) return reply('Browser timezone service is not configured.', 503, { 'Retry-After': '5' });
    if (env.ENVIRONMENT !== 'development' && url.protocol !== 'https:') return reply('HTTPS is required.', 400);
    if (browserPost) {
      if (!isSameOriginUnlock(request)) return browserDenied(request, 'invalid');
      const form = await readBrowserForm(request);
      const challenge = await validateBrowserChallenge(form.challenge, request, link, env);
      if (!challenge) return browserDenied(request, 'invalid');
      observation = observeBrowser(request, form.timezone, challenge.referrer);
      if (link.block_vpn && (observation.suspected || observation.reason === 'unknown')) {
        record(env, request, link, observation, observation.suspected ? 'vpn_blocked' : 'unknown_blocked');
        return browserDenied(request, observation.suspected ? 'vpn' : 'unknown');
      }
      const resume = cleanBrowserURL(request); resume.pathname = '/' + keyword;
      resume.searchParams.set(BROWSER_CHECK_MARKER, '1');
      // D4: negotiate only the success representation AFTER the same source,
      // password, challenge and policy checks. Both forms issue the same proof;
      // neither consumes quota nor records a successful visit here.
      const next = resume.pathname + resume.search;
      const headers: Record<string, string> = {
        'Set-Cookie': await issueBrowserCookie(challenge, observation.browserTimezone, link, env),
        'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store', Vary: 'Accept',
      };
      if (prefersJSON(request)) {
        headers['Content-Type'] = 'application/json; charset=utf-8';
        return new Response(JSON.stringify({ ok: true, data: { next } }), { status: 200, headers });
      }
      // Legacy form clients retain the original same-origin 303. A real browser
      // may block the later cross-origin hop; scripts use ordinary navigation.
      return new Response(null, { status: 303, headers: { ...headers, Location: next } });
    }
    const proof = await readBrowserCookie(request, link, env);
    if (!proof) {
      // A completion marker is not evidence. Stop cookie-blocked/expired loops
      // without ever allowing a protected target or consuming quota.
      if (url.searchParams.has(BROWSER_CHECK_MARKER)) return browserDenied(request, 'invalid');
      if (request.method === 'HEAD') return browserDenied(request, 'required');
      return browserCheckPage(request, link, env);
    }
    observation = proof;
    if (link.block_vpn && (proof.suspected || proof.reason === 'unknown')) {
      record(env, request, link, proof, proof.suspected ? 'vpn_blocked' : 'unknown_blocked');
      return browserDenied(request, proof.suspected ? 'vpn' : 'unknown');
    }
  }
  const finish = (response: Response): Response => {
    if (browserFlow && url.searchParams.has(BROWSER_CHECK_MARKER)) response.headers.append('Set-Cookie', clearBrowserCookie(link, env));
    return response;
  };
  if (link.response_mode === 'text') {
    const response = finish(reply(link.text_content, 200, { 'CDN-Cache-Control': 'no-store', 'Cloudflare-CDN-Cache-Control': 'no-store' }));
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
    if (lookup.checkedTarget === selected) {
      validateDestinationHost(stored, env);
      if (lookup.targetManaged) return reply('Invalid link configuration.', 503, { 'Retry-After': '5' });
    } else await validateDestination(env.DB, stored, env);
  } catch { return reply('Invalid link configuration.', 503, { 'Retry-After': '5' }); }
  const incoming = cleanBrowserURL(request); incoming.searchParams.delete('_Linro_lang');
  const target = buildTarget(stored, incoming, link.query_mode, policy.queryKeys);
  const parsed = new URL(target);
  if (parsed.hostname === url.hostname && parsed.pathname === url.pathname) return reply('Redirect loop detected.', 508);
  const controlled = browserFlow || rules.length > 0 || link.password_hash !== null || link.max_redirects !== null;
  const response = finish(new Response(null, { status: link.redirect_code, headers: {
    Location: target, 'Cache-Control': controlled ? 'no-store, max-age=0' : cacheControl(link.cache_ttl, link.expires_at, now),
    'CDN-Cache-Control': 'no-store', 'Cloudflare-CDN-Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
  } }));
  const rejected = await consumeQuota(env, link, url.hostname.toLowerCase(), canonicalHost(parsed.hostname), request);
  if (rejected) return rejected;
  // Everything that can reject the redirect precedes the counter commit.
  // Client disconnects / failures at the destination cannot be observed here.
  record(env, request, link, observation);
  return response;
}
export default {
  async fetch(request: Request, env: Env, ctx?: Context): Promise<Response> {
    const id = crypto.randomUUID();
    let response: Response;
    try { response = await handle(request, env, ctx); }
    catch (error) {
      if (!(error instanceof HttpError)) {
        console.error(JSON.stringify({ event: 'redirect_lookup_failed', request_id: id }));
        response = reply('Service temporarily unavailable.', 503, { 'Retry-After': '5' });
      } else response = errorResponse(error, id);
    }
    response = secure(addSourceLink(response, env.SOURCE_URL), id, request);
    return request.method === 'HEAD' ? new Response(null, { status: response.status, headers: response.headers }) : response;
  },
};
