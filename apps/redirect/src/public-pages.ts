// SPDX-License-Identifier: AGPL-3.0-only
// Linro modifications: 2026-09-18; inherited attribution is in NOTICE.
import { sourceFooter } from '../../../packages/shared/src/legal.js';
import { readBoundedBody } from '../../../packages/shared/src/body.js';
import { fail } from '../../../packages/shared/src/http.js';
import { escapeHTML } from '../../../packages/shared/src/html.js';
import { publicCard, label, LANGUAGE_JS, type PublicLocale } from './public-card.js';
export type { PublicLocale } from './public-card.js';
import {
  MAX_BROWSER_RESPONSE_CHARS,
  MAX_PASSWORD_FORM_BYTES,
  MAX_URL_CHARS,
} from '../../../packages/shared/src/limits.js';
// Resume with an ordinary GET: Chromium applies form-action to the eventual
// external destination of a native POST -> 303 -> redirect chain.
export const PASSWORD_JS =
  LANGUAGE_JS +
  `(() => {
  'use strict';
  const form = document.getElementById('password-form');
  if (!(form instanceof HTMLFormElement)) return;
  const field = form.elements.namedItem('password');
  const wrong = document.getElementById('password-error');
  const unavailable = document.getElementById('password-unavailable');
  if (!(field instanceof HTMLInputElement)) return;
  let pending = false;
  const failed = incorrect => {
    pending = false;
    form.removeAttribute('aria-busy');
    if (incorrect && wrong) wrong.hidden = false;
    else if (unavailable) unavailable.hidden = false;
  };
  let action;
  let next;
  try {
    action = new URL(form.action, location.href);
    const slug = /^\\/__Linro_unlock\\/([A-Za-z0-9_-]{1,64})$/.exec(action.pathname)?.[1];
    if (action.origin !== location.origin || action.hash || !slug) throw new Error('Invalid action');
    next = '/' + slug + action.search;
  } catch {
    form.addEventListener('submit', event => { event.preventDefault(); failed(false); });
    failed(false);
    return;
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (pending) return;
    pending = true;
    form.setAttribute('aria-busy', 'true');
    if (wrong) wrong.hidden = true;
    if (unavailable) unavailable.hidden = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(action.href, {
        method: 'POST', body: new URLSearchParams({ password: field.value }),
        credentials: 'same-origin', mode: 'same-origin', redirect: 'manual',
        cache: 'no-store', signal: controller.signal,
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      });
      if (response.status !== 200 || response.redirected ||
          response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
        failed(response.status === 401); return;
      }
      const raw = await response.text();
      if (raw.length > ${MAX_BROWSER_RESPONSE_CHARS}) throw new Error('Oversized response');
      const result = JSON.parse(raw);
      // The POST never returns a target. Accept only this form's exact local
      // short-link path; its GET still enforces D1, cookie, proof and quota.
      if (result?.ok !== true || typeof result?.data?.next !== 'string' ||
          next.length > ${MAX_URL_CHARS} || result.data.next !== next) throw new Error('Invalid next path');
      const destination = new URL(next, location.href);
      if (destination.origin !== location.origin || destination.hash ||
          next !== destination.pathname + destination.search) throw new Error('Invalid next path');
      const chosen = document.getElementById('public-language')?.dataset.chosen;
      if (chosen === 'zh-CN' || chosen === 'en') destination.searchParams.set('_Linro_lang', chosen);
      location.assign(destination.pathname + destination.search);
    } catch { failed(false); }
    finally { clearTimeout(timer); }
  });
})();\n`;
export function publicLocale(request: Request): PublicLocale {
  const explicit = new URL(request.url).searchParams.get('_Linro_lang');
  if (explicit === 'zh-CN' || explicit === 'en') return explicit;
  const choices = (request.headers.get('accept-language') ?? '')
    .slice(0, 2048)
    .split(',')
    .map((part, i) => {
      const [tag = '', ...params] = part.trim().split(';');
      const raw = params.find((p) => p.trim().startsWith('q='));
      const q = raw === undefined ? 1 : Number(raw.trim().slice(2));
      return { tag: tag.toLowerCase(), q: Number.isFinite(q) && q > 0 && q <= 1 ? q : 0, i };
    })
    .sort((a, b) => b.q - a.q || a.i - b.i);
  for (const choice of choices) {
    if (choice.q === 0) continue;
    if (/^zh(?:-|$)/.test(choice.tag)) return 'zh-CN';
    if (/^en(?:-|$)/.test(choice.tag)) return 'en';
  }
  return 'en';
}
export function limitResponse(request: Request): Response {
  const lang = publicLocale(request);
  const text =
    lang === 'zh-CN'
      ? '此链接请求次数已到达上限，请联系管理员'
      : 'This link has reached its request limit. Please contact the administrator.';
  return new Response(text, {
    status: 403,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Language': lang,
      'Cache-Control': 'no-store',
      'CDN-Cache-Control': 'no-store',
      Vary: 'Accept-Language',
    },
  });
}
/** Do not echo Origin, password, query string or the stored target in denials. */
export function unlockForbiddenResponse(request: Request): Response {
  const lang = publicLocale(request);
  const text =
    lang === 'zh-CN'
      ? '请从短链密码页提交。'
      : 'Please submit the form from the short link password page.';
  return new Response(text, {
    status: 403,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Language': lang,
      'Cache-Control': 'no-store',
      'CDN-Cache-Control': 'no-store',
      Vary: 'Accept-Language',
    },
  });
}
export function passwordPage(
  request: Request,
  keyword: string,
  incorrect = false,
  source?: string,
): Response {
  const lang = publicLocale(request);
  const zh = lang === 'zh-CN';
  const url = new URL(request.url);
  const action = `/__Linro_unlock/${keyword}${url.search}`;
  const tr = (zh: string, en: string) => label(lang, zh, en);
  const body = `<p>${tr('此短链接受密码保护。', 'This short link is password-protected.')}</p>
<p id="password-error" class="error" role="alert"${incorrect ? '' : ' hidden'}>${tr('密码错误，请重试。', 'Incorrect password. Please try again.')}</p>
<p id="password-unavailable" class="error" role="alert" hidden>${tr('验证暂时不可用，请重试或联系管理员。', 'Verification is temporarily unavailable. Please try again or contact the administrator.')}</p>
<form id="password-form" action="${escapeHTML(action)}" method="post">
<label for="password">${tr('访问密码', 'Access password')}</label>
<input id="password" name="password" type="password" minlength="12" maxlength="128" required autocomplete="current-password" autofocus>
<button type="submit">${tr('验证并继续', 'Verify and continue')}</button>
</form>
<small>${tr('验证成功后，此浏览器可在 15 分钟内访问当前链接。', 'After verification, this browser can access this link for 15 minutes.')}</small>${sourceFooter(source, zh)}`;
  return publicCard(
    request,
    keyword,
    lang,
    ['请输入访问密码', 'Enter the access password'],
    body,
    'password.js',
    incorrect ? 401 : 200,
  );
}
export const PASSWORD_CSS = `/* Linro: sky-blue theme shared by password and environment-check pages. */
:root{font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#0D394A;background:#FFFFFF}
*{box-sizing:border-box}body{margin:0;padding:24px;min-height:100vh;display:grid;place-items:center;background:linear-gradient(145deg,#87CEEB,#FFFFFF 65%)}
main{width:100%;max-width:460px;background:#FFFFFF;border:1px solid #87CEEB;border-radius:16px;padding:32px;box-shadow:0 16px 40px #0D394A14}
.language-slider{display:grid;grid-template-columns:1fr 1fr;position:relative;isolation:isolate;width:min(100%,194px);margin:0 0 0 auto;padding:3px;border:1px solid #a7cdda;border-radius:999px;background:#edf7fb}
.language-slider::before{content:"";position:absolute;z-index:-1;inset:3px auto 3px 3px;width:calc((100% - 6px)/2);border-radius:999px;background:#87CEEB;transition:transform .18s ease}
.language-slider[data-locale="en"]::before{transform:translateX(100%)}
.language-slider a{display:grid;place-items:center;min-height:44px;font-size:14px;line-height:1.25;text-decoration:none;border-radius:999px}.language-slider [aria-current]{font-weight:700}
.retry-link{display:inline-block;margin-top:8px;padding:10px 16px;background:#87CEEB;color:#0D394A;border-radius:8px;text-decoration:none}
@media(prefers-reduced-motion:reduce){.language-slider::before{transition:none}}
a{color:#0D394A}.brand{color:#0D394A;font-weight:700;font-size:22px;margin:24px 0}
h1{color:#0D394A;font-size:25px;margin-bottom:12px}p{color:#0D394A;line-height:1.7;font-size:14px}
label{color:#0D394A;font-size:14px;display:block;margin:24px 0 8px}
input,button{font:inherit;color:#0D394A;width:100%;padding:12px;border:1px solid #87CEEB;border-radius:8px;background:#FFFFFF}
input:focus-visible,a:focus-visible,button:focus-visible{outline:3px solid #2145C4;outline-offset:3px}
button{margin-top:16px;background:#87CEEB;color:#0D394A;cursor:pointer}small{display:block;margin-top:22px;line-height:1.7;color:#0D394A}
.error{color:#0D394A;background:#EAF7FC;padding:10px;border-radius:8px}.legal{display:flex;gap:12px;flex-wrap:wrap;font-size:12px;margin-top:20px}
@media(max-width:400px){body{padding:12px}main{padding:24px}}`;
/** Small bounded form parser; do not log or echo request bodies. */
export async function readPasswordForm(request: Request): Promise<string> {
  if (
    request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !==
    'application/x-www-form-urlencoded'
  )
    fail(415, 'content_type', 'Use application/x-www-form-urlencoded.');
  const bytes = await readBoundedBody(request, {
    maxBytes: MAX_PASSWORD_FORM_BYTES,
    emptyCode: 'empty_body',
    emptyMessage: 'A password is required.',
  });
  let form: URLSearchParams;
  try {
    form = new URLSearchParams(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return fail(400, 'invalid_form', 'Invalid form.');
  }
  if (form.getAll('password').length !== 1 || [...form.keys()].some((k) => k !== 'password'))
    fail(400, 'invalid_form', 'Submit one password field.');
  return form.get('password')!;
}
