import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../apps/admin/src/web/App.tsx', import.meta.url), 'utf8');
const i18n = readFileSync(new URL('../apps/admin/src/web/i18n.ts', import.meta.url), 'utf8');

test('GUI supports Simplified Chinese and English locale switching', () => {
  assert.match(i18n, /export type Locale = 'zh-CN' \| 'en'/);
  assert.match(i18n, /localeLabels: Record<Locale, string>/);
  assert.match(app, /renderLanguageSwitch\(/);
  assert.match(app, /this\.setLocale\(locale\)/);
  assert.match(app, /locale: detectLocale\(\)/);
});

test('dashboard and sidebar marketing filler are removed from the source layout', () => {
  assert.doesNotMatch(app, /Cloudflare 原生部署/);
  assert.doesNotMatch(app, /轻量跳转，/);
  assert.doesNotMatch(app, /永久跳转不等于永久缓存/);
  assert.doesNotMatch(app, /workspace-lock/);
  assert.doesNotMatch(app, /guide-panel/);
});
