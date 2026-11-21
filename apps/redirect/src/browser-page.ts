// SPDX-License-Identifier: AGPL-3.0-only
// Linro modifications: 2026-09-18; inherited attribution is in NOTICE.
import type { RedirectEnv, Link } from '../../../packages/shared/src/platform.js';
import { readBoundedBody } from '../../../packages/shared/src/body.js';
import {
  createBrowserChallenge,
  cleanBrowserURL,
  validateBrowserChallenge,
} from '../../../packages/shared/src/browser-check.js';
import {
  LATENCY_PATH,
  MAX_RECEIPT_CHARS,
  createLatencyReceipt,
} from '../../../packages/shared/src/vpn-latency.js';
import { isSameOriginUnlock } from './unlock-origin.js';
import { fail } from '../../../packages/shared/src/http.js';
import { sourceFooter } from '../../../packages/shared/src/legal.js';
import { escapeHTML } from '../../../packages/shared/src/html.js';
import {
  MAX_ACCEPT_HEADER_CHARS,
  MAX_BROWSER_FORM_BYTES,
  MAX_BROWSER_RESPONSE_CHARS,
  MAX_BROWSER_TOKEN_CHARS,
  MAX_URL_CHARS,
} from '../../../packages/shared/src/limits.js';
import { publicLocale } from './public-pages.js';
import { publicCard, label, pageURL, LANGUAGE_JS } from './public-card.js';

// This is a same-origin fetch followed by a NEW, ordinary navigation. Do not
// revert to a form-submission redirect chain: Chromium applies form-action to
// that chain's eventual cross-origin destination.
export const BROWSER_JS =
  LANGUAGE_JS +
  `(() => {
  'use strict';
  const form = document.getElementById('browser-check');
  if (!(form instanceof HTMLFormElement)) return;
  const field = form.elements.namedItem('timezone');
  const challenge = form.elements.namedItem('challenge');
  const latency = form.elements.namedItem('latency');
  const error = document.getElementById('browser-error');
  const status = document.getElementById('browser-status');
  if (!(field instanceof HTMLInputElement) || !(challenge instanceof HTMLInputElement)) return;
  let pending = false;
  let legacyNavigation = false;
  let fallbackUsed = false;
  const failed = () => {
    pending = false;
    form.removeAttribute('aria-busy');
    if (status) status.hidden = true;
    if (error) error.hidden = false;
  };
  let action;
  let slug;
  try {
    action = new URL(form.action, location.href);
    slug = /^\\/__Linro_browser\\/([A-Za-z0-9_-]{1,64})$/.exec(action.pathname)?.[1];
    if (action.origin !== location.origin || action.hash || !slug) throw new Error('Invalid action');
  } catch {
    form.addEventListener('submit', event => { event.preventDefault(); failed(); });
    failed();
    return;
  }
  const fallback = () => {
    // Bounded compatibility fallback for a network/protocol failure only. This
    // legacy form navigation can still be stopped by form-action in Chromium.
    // Never retry a terminal 4xx/5xx or allow a proof-less target navigation.
    if (fallbackUsed || (latency && !latency.value)) { failed(); return; }
    try { if (new URL(form.action, location.href).href !== action.href) { failed(); return; } }
    catch { failed(); return; }
    fallbackUsed = true;
    pending = false;
    form.removeAttribute('aria-busy');
    legacyNavigation = true;
    try { form.requestSubmit(); } catch { failed(); }
    finally { legacyNavigation = false; }
  };
  form.addEventListener('submit', async event => {
    if (legacyNavigation) return;
    event.preventDefault();
    if (pending) return;
    pending = true;
    form.setAttribute('aria-busy', 'true');
    if (status) status.hidden = false;
    if (error) error.hidden = true;
    try { field.value = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { field.value = ''; }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const body = new URLSearchParams({ challenge: challenge.value, timezone: field.value });
      if (latency instanceof HTMLInputElement) {
        latency.value = '';
        const probe = new URL('${LATENCY_PATH}', action.origin);
        probe.search = action.search;
        const options = {
          method: 'POST', credentials: 'same-origin', mode: 'same-origin', redirect: 'manual',
          cache: 'no-store', signal: controller.signal, body: new URLSearchParams({ challenge: challenge.value }),
        };
        const start = performance.now();
        const sample = await fetch(probe.href, options);
        const elapsed = performance.now() - start;
        if (sample.status !== 200 || sample.redirected) { failed(); return; }
        const receipt = await sample.text();
        if (!/^[A-Za-z0-9_-]+$/.test(receipt) || receipt.length > ${MAX_RECEIPT_CHARS}) { failed(); return; }
        latency.value = JSON.stringify({ receipt, elapsed });
        body.set('latency', latency.value);
      }
      const response = await fetch(action.href, {
        method: 'POST', body, credentials: 'same-origin', mode: 'same-origin',
        redirect: 'manual', cache: 'no-store', signal: controller.signal,
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      });
      if (response.status >= 400) { failed(); return; }
      if (response.status !== 200 || response.redirected ||
          response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new Error('Invalid response');
      const raw = await response.text();
      if (raw.length > ${MAX_BROWSER_RESPONSE_CHARS}) throw new Error('Oversized response');
      const result = JSON.parse(raw);
      const next = result?.data?.next;
      if (result?.ok !== true || typeof next !== 'string' || next.length > ${MAX_URL_CHARS} ||
          !next.startsWith('/') || next.startsWith('//') || /[\\\\\\x00-\\x20\\x7f]/.test(next)) throw new Error('Invalid next path');
      const destination = new URL(next, location.href);
      if (destination.origin !== location.origin || destination.pathname !== '/' + slug || destination.hash ||
          destination.searchParams.getAll('_Linro_check').length !== 1 || destination.searchParams.get('_Linro_check') !== '1' ||
          next !== destination.pathname + destination.search) throw new Error('Invalid next path');
      // No target is returned by the POST. This resumes the same short link,
      // whose fresh D1/password/proof/quota checks authorize the final response.
      location.assign(next);
    } catch { fallback(); }
    finally { clearTimeout(timer); }
  });
  form.requestSubmit();
})();\n`;

/** Explicit opt-in for the script client; request-body and authorization rules
 * do not depend on this negotiation. Wildcards are the legacy HTML/form path. */
export function prefersJSON(request: Request): boolean {
  const accept = request.headers.get('accept') ?? '';
  if (accept.length > MAX_ACCEPT_HEADER_CHARS) return false;
  return accept.split(',').some((part) => {
    const [media, ...parameters] = part.split(';');
    if (media?.trim().toLowerCase() !== 'application/json') return false;
    const weights = parameters
      .map((value) => value.trim())
      .filter((value) => /^q\s*=/i.test(value));
    if (weights.length > 1) return false;
    if (!weights.length) return true;
    const value = weights[0]!.slice(weights[0]!.indexOf('=') + 1).trim();
    return /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(value) && Number(value) > 0;
  });
}
const checkTitle = ['浏览器环境检查', 'Browser environment check'] as const;
export async function browserCheckPage(
  request: Request,
  link: Link,
  env: RedirectEnv,
): Promise<Response> {
  const language = publicLocale(request);
  const url = cleanBrowserURL(request);
  const token = await createBrowserChallenge(request, link, env);
  const tr = (zh: string, en: string) => label(language, zh, en);
  const body = `<p id="browser-status" role="status">${tr('该页面已开启浏览器环境检查，检查通过后会自动跳转。', 'This page has browser environment checks enabled. You will be redirected automatically once the check passes.')}</p>
<p id="browser-error" class="error" role="alert" hidden>${tr('检查未通过或暂时不可用，请重新打开链接或联系管理员。', 'The check did not pass or is temporarily unavailable. Reopen the link or contact the administrator.')}</p>
<form id="browser-check" method="post" action="${escapeHTML('/__Linro_browser/' + link.slug + url.search)}">
<input type="hidden" name="challenge" value="${escapeHTML(token)}">
<input type="hidden" name="timezone" value="">
${link.block_vpn ? '<input type="hidden" name="latency" value="">' : ''}
<button type="submit">${tr('继续检查', 'Continue check')}</button>
</form>
<noscript><p>${tr('请启用 JavaScript 和 Cookie 后重新打开链接，以完成浏览器环境检查。', 'Enable JavaScript and cookies, then reopen the link to complete the browser environment check.')}</p></noscript>${sourceFooter(env.SOURCE_URL, language === 'zh-CN')}`;
  return publicCard(request, link.slug, language, checkTitle, body, 'browser.js', 200);
}
export function browserDenied(
  request: Request,
  reason: 'vpn' | 'unknown' | 'required' | 'invalid',
  slug?: string,
): Response {
  const language = publicLocale(request);
  const messages = {
    vpn: [
      '浏览器环境检查未通过，无法访问此链接。请联系管理员。',
      'The browser environment check did not pass. Access is denied. Please contact the administrator.',
    ],
    unknown: [
      '无法完成浏览器环境检查，暂时无法访问此链接。请联系管理员。',
      'The browser environment check could not be completed. Access is currently unavailable. Please contact the administrator.',
    ],
    required: [
      '请使用启用 JavaScript 和 Cookie 的浏览器打开原短链完成检查。',
      'Open the original short link in a browser with JavaScript and cookies enabled to complete the check.',
    ],
    invalid: [
      '浏览器检查已失效。请重新打开原短链并允许 Cookie。',
      'The browser check is invalid or expired. Reopen the original short link and allow cookies.',
    ],
  } as const;

  const message = messages[reason];
  const navigation = request.headers.get('sec-fetch-mode') === 'navigate';
  const accept = request.headers.get('accept') ?? '*/*';
  const pageRequest =
    (request.method === 'GET' || request.method === 'HEAD') &&
    (navigation || /(?:text\/html|\*\/\*)/i.test(accept));
  if (slug && (pageRequest || (navigation && isSameOriginUnlock(request)))) {
    const body = `<p class="error" role="alert">${label(language, message[0], message[1])}</p><a id="browser-retry" class="retry-link" href="${pageURL(request, slug, language)}">${label(language, '重新检查', 'Check again')}</a>`;
    return publicCard(request, slug, language, checkTitle, body, 'browser.js', 403);
  }
  return new Response(message[language === 'en' ? 1 : 0], {
    status: 403,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Language': language,
      Vary: 'Accept-Language',
      'Cache-Control': 'no-store',
      'CDN-Cache-Control': 'no-store',
    },
  });
}
async function browserFields(request: Request): Promise<URLSearchParams> {
  if (
    request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !==
    'application/x-www-form-urlencoded'
  )
    fail(415, 'browser_form_type', 'Use a browser form.');
  const bytes = await readBoundedBody(request, {
    maxBytes: MAX_BROWSER_FORM_BYTES,
    emptyCode: 'invalid_browser_form',
    emptyMessage: 'Invalid browser form.',
  });
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return fail(400, 'invalid_browser_form', 'Invalid browser form.');
  }
  return new URLSearchParams(text);
}

export async function latencyProbe(request: Request, env: RedirectEnv): Promise<Response> {
  if (
    !isSameOriginUnlock(request) ||
    (env.ENVIRONMENT !== 'development' && new URL(request.url).protocol !== 'https:')
  )
    return browserDenied(request, 'invalid');
  const form = await browserFields(request);
  const challenge = form.get('challenge');
  if (
    [...form].length !== 1 ||
    !challenge ||
    !(await validateBrowserChallenge(challenge, request, undefined, env))
  )
    return browserDenied(request, 'invalid');
  return new Response(await createLatencyReceipt(request, env.BROWSER_CHECK_SECRET!, challenge), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'CDN-Cache-Control': 'no-store',
    },
  });
}

export async function readBrowserForm(
  request: Request,
  vpn: boolean,
): Promise<{ challenge: string; timezone: string; latency: string }> {
  const form = await browserFields(request);
  if (
    [...form.keys()].length !== (vpn && form.has('latency') ? 3 : 2) ||
    form.getAll('challenge').length !== 1 ||
    form.getAll('timezone').length !== 1
  )
    fail(400, 'invalid_browser_form', 'Invalid browser form.');
  const challenge = form.get('challenge')!;
  const timezone = form.get('timezone')!;
  if (!challenge || challenge.length > MAX_BROWSER_TOKEN_CHARS || timezone.length > 64)
    fail(400, 'invalid_browser_form', 'Invalid browser form.');
  return { challenge, timezone, latency: form.get('latency') ?? '' };
}
