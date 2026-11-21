import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { buildDocumentation, documentationFiles, headingSlug, renderDocument } from '../scripts/build-docs.mjs';

test('offline handbook contains every document in both languages with unique working fragments', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const html = await buildDocumentation();
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(ids.length, new Set(ids).size, 'fragment IDs must not collide across documents');
  for (const doc of documentationFiles(pkg.version)) assert.ok(ids.includes(doc.id), doc.file);
  for (const match of html.matchAll(/href="#([^"]+)"/g)) {
    const id = match[1].replaceAll('&amp;', '&');
    assert.ok(ids.includes(id), `Unresolved offline fragment: ${id}`);
  }
  assert.match(html, /href="\.\.\/LICENSES\/"/, 'source directory links must retain their trailing slash');
  assert.equal(html, await buildDocumentation(), 'building twice must be deterministic');
});

test('offline handbook is self-contained and authorizes only its exact script and stylesheet', async () => {
  const html = await buildDocumentation();
  assert.doesNotMatch(html, /<(?:script|link|img)\b[^>]*(?:src|href)=/i);
  assert.match(html, /connect-src 'none'/);
  for (const tag of ['script', 'style']) {
    const blocks = [...html.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'g'))];
    assert.equal(blocks.length, 1);
    const digest = createHash('sha256').update(blocks[0][1]).digest('base64');
    assert.ok(html.includes(`${tag}-src 'sha256-${digest}'`));
  }
});

test('Markdown renderer preserves tables and cross-file links while escaping executable HTML', () => {
  const doc = { id: 'en-guide', key: 'guide', lang: 'en', title: 'Guide', file: 'docs/GUIDE.en-US.md', markdown: '# Hello `world`\n\n<a id="start"></a>\n\n[API](API.en-US.md#requests)\n\n| Key | Value |\n| --- | --- |\n| text | yes |\n\n<script>alert(1)</script>\n\n[Unsafe](javascript:alert%281%29)\n' };
  const target = { id: 'en-api' };
  const html = renderDocument(doc, new Map([['en:docs/API.en-US.md', target]]));
  assert.match(html, /id="en-guide-hello-world"/);
  assert.match(html, /id="en-guide-start"/);
  assert.match(html, /href="#en-api-requests"/);
  assert.match(html, /<table>/);
  assert.match(html, /<td>yes<\/td>/);
  assert.doesNotMatch(html, /<script|href="javascript:/);
  assert.match(html, /&lt;script&gt;/);
  assert.equal(headingSlug('2. 安装与使用 `API`'), '2-安装与使用-api');
});
