import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildDocumentation, documentationFiles, headingSlug, renderDocument, syncDocumentation } from '../scripts/build-docs.mjs';

const notices = {
  'LICENSE.txt': 'LICENSE',
  'NOTICE.txt': 'NOTICE',
  'TailAdmin-MIT.txt': 'LICENSES/TailAdmin-MIT.txt',
  'Recharts-MIT.txt': 'LICENSES/Recharts-MIT.txt',
};

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
  assert.doesNotMatch(html, /href="\.\.\/(?:LICENSE|NOTICE)(?:S?\/|")/);
  for (const lang of ['zh', 'en']) {
    for (const section of ['readme', 'licensing']) {
      const article = html.split(`<article id="${lang}-${section}"`)[1].split('</article>')[0];
      for (const name of Object.keys(notices)) {
        assert.ok(article.includes(`href="./licenses/${name}"`), `${lang}-${section}: ${name}`);
      }
    }
  }
  assert.equal(html, await buildDocumentation(), 'building twice must be deterministic');
});

test('a docs build copies the original notice bytes and check mode detects missing and stale copies', async t => {
  const root = await mkdtemp(join(tmpdir(), 'linro-handbook-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = new URL('../', import.meta.url);
  const { version } = JSON.parse(await readFile(new URL('package.json', source), 'utf8'));
  const inputs = [
    'package.json',
    ...documentationFiles(version).map(doc => doc.file),
    ...Object.values(notices),
    'scripts/docs-assets/style.css',
    'scripts/docs-assets/client.mjs',
  ];
  for (const file of inputs) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await copyFile(new URL(file, source), join(root, file));
  }
  await syncDocumentation(root);
  for (const [name, original] of Object.entries(notices)) {
    assert.deepEqual(await readFile(join(root, 'docs/licenses', name)), await readFile(join(root, original)));
  }
  const copy = join(root, 'docs/licenses/NOTICE.txt');
  await rm(copy);
  await assert.rejects(syncDocumentation(root, { check: true }), /docs\/licenses\/NOTICE\.txt/);
  await assert.rejects(readFile(copy), { code: 'ENOENT' });
  await writeFile(copy, 'stale notice');
  await assert.rejects(syncDocumentation(root, { check: true }), /docs\/licenses\/NOTICE\.txt/);
  assert.equal(await readFile(copy, 'utf8'), 'stale notice');
  await syncDocumentation(root);
  await syncDocumentation(root, { check: true });
  assert.deepEqual(await readFile(copy), await readFile(join(root, 'NOTICE')));
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
  assert.match(renderDocument({ ...doc, markdown: '[Examples](../examples/)' }, new Map()), /href="\.\.\/examples\/"/);
  assert.match(html, /<table>/);
  assert.match(html, /<td>yes<\/td>/);
  assert.doesNotMatch(html, /<script|href="javascript:/);
  assert.match(html, /&lt;script&gt;/);
  assert.equal(headingSlug('2. 安装与使用 `API`'), '2-安装与使用-api');
});
