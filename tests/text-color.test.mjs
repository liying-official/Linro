// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const foregrounds = css => [...css.matchAll(/(?<![\w-])color:\s*(#[0-9a-f]{6})\b/gi)].map(match => match[1].toUpperCase());

test('admin foregrounds, body/muted tokens and SVG chart text use unified dark ink', () => {
  const css = read('apps/admin/src/web/styles.css');
  const colors = foregrounds(css);
  assert.ok(colors.length > 90, 'Inspect the complete existing theme, not only its last override.');
  assert.deepEqual([...new Set(colors)], ['#0D394A']);
  assert.match(css, /--body-text:\s*#0D394A/i);
  assert.match(css, /--muted:\s*#0D394A/i);
  assert.match(css, /\.chart text\s*\{\s*fill:\s*#0D394A/i);
});

test('password and browser-check pages use unified text but retain sky/white and focus styling', () => {
  const source = read('apps/redirect/src/public-pages.ts');
  const css = /export const PASSWORD_CSS = `([\s\S]*?)`;/u.exec(source)?.[1];
  assert.ok(css);
  assert.ok(foregrounds(css).length >= 8);
  assert.deepEqual([...new Set(foregrounds(css))], ['#0D394A']);
  assert.match(css, /background:#87CEEB/);
  assert.match(css, /background:#FFFFFF/);
  assert.match(css, /outline:3px solid #2145C4/);
  assert.match(read('apps/redirect/src/browser-page.ts'), /\/__Linro_assets\/password\.css/);
});

test('text-only refinement preserves the published version, license, sky/white palette and documents current ink', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.version, '1.0.1');
  assert.equal(pkg.license, 'AGPL-3.0-only');
  const css = read('apps/admin/src/web/styles.css');
  assert.match(css, /--accent:\s*#87CEEB/i);
  assert.match(css, /background:\s*#FFFFFF/i);
  assert.match(css, /outline-color:\s*#2145C4/i);
  assert.match(read('README.md'), /普通正文与说明文字 `#0D394A`/);
});
