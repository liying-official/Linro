import { legalFooter } from '../../../packages/shared/src/legal.js';
// SPDX-License-Identifier: AGPL-3.0-only
// Linro modifications: 2026-09-18; inherited attribution is in NOTICE.
import type { Env, Link } from '../../../packages/shared/src/platform.js';
import { createBrowserChallenge, cleanBrowserURL } from '../../../packages/shared/src/browser-check.js';
import { fail } from '../../../packages/shared/src/http.js';
import { publicLocale } from './public-pages.js';

const escape = (value: string): string => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
// This is a same-origin fetch followed by a NEW, ordinary navigation. Do not
// revert to a form-submission redirect chain: Chromium applies form-action to
// that chain's eventual cross-origin destination (deployment report D4).
export const BROWSER_JS = `(() => {
  'use strict';
  const form = document.getElementById('browser-check');
  if (!(form instanceof HTMLFormElement)) return;
  const field = form.elements.namedItem('timezone');
  const challenge = form.elements.namedItem('challenge');
  const error = document.getElementById('browser-error');
  if (!(field instanceof HTMLInputElement) || !(challenge instanceof HTMLInputElement)) return;
  let pending = false;
  let legacyNavigation = false;
  let fallbackUsed = false;
  const failed = () => {
    pending = false;
    form.removeAttribute('aria-busy');
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
    if (fallbackUsed) { failed(); return; }
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
    if (error) error.hidden = true;
    try { field.value = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { field.value = ''; }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const body = new URLSearchParams({ challenge: challenge.value, timezone: field.value });
      const response = await fetch(action.href, {
        method: 'POST', body, credentials: 'same-origin', mode: 'same-origin',
        redirect: 'manual', cache: 'no-store', signal: controller.signal,
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      });
      if (response.status >= 400) { failed(); return; }
      if (response.status !== 200 || response.redirected ||
          response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new Error('Invalid response');
      const raw = await response.text();
      if (raw.length > 16384) throw new Error('Oversized response');
      const result = JSON.parse(raw);
      const next = result?.data?.next;
      if (result?.ok !== true || typeof next !== 'string' || next.length > 8192 ||
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
  if (accept.length > 4096) return false;
  return accept.split(',').some(part => {
    const [media, ...parameters] = part.split(';');
    if (media?.trim().toLowerCase() !== 'application/json') return false;
    const weights = parameters.map(value => value.trim()).filter(value => /^q\s*=/i.test(value));
    if (weights.length > 1) return false;
    if (!weights.length) return true;
    const value = weights[0]!.slice(weights[0]!.indexOf('=') + 1).trim();
    return /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(value) && Number(value) > 0;
  });
}
export async function browserCheckPage(request: Request, link: Link, env: Env): Promise<Response> {
  const language = publicLocale(request); const zh = language === 'zh-CN';
  const url = cleanBrowserURL(request);
  const token = await createBrowserChallenge(request, link, env);
  const title = zh ? '浏览器环境检查' : 'Browser environment check';
  const detail = zh ? '该页面已开启浏览器环境检查，检查通过后会自动跳转。' : 'This page has browser environment checks enabled. You will be redirected automatically once the check passes.';
  const failed = zh ? '检查未通过或暂时不可用，请重新打开链接或联系管理员。' : 'The check did not pass or is temporarily unavailable. Reopen the link or contact the administrator.';
  const noScript = zh ? '请启用 JavaScript 和 Cookie 后重新打开链接，以完成浏览器环境检查。' : 'Enable JavaScript and cookies, then reopen the link to complete the browser environment check.';
  // Only generic status text is public. The operator documentation retains the
  // data sources, privacy purpose, limitations and false-positive warning.
  const body = `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${title}</title><link rel="stylesheet" href="/__Linro_assets/password.css"><script src="/__Linro_assets/browser.js" defer></script></head><body><main><p class="brand">Linro</p><h1>${title}</h1><p role="status">${detail}</p><p id="browser-error" role="alert" hidden>${failed}</p><form id="browser-check" method="post" action="${escape('/__Linro_browser/' + link.slug + url.search)}"><input type="hidden" name="challenge" value="${escape(token)}"><input type="hidden" name="timezone" value=""><button type="submit">${zh ? '继续检查' : 'Continue check'}</button></form><noscript><p>${noScript}</p></noscript>${legalFooter(env.SOURCE_URL, zh)}</main></body></html>`;
  return new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Language': language, Vary: 'Accept-Language', 'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store' } });
}
export function browserDenied(request: Request, reason: 'vpn' | 'unknown' | 'required' | 'invalid'): Response {
  const language = publicLocale(request); const zh = language === 'zh-CN';
  const messages = {
    vpn: zh ? '浏览器环境检查未通过，无法访问此链接。请联系管理员。' : 'The browser environment check did not pass. Access is denied. Please contact the administrator.',
    unknown: zh ? '无法完成浏览器环境检查，暂时无法访问此链接。请联系管理员。' : 'The browser environment check could not be completed. Access is currently unavailable. Please contact the administrator.',
    required: zh ? '请使用启用 JavaScript 和 Cookie 的浏览器打开原短链完成检查。' : 'Open the original short link in a browser with JavaScript and cookies enabled to complete the check.',
    invalid: zh ? '浏览器检查已失效。请重新打开原短链并允许 Cookie。' : 'The browser check is invalid or expired. Reopen the original short link and allow cookies.',
  };
  return new Response(messages[reason], { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Language': language, Vary: 'Accept-Language', 'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store' } });
}
export async function readBrowserForm(request: Request): Promise<{ challenge: string; timezone: string }> {
  if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/x-www-form-urlencoded') fail(415, 'browser_form_type', 'Use a browser form.');
  if (Number(request.headers.get('content-length') ?? 0) > 4096) fail(413, 'body_too_large', 'Request body is too large.');
  if (!request.body) fail(400, 'invalid_browser_form', 'Invalid browser form.');
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 4096) { await reader.cancel(); fail(413, 'body_too_large', 'Request body is too large.'); } chunks.push(part.value); }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return fail(400, 'invalid_browser_form', 'Invalid browser form.'); }
  const form = new URLSearchParams(text);
  if ([...form.keys()].length !== 2 || form.getAll('challenge').length !== 1 || form.getAll('timezone').length !== 1) fail(400, 'invalid_browser_form', 'Invalid browser form.');
  const challenge = form.get('challenge')!; const timezone = form.get('timezone')!;
  if (!challenge || challenge.length > 2200 || timezone.length > 64) fail(400, 'invalid_browser_form', 'Invalid browser form.');
  return { challenge, timezone };
}
