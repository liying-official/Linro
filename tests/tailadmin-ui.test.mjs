import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
function component(file, name) {
  const output = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  const exports = {}; new Function('require', 'exports', output)(require, exports); return exports[name];
}
const TrafficChart = component('apps/admin/src/web/TrafficChart.tsx', 'TrafficChart');

test('Recharts retains fractional sample counts and exposes the complete data as accessible text', () => {
  const html = renderToStaticMarkup(React.createElement(TrafficChart, { locale: 'en', rows: [{ date: '2026-09-21', clicks: 3.25125 }, { date: '2026-09-22', clicks: 0 }] }));
  assert.match(html, /Daily click trend/); assert.match(html, /View chart data/);
  assert.match(html, /3\.25125/); assert.match(html, /2026-09-21/); assert.match(html, /2026-09-22/);
});
test('chart empty states and data tables are bilingual, and untrusted labels are escaped', () => {
  const empty = renderToStaticMarkup(React.createElement(TrafficChart, { locale: 'zh-CN', rows: [] }));
  assert.match(empty, /暂无点击数据/); assert.doesNotMatch(empty, /recharts-wrapper/);
  const html = renderToStaticMarkup(React.createElement(TrafficChart, { locale: 'zh-CN', rows: [{ date: '<img src=x onerror=alert(1)>', clicks: 12 }] }));
  assert.match(html, /查看图表数据/); assert.match(html, /&lt;img/); assert.doesNotMatch(html, /<img/);
});
test('dependency graph contains Recharts but no ApexCharts, and upstream MIT attribution is retained', () => {
  const pkg = JSON.parse(read('package.json')), lock = JSON.parse(read('package-lock.json'));
  assert.ok(pkg.dependencies.recharts); assert.equal(pkg.dependencies['react-is'], pkg.dependencies.react);
  assert.ok(!Object.keys(lock.packages).some(name => /(?:^|\/)(?:apexcharts|react-apexcharts)$/.test(name)));
  assert.match(read('LICENSES/TailAdmin-MIT.txt'), /Copyright \(c\) 2023 TailAdmin/);
  assert.match(read('LICENSES/Recharts-MIT.txt'), /MIT License/);
  assert.equal(pkg.license, 'AGPL-3.0-only');
});
