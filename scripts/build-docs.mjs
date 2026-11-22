import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked, Renderer } from 'marked';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const licenseCopies = new Map([
  ['LICENSE', 'docs/licenses/LICENSE.txt'],
  ['NOTICE', 'docs/licenses/NOTICE.txt'],
  ['LICENSES/TailAdmin-MIT.txt', 'docs/licenses/TailAdmin-MIT.txt'],
  ['LICENSES/Recharts-MIT.txt', 'docs/licenses/Recharts-MIT.txt'],
]);
const htmlEscape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

// GitHub-style heading fragments, scoped per document in the combined book.
// Explicit <a id="..."></a> anchors are also preserved and scoped.
export function headingSlug(text) {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/!?\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*~]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, '')
    .replace(/\s/g, '-');
}

export function documentationFiles(version) {
  const topics = [
    ['readme', 'README', '先认识 Linro', 'Meet Linro', false],
    ['guide', 'GUIDE', '安装与使用', 'Install and use', true],
    ['api', 'API', 'API 参考', 'API reference', true],
    ['security', 'SECURITY', '安全与隐私', 'Security and privacy', true],
    ['retention', 'RETENTION', '数据保留与清理', 'Data retention', true],
    ['demo', 'DEMO', '静态演示', 'Static demo', true],
    ['protocol', `PROTOCOL-v${version}`, '版本与协议', 'Version and protocol', true],
    ['release', 'RELEASE', '维护与发布', 'Maintain and release', true],
    ['sources', 'SOURCES', '源码导航', 'Source map', true],
    ['licensing', 'LICENSING', '许可证说明', 'License guide', true],
  ];
  return ['zh', 'en'].flatMap((lang) =>
    topics.map(([key, base, zh, en, inDocs]) => ({
      id: `${lang}-${key}`,
      key,
      lang,
      title: lang === 'zh' ? zh : en,
      file: `${inDocs ? 'docs/' : ''}${base}${lang === 'en' ? '.en-US' : ''}.md`,
    })),
  );
}

function relativeLink(href, doc, byFile) {
  if (/^(https?:|mailto:)/i.test(href)) return href;
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) return '';
  const [fileAndQuery, fragment = ''] = href.split('#');
  const [file, query] = fileAndQuery.split('?');
  const target = file ? posix.normalize(posix.join(posix.dirname(doc.file), file)) : doc.file;
  const destination = byFile.get(`${doc.lang}:${target}`) ?? byFile.get(target);
  if (destination) return `#${destination.id}${fragment ? '-' + decodeURIComponent(fragment) : ''}`;
  if (target === 'docs/index.html') {
    const language = new URLSearchParams(query ?? '').get('lang') === 'en' ? 'en' : doc.lang;
    return `#${language}-guide`;
  }
  const relative = posix.relative('docs', licenseCopies.get(target) ?? target);
  const path = relative === '..' || relative.startsWith('../') ? relative : './' + relative;
  const slash = file.endsWith('/') && !path.endsWith('/') ? '/' : '';
  return `${path}${slash}${query ? '?' + query : ''}${fragment ? '#' + fragment : ''}`;
}

export function renderDocument(doc, byFile) {
  const headings = [];
  const seen = new Map();
  const parser = new Marked({ gfm: true, breaks: false });
  parser.use({
    renderer: {
      heading({ tokens, depth, text }) {
        const base = headingSlug(text);
        const count = seen.get(base) ?? 0;
        seen.set(base, count + 1);
        const id = `${doc.id}-${base}${count ? '-' + count : ''}`;
        const inner = this.parser.parseInline(tokens);
        headings.push({ id, depth, title: text.replace(/[`*]/g, '') });
        return `<h${depth} id="${htmlEscape(id)}">${inner}<a class="heading-link" href="#${htmlEscape(id)}" aria-label="${doc.lang === 'zh' ? '本节链接' : 'Link to section'}">#</a></h${depth}>\n`;
      },
      link({ href, title, tokens }) {
        const url = relativeLink(href, doc, byFile);
        const label = this.parser.parseInline(tokens);
        if (!url) return label;
        return `<a href="${htmlEscape(url)}"${title ? ` title="${htmlEscape(title)}"` : ''}>${label}</a>`;
      },
      image({ href, text }) {
        // The offline book does not load remote images or tracking pixels.
        const url = relativeLink(href, doc, byFile);
        return url
          ? `<a href="${htmlEscape(url)}">${htmlEscape(text || 'Image')}</a>`
          : htmlEscape(text);
      },
      html({ text }) {
        const anchor = text.match(/^\s*<a\s+id="([\p{L}\p{N}_-]+)"\s*>(?:<\/a>)?\s*$/u);
        if (anchor) return `<span id="${htmlEscape(doc.id + '-' + anchor[1])}"></span>\n`;
        if (/^\s*<\/a>\s*$/.test(text)) return '';
        // Treat document HTML as text; generated pages never execute it.
        return htmlEscape(text);
      },
      table(token) {
        return `<div class="table-scroll" tabindex="0">${Renderer.prototype.table.call(this, token)}</div>\n`;
      },
    },
  });
  const body = parser.parse(doc.markdown);
  const toc = headings.filter((h) => h.depth === 2 || h.depth === 3);
  const tocLabel = doc.lang === 'zh' ? '本页目录' : 'On this page';
  const sourceLabel = doc.lang === 'zh' ? '查看 Markdown 原文' : 'Read the Markdown source';
  return `<article id="${doc.id}" data-page="${doc.key}" data-language="${doc.lang}" lang="${doc.lang === 'zh' ? 'zh-CN' : 'en'}" aria-label="${htmlEscape(doc.title)}">
<p class="source-link"><a href="${htmlEscape(posix.relative('docs', doc.file))}">${sourceLabel}</a></p>
${toc.length ? `<details class="page-toc"><summary>${tocLabel}</summary><ol>${toc.map((h) => `<li class="depth-${h.depth}"><a href="#${htmlEscape(h.id)}">${htmlEscape(h.title)}</a></li>`).join('')}</ol></details>` : ''}
${body}</article>`;
}

export async function buildDocumentation(root = ROOT) {
  const { version } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const docs = await Promise.all(
    documentationFiles(version).map(async (doc) => ({
      ...doc,
      markdown: await readFile(resolve(root, doc.file), 'utf8'),
    })),
  );
  const byFile = new Map();
  for (const doc of docs) {
    byFile.set(`${doc.lang}:${doc.file}`, doc);
    if (!byFile.has(doc.file)) byFile.set(doc.file, doc);
  }
  const [style, client] = await Promise.all([
    readFile(resolve(root, 'scripts/docs-assets/style.css'), 'utf8'),
    readFile(resolve(root, 'scripts/docs-assets/client.mjs'), 'utf8'),
  ]);
  const scriptHash = createHash('sha256').update(client).digest('base64');
  const styleHash = createHash('sha256').update(style).digest('base64');
  const navigation = docs
    .map(
      (doc) =>
        `<a href="#${doc.id}" data-nav-language="${doc.lang}" data-nav-page="${doc.key}">${htmlEscape(doc.title)}</a>`,
    )
    .join('\n');
  const book = docs.map((doc) => renderDocument(doc, byFile)).join('\n');
  const contentHash = createHash('sha256')
    .update(docs.map((d) => d.file + '\0' + d.markdown).join('\0'))
    .digest('hex');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="Linro v${version}：从第一次运行到日常维护的中英双语离线手册。 Bilingual offline handbook, from first run to everyday maintenance.">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${scriptHash}'; style-src 'sha256-${styleHash}'; img-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="light"><meta name="theme-color" content="#e7f4f8">
<title>Linro v${version} · 使用手册 / Handbook</title>
<!-- Generated from the repository Markdown. Rebuild: npm run build:docs. Source digest: ${contentHash} -->
<style>${style}</style></head><body>
<a class="skip-link" href="#content">跳到正文 / Skip to content</a>
<header class="topbar"><a class="brand" href="#zh-readme">Linro <span>v${version}</span></a><span id="book-label">使用手册</span><div class="top-actions"><button id="language-button" type="button" aria-label="Switch to English">English</button><button id="print-button" type="button">打印本页</button></div></header>
<div class="book-layout"><aside class="sidebar"><div class="search-box"><label for="search" id="search-label">搜索全部文档</label><input id="search" type="search" placeholder="试试：密码、部署、API" autocomplete="off"><p id="search-status" role="status" aria-live="polite"></p></div><nav id="book-navigation" aria-label="文档目录 / Documents">${navigation}</nav><p class="offline-note" id="offline-note">内容已包含在此文件中，可断网阅读。外部参考链接需要联网。</p></aside>
<main id="content" tabindex="-1"><section id="search-results" hidden aria-label="搜索结果 / Search results"></section>${book}<noscript><p>JavaScript 已关闭，以下内容仍可阅读；请使用浏览器查找。 JavaScript is disabled. All chapters remain readable; use your browser's Find command.</p></noscript></main></div>
<script>${client}</script></body></html>\n`;
}

export async function syncDocumentation(root = ROOT, { check = false } = {}) {
  const outputs = await Promise.all(
    [...licenseCopies].map(async ([source, target]) => [
      target,
      await readFile(resolve(root, source)),
    ]),
  );
  outputs.push(['docs/index.html', Buffer.from(await buildDocumentation(root))]);
  if (!check) await mkdir(resolve(root, 'docs/licenses'), { recursive: true });
  for (const [name, bytes] of outputs) {
    const path = resolve(root, name);
    if (check) {
      const current = await readFile(path).catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (!current?.equals(bytes))
        throw new Error(
          `${name} is missing or out of date. Run npm run build:docs and commit the result.`,
        );
    } else {
      await writeFile(path, bytes);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) {
    console.error('Usage: npm run build:docs [-- --check]');
    process.exitCode = 1;
  } else {
    try {
      const check = args[0] === '--check';
      await syncDocumentation(ROOT, { check });
      console.log(
        check
          ? 'Handbook and license copies match their sources.'
          : 'Built docs/index.html and docs/licenses/.',
      );
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
