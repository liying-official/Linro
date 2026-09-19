import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { VERSION } from '../.build/packages/shared/src/platform.js';
const ts = createRequire(import.meta.url)('typescript');
const text = readFileSync(new URL('../apps/admin/src/web/i18n.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
function runtime({ saved = null, language = 'en-US', deny = false, noBrowser = false } = {}) {
  const values = new Map(saved === null ? [] : [['cf-links-locale', saved]]);
  const context = { exports: {} };
  if (!noBrowser) Object.assign(context, {
    localStorage: { getItem(key) { if (deny) throw Error('Storage denied'); return values.get(key) ?? null; }, setItem(key, value) { if (deny) throw Error('Storage denied'); values.set(key, value); } },
    navigator: { language }, document: { documentElement: { lang: '' } },
  });
  vm.runInNewContext(compiled, context);
  return { api: context.exports, context, values };
}

test('saved Chinese locale overrides English browser preference', () => {
  assert.equal(runtime({ saved: 'zh-CN', language: 'en-US' }).api.detectLocale(), 'zh-CN');
});
test('saved English locale overrides Chinese browser preference', () => {
  assert.equal(runtime({ saved: 'en', language: 'zh-CN' }).api.detectLocale(), 'en');
});
test('missing/invalid preference uses supported browser-language fallback', () => {
  for (const [language, expected] of [['zh-CN', 'zh-CN'], ['zh-TW', 'zh-CN'], ['en-GB', 'en'], ['ja-JP', 'en']]) {
    assert.equal(runtime({ language }).api.detectLocale(), expected);
    assert.equal(runtime({ language, saved: 'unsupported' }).api.detectLocale(), expected);
  }
});
test('localStorage access failure does not crash language detection or switching', () => {
  const r = runtime({ deny: true, language: 'zh-CN' });
  assert.equal(r.api.detectLocale(), 'zh-CN'); r.api.applyLocale('en'); assert.equal(r.context.document.documentElement.lang, 'en');
});
test('language change persists and updates html lang without changing unrelated storage', () => {
  const r = runtime(); r.values.set('unrelated', 'preserve');
  for (const locale of ['zh-CN', 'en']) {
    r.api.applyLocale(locale); assert.equal(r.values.get('cf-links-locale'), locale);
    assert.equal(r.api.detectLocale(), locale); assert.equal(r.context.document.documentElement.lang, locale);
  }
  assert.equal(r.values.get('unrelated'), 'preserve');
});
test('language helpers tolerate execution without a browser environment', () => {
  const r = runtime({ noBrowser: true }); assert.equal(r.api.detectLocale(), 'zh-CN'); assert.doesNotThrow(() => r.api.applyLocale('en'));
});

test('both UI dictionaries have the same complete nested keys and value types', () => {
  const source = ts.createSourceFile('App.tsx', readFileSync(new URL('../apps/admin/src/web/App.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const statement = source.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText(source) === 'UI'));
  assert.ok(statement);
  const script = ts.transpileModule(statement.getText(source) + '\nexports.UI = UI;', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const context = { exports: {}, VERSION }; vm.runInNewContext(script, context); const ui = context.exports.UI;
  function compare(a, b, path) {
    assert.equal(typeof a, typeof b, path);
    if (a && typeof a === 'object') {
      assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort(), path);
      for (const key of Object.keys(a)) compare(a[key], b[key], `${path}.${key}`);
    } else if (typeof a === 'string') { assert.ok(a.length > 0 && b.length > 0, path); }
    else if (typeof a === 'function') { assert.equal(a.length, b.length, path); }
  }
  compare(ui['zh-CN'], ui.en, 'UI');
  assert.ok(ui['zh-CN'].login.runtime.includes(VERSION)); assert.ok(ui.en.login.runtime.includes(VERSION));
});
