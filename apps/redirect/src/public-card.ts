// SPDX-License-Identifier: AGPL-3.0-only
import { escapeHTML } from '../../../packages/shared/src/html.js';
import { PUBLIC_ASSETS } from './public-asset-paths.js';

export type PublicLocale = 'zh-CN' | 'en';
type Copy = readonly [zh: string, en: string];

function attributes(copy: Copy) {
  return `data-zh="${escapeHTML(copy[0])}" data-en="${escapeHTML(copy[1])}"`;
}
export function label(lang: PublicLocale, zh: string, en: string): string {
  return `<span ${attributes([zh, en])}>${escapeHTML(lang === 'en' ? en : zh)}</span>`;
}
export function pageURL(request: Request, slug: string, lang: PublicLocale) {
  const params = new URL(request.url).searchParams;
  params.delete('_Linro_check');
  params.set('_Linro_lang', lang);
  return escapeHTML('/' + slug + '?' + params.toString());
}
function languageSlider(request: Request, slug: string, lang: PublicLocale) {
  const option = (locale: PublicLocale, text: string) =>
    `<a lang="${locale}" hreflang="${locale}" href="${pageURL(request, slug, locale)}"${lang === locale ? ' aria-current="true"' : ''}>${text}</a>`;
  return `<nav id="public-language" class="language-slider" aria-label="${lang === 'en' ? 'Language' : '语言'}" data-locale="${lang}">${option('zh-CN', '简体中文')}${option('en', 'English')}</nav>`;
}
export function publicCard(
  request: Request,
  slug: string,
  lang: PublicLocale,
  title: Copy,
  body: string,
  script: 'browser.js' | 'password.js',
  status: number,
): Response {
  const html = `<!doctype html>
<html lang="${lang}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><link rel="icon" href="data:,">
<title ${attributes(title)}>${escapeHTML(title[lang === 'en' ? 1 : 0])}</title>
<link rel="stylesheet" href="${PUBLIC_ASSETS['password.css']}">
<script src="${PUBLIC_ASSETS[script]}" defer></script></head>
<body><main>${languageSlider(request, slug, lang)}<p class="brand">Linro</p>
<h1>${label(lang, ...title)}</h1>${body}</main></body></html>`;
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Language': lang,
      'Cache-Control': 'no-store',
      'CDN-Cache-Control': 'no-store',
      Vary: script === 'password.js' ? 'Accept-Language, Cookie' : 'Accept-Language',
    },
  });
}

// Apply a choice in place. The anchors also work with JavaScript disabled.
export const LANGUAGE_JS = `(() => {
  const nav = document.getElementById('public-language');
  if (!nav) return;
  const links = Array.from(nav.querySelectorAll('a[hreflang]'));
  function select(link) {
    const lang = link.hreflang;
    if (lang !== 'zh-CN' && lang !== 'en') return;
    document.documentElement.lang = lang;
    nav.dataset.locale = lang;
    nav.setAttribute('aria-label', lang === 'en' ? 'Language' : '语言');
    for (const item of links) {
      if (item === link) item.setAttribute('aria-current', 'true');
      else item.removeAttribute('aria-current');
    }
    for (const node of document.querySelectorAll('[data-zh][data-en]')) {
      node.textContent = lang === 'en' ? node.dataset.en : node.dataset.zh;
    }
    const retry = document.getElementById('browser-retry');
    if (retry) retry.href = link.href;
    nav.dataset.chosen = lang;
    history.replaceState(null, '', link.href);
  }
  for (const link of links) {
    link.addEventListener('click', event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      select(link);
    });
    link.addEventListener('keydown', event => {
      const choices = { ArrowLeft: links[0], ArrowRight: links[1], Home: links[0], End: links[1], ' ': link };
      const next = choices[event.key];
      if (!(next instanceof HTMLAnchorElement)) return;
      event.preventDefault();
      next.focus();
      select(next);
    });
  }
})();`;
