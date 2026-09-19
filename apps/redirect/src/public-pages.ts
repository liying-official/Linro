import { legalFooter } from '../../../packages/shared/src/legal.js';
// SPDX-License-Identifier: AGPL-3.0-only
// Linro modifications: 2026-09-18; inherited attribution is in NOTICE.
import { fail } from '../../../packages/shared/src/http.js';
export type PublicLocale = 'zh-CN' | 'en';
export function publicLocale(request: Request): PublicLocale {
  const explicit = new URL(request.url).searchParams.get('_Linro_lang');
  if (explicit === 'zh-CN' || explicit === 'en') return explicit;
  const choices = (request.headers.get('accept-language') ?? '').slice(0, 2048).split(',').map((part, i) => {
    const [tag = '', ...params] = part.trim().split(';');
    const raw = params.find(p => p.trim().startsWith('q='));
    const q = raw === undefined ? 1 : Number(raw.trim().slice(2));
    return { tag: tag.toLowerCase(), q: Number.isFinite(q) && q > 0 && q <= 1 ? q : 0, i };
  }).sort((a, b) => b.q - a.q || a.i - b.i);
  for (const choice of choices) {
    if (choice.q === 0) continue;
    if (/^zh(?:-|$)/.test(choice.tag)) return 'zh-CN';
    if (/^en(?:-|$)/.test(choice.tag)) return 'en';
  }
  return 'en';
}
export function limitResponse(request: Request): Response {
  const lang = publicLocale(request);
  const text = lang === 'zh-CN' ? '此链接请求次数已到达上限，请联系管理员' : 'This link has reached its request limit. Please contact the administrator.';
  return new Response(text, { status: 403, headers: {
    'Content-Type': 'text/plain; charset=utf-8', 'Content-Language': lang,
    'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store', Vary: 'Accept-Language',
  } });
}
/** Do not echo Origin, password, query string or the stored target in denials. */
export function unlockForbiddenResponse(request: Request): Response {
  const lang = publicLocale(request);
  const text = lang === 'zh-CN'
    ? '请从短链密码页提交。'
    : 'Please submit the form from the short link password page.';
  return new Response(text, { status: 403, headers: {
    'Content-Type': 'text/plain; charset=utf-8', 'Content-Language': lang,
    'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store', Vary: 'Accept-Language',
  } });
}
const escape = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function passwordPage(request: Request, keyword: string, incorrect = false, source?: string): Response {
  const lang = publicLocale(request); const zh = lang === 'zh-CN';
  const url = new URL(request.url);
  const action = `/__Linro_unlock/${keyword}${url.search}`;
  const languageURL = (locale: string) => { const u = new URL(request.url); u.pathname = '/' + keyword; u.searchParams.set('_Linro_lang', locale); return escape(u.pathname + u.search); };
  // No target URL, password verifier or password value is rendered, even in
  // hidden fields. No JavaScript, inline event handlers or third-party assets.
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${zh ? '短链接访问密码' : 'Short link password'}</title><link rel="stylesheet" href="/__Linro_assets/password.css"></head><body><main><nav aria-label="${zh ? '语言' : 'Language'}"><a href="${languageURL('zh-CN')}" lang="zh-CN">简体中文</a><a href="${languageURL('en')}" lang="en">English</a></nav><p class="brand">Linro</p><h1>${zh ? '请输入访问密码' : 'Enter the access password'}</h1><p>${zh ? '此短链接受密码保护。' : 'This short link is password-protected.'}</p>${incorrect ? `<p class="error" role="alert">${zh ? '密码错误，请重试。' : 'Incorrect password. Please try again.'}</p>` : ''}<form action="${escape(action)}" method="post"><label for="password">${zh ? '访问密码' : 'Access password'}</label><input id="password" name="password" type="password" minlength="12" maxlength="128" required autocomplete="current-password" autofocus><button type="submit">${zh ? '验证并继续' : 'Verify and continue'}</button></form><small>${zh ? '验证成功后，此浏览器可在 15 分钟内访问当前链接。' : 'After verification, this browser can access this link for 15 minutes.'}</small>${legalFooter(source, zh)}</main></body></html>`;
  return new Response(html, { status: incorrect ? 401 : 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Language': lang, 'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store', Vary: 'Accept-Language, Cookie' } });
}
export const PASSWORD_CSS = `/* Linro: sky-blue theme shared by password and environment-check pages. */
:root{font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#0D394A;background:#FFFFFF}
*{box-sizing:border-box}body{margin:0;padding:24px;min-height:100vh;display:grid;place-items:center;background:linear-gradient(145deg,#87CEEB,#FFFFFF 65%)}
main{width:100%;max-width:460px;background:#FFFFFF;border:1px solid #87CEEB;border-radius:16px;padding:32px;box-shadow:0 16px 40px #0D394A14}
nav{display:flex;justify-content:flex-end;gap:16px;font-size:13px}a{color:#0D394A}.brand{color:#0D394A;font-weight:700;font-size:22px;margin:24px 0}
h1{color:#0D394A;font-size:25px;margin-bottom:12px}p{color:#0D394A;line-height:1.7;font-size:14px}
label{color:#0D394A;font-size:14px;display:block;margin:24px 0 8px}
input,button{font:inherit;color:#0D394A;width:100%;padding:12px;border:1px solid #87CEEB;border-radius:8px;background:#FFFFFF}
input:focus-visible,a:focus-visible,button:focus-visible{outline:3px solid #2145C4;outline-offset:3px}
button{margin-top:16px;background:#87CEEB;color:#0D394A;cursor:pointer}small{display:block;margin-top:22px;line-height:1.7;color:#0D394A}
.error{color:#0D394A;background:#EAF7FC;padding:10px;border-radius:8px}.legal{display:flex;gap:12px;flex-wrap:wrap;font-size:12px;margin-top:20px}
@media(max-width:400px){body{padding:12px}main{padding:24px}}`;
/** Small bounded form parser; do not log or echo request bodies. */
export async function readPasswordForm(request: Request): Promise<string> {
  if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/x-www-form-urlencoded') fail(415, 'content_type', 'Use application/x-www-form-urlencoded.');
  if (Number(request.headers.get('content-length') ?? 0) > 8192) fail(413, 'body_too_large', 'Request body is too large.');
  if (!request.body) fail(400, 'empty_body', 'A password is required.');
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.length;
      if (size > 8192) { await reader.cancel(); fail(413, 'body_too_large', 'Request body is too large.'); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let form: URLSearchParams;
  try { form = new URLSearchParams(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { return fail(400, 'invalid_form', 'Invalid form.'); }
  if (form.getAll('password').length !== 1 || [...form.keys()].some(k => k !== 'password')) fail(400, 'invalid_form', 'Submit one password field.');
  return form.get('password')!;
}
