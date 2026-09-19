import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixture, challenge, submit, send, count, current, patch } from './browser-fixture.mjs';
import { prefersJSON } from '../.build/apps/redirect/src/browser-page.js';
import { scriptHarness } from './browser-script-harness.mjs';
import { deniedOrigins, deniedOriginsNodeOnly } from './unlock-cases.mjs';
import { isSameOriginUnlock } from '../.build/apps/redirect/src/unlock-origin.js';

for (const kv of [false, true]) for (const mode of ['redirect', 'text']) test(`D4 JSON ${mode} success shares the legacy proof and cannot spend quota; KV=${kv}`, async t => {
  const f = await fixture(t, { block_vpn: true, ...(mode === 'text' ? { response_mode: 'text', text_content: 'private body <script>literal</script>', target_url: '' } : {}) }, { kv });
  const c = await challenge(f, '/docs?utm_source=test&_Linro_lang=zh-CN');
  const path = '/__Linro_browser/docs?utm_source=test&_Linro_lang=zh-CN';
  const legacy = await submit(f, c.token, 'Asia/Tokyo', path);
  const modern = await submit(f, c.token, 'Asia/Tokyo', path, { headers: { accept: 'application/json' } });
  assert.equal(legacy.status, 303); assert.equal(modern.status, 200);
  assert.equal(modern.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(modern.headers.get('location'), null);
  assert.deepEqual(await modern.clone().json(), { ok: true, data: { next: legacy.headers.get('location') } });
  assert.equal(modern.headers.get('set-cookie').split(';')[0], legacy.headers.get('set-cookie').split(';')[0]);
  for (const response of [legacy, modern]) {
    assert.match(response.headers.get('vary'), /Accept/);
    assert.match(response.headers.get('cache-control'), /no-store/);
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.match(response.headers.get('content-security-policy'), /form-action 'self'/);
    assert.doesNotMatch(response.headers.get('content-security-policy'), /unsafe-inline|unsafe-eval|\*/);
  }
  assert.equal(count(f), 0); assert.equal(f.events.length, 0);
  assert.doesNotMatch(await modern.text(), /example\.org|private body|timezone|challenge/);
  const resume = legacy.headers.get('location');
  assert.equal((await send(f, resume)).status, 403, 'next without proof is not authorization');
  const final = await send(f, resume, { headers: { cookie: modern.headers.get('set-cookie').split(';')[0] } });
  assert.equal(final.status, mode === 'text' ? 200 : 301); assert.equal(count(f), 1); assert.equal(f.events.length, 1);
  if (mode === 'text') assert.equal(await final.text(), 'private body <script>literal</script>');
  else assert.equal(final.headers.get('location'), 'https://example.org/docs');
});

for (const [accept, expected] of [
  [null, false], ['*/*', false], ['text/html', false], ['application/json', true],
  ['text/html, application/json;q=0.8', true], ['Application/JSON; charset=utf-8', true],
  ['application/json;q=0', false], ['application/json;q=0.000', false],
  ['application/json;q=1.000', true], ['application/json;q=1.1', false],
  ['application/json;q=no', false], ['application/json;q=0;q=1', false],
  ['application/json-bogus', false], ['application/*', false], ['application/problem+json', false],
]) test(`D4 explicit JSON negotiation: ${accept}`, () => {
  const r = new Request('https://go.example.com/', { headers: accept === null ? {} : { accept } });
  assert.equal(prefersJSON(r), expected);
});

for (const [name, headers] of [...deniedOrigins, ...deniedOriginsNodeOnly]) test(`D4 JSON keeps origin rejection: ${name}`, async t => {
  const f = await fixture(t, { block_vpn: true }); const c = await challenge(f);
  const r = await send(f, '/__Linro_browser/docs', { method: 'POST', headers: { ...headers, accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ challenge: c.token, timezone: 'Asia/Tokyo' }).toString() });
  assert.equal(r.status, 403); assert.equal(r.headers.get('set-cookie'), null); assert.equal(r.headers.get('location'), null);
  assert.equal(count(f), 0); assert.equal(f.events.length, 0);
});

for (const kind of ['mismatch', 'unknown', 'tor', 'forged', 'revision', 'query', 'missing-password', 'rate-limit', 'database']) test(`D4 JSON representation cannot override ${kind} failure`, async t => {
  const f = await fixture(t, { block_vpn: true }); const c = await challenge(f);
  let token = c.token, tz = 'Asia/Tokyo', path = '/__Linro_browser/docs', options = { headers: { accept: 'application/json' } }, expected = 403;
  if (kind === 'mismatch') tz = 'Europe/London';
  if (kind === 'unknown') tz = '';
  if (kind === 'tor') options.cf = { country: 'T1', timezone: 'Asia/Tokyo' };
  if (kind === 'forged') token = token.slice(0, -8) + 'tampered';
  if (kind === 'revision') await patch(f, { title: 'Invalidate outstanding challenge' });
  if (kind === 'query') path += '?different=1';
  if (kind === 'missing-password') await patch(f, { password: 'test-new-password-for-f1' });
  if (kind === 'rate-limit') { f.env.REDIRECT_LIMITER = { limit: async () => ({ success: false }) }; expected = 429; }
  if (kind === 'database') { f.env.DB.prepare = () => { throw Error('DB test failure'); }; expected = 503; }
  const r = await submit(f, token, tz, path, options);
  assert.equal(r.status, expected); assert.equal(r.headers.get('set-cookie'), null); assert.equal(r.headers.get('location'), null);
  assert.equal(count(f), 0); assert.ok(f.events.every(e => e.doubles[0] === 0));
});

test('D4 JSON after password unlock requires both proofs and rechecks current D1', async t => {
  const f = await fixture(t, { block_vpn: true, password: 'test-long-password-f1' }, { kv: true });
  const unlock = await send(f, '/__Linro_unlock/docs', { method: 'POST', headers: { origin: 'null', 'sec-fetch-site': 'same-origin', 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=test-long-password-f1' });
  assert.equal(unlock.status, 303); const pw = unlock.headers.get('set-cookie').split(';')[0];
  const c = await challenge(f, '/docs', { headers: { cookie: pw } });
  const r = await submit(f, c.token, 'Asia/Tokyo', '/__Linro_browser/docs', { headers: { cookie: pw, accept: 'application/json' } });
  assert.equal(r.status, 200); const { next } = (await r.json()).data;
  assert.equal(count(f), 0); assert.equal(f.events.length, 0);
  const cookie = pw + '; ' + r.headers.get('set-cookie').split(';')[0];
  await patch(f, { enabled: false });
  const rejected = await send(f, next, { headers: { cookie } });
  assert.equal(rejected.status, 404); assert.equal(count(f), 0); assert.equal(f.events.length, 0);
});

for (const locale of ['zh-CN', 'en']) for (const blocked of [false, true]) test(`public collection text is generic: ${locale}, block=${blocked}`, async t => {
  const f = await fixture(t, { block_vpn: blocked }); const c = await challenge(f, '/docs?_Linro_lang=' + locale);
  const visible = c.html.replace(/<[^>]*>/g, '');
  assert.doesNotMatch(visible, /时区|timezone|\bVPN\b|\bTor\b|Cloudflare|\bIntl\b|访问统计|analytics/i);
  assert.match(visible, locale === 'zh-CN' ? /该页面已开启浏览器环境检查，检查通过后会自动跳转。/ : /browser environment checks enabled.*redirected automatically/);
  assert.match(c.html, /<noscript>/); assert.doesNotMatch(c.html, /<script(?![^>]*src=)|onload=|onsubmit=/i);
  assert.equal(c.response.headers.get('content-language'), locale);
});

for (const status of [400, 401, 403, 404, 410, 429, 500, 503]) test(`script shows a generic failure without a second POST on ${status}`, async () => {
  const h = scriptHarness({ fetcher: async () => new Response('UNTRUSTED DETAILS <script>x</script>', { status }) }); await h.settled();
  assert.equal(h.requests.length, 1); assert.equal(h.forms.length, 0); assert.equal(h.navigations.length, 0); assert.equal(h.error.hidden, false); assert.equal(h.timers.size, 0);
});

for (const [name, result] of [
  ['external absolute URL', { ok: true, data: { next: 'https://evil.example/docs?_Linro_check=1' } }],
  ['protocol relative URL', { ok: true, data: { next: '//evil.example/docs?_Linro_check=1' } }],
  ['backslash URL', { ok: true, data: { next: '/\\evil.example/docs?_Linro_check=1' } }],
  ['wrong short link', { ok: true, data: { next: '/other?_Linro_check=1' } }],
  ['missing marker', { ok: true, data: { next: '/docs' } }],
  ['duplicate marker', { ok: true, data: { next: '/docs?_Linro_check=1&_Linro_check=1' } }],
  ['fragment', { ok: true, data: { next: '/docs?_Linro_check=1#fragment' } }],
  ['raw newline', { ok: true, data: { next: '/docs?x=\n&_Linro_check=1' } }],
  ['wrong ok type', { ok: 'true', data: { next: '/docs?_Linro_check=1' } }],
  ['missing data', { ok: true }], ['null', null],
]) test(`script never navigates to malformed next (${name}); fallback stays on its own form`, async () => {
  const h = scriptHarness({ fetcher: async () => Response.json(result) }); await h.settled();
  assert.equal(h.requests.length, 1); assert.equal(h.navigations.length, 0); assert.equal(h.forms.length, 1);
  assert.equal(h.forms[0].action, 'https://go.example.com/__Linro_browser/docs?utm_source=fixture'); assert.equal(h.timers.size, 0);
});

for (const action of ['https://evil.example/__Linro_browser/docs', 'https://go.example.com/other', 'https://go.example.com/__Linro_browser/docs#frag']) test(`invalid form action is rejected before fetch or legacy navigation: ${action}`, async () => {
  const h = scriptHarness({ action }); await h.settled(); h.form.requestSubmit(); await h.settled();
  assert.equal(h.requests.length, 0); assert.equal(h.navigations.length, 0); assert.equal(h.forms.length, 0); assert.equal(h.error.hidden, false);
});

test('script handles a network/protocol failure with at most one legacy fallback', async () => {
  const h = scriptHarness({ fetcher: async () => { throw Error('Network failure'); } }); await h.settled();
  assert.equal(h.requests.length, 1); assert.equal(h.forms.length, 1); assert.equal(h.navigations.length, 0);
  h.form.requestSubmit(); await h.settled();
  assert.equal(h.forms.length, 1); assert.equal(h.error.hidden, false); assert.equal(h.timers.size, 0);
});
test('script suppresses duplicate clicks while its single same-origin request is pending', async () => {
  let release; const promise = new Promise(resolve => { release = resolve; });
  const h = scriptHarness({ fetcher: () => promise }); h.form.requestSubmit();
  assert.equal(h.requests.length, 1);
  release(Response.json({ ok: true, data: { next: '/docs?utm_source=fixture&_Linro_check=1' } })); await h.settled();
  assert.deepEqual(h.navigations, ['/docs?utm_source=fixture&_Linro_check=1']); assert.equal(h.forms.length, 0); assert.equal(h.timers.size, 0);
});
test('script bounds a stalled request and cleans its timer', async () => {
  const h = scriptHarness({ fetcher: (_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Error('aborted')))) });
  assert.equal(h.timers.size, 1); const timer = [...h.timers.values()][0]; assert.equal(timer.ms, 10000); timer.callback();
  await h.settled(); assert.equal(h.forms.length, 1); assert.equal(h.navigations.length, 0); assert.equal(h.timers.size, 0);
});

test('D3 Node retains and rejects empty Origin separately from native-expressible cases', () => {
  assert.ok(deniedOriginsNodeOnly.length >= 1);
  assert.ok(deniedOrigins.every(([, headers]) => headers.origin === undefined || headers.origin.trim() !== ''));
  for (const [, headers] of deniedOriginsNodeOnly) {
    const request = new Request('https://go.example.com/__Linro_unlock/docs', { method: 'POST', headers });
    assert.equal(request.headers.has('origin'), true); assert.equal(request.headers.get('origin'), ''); assert.equal(isSameOriginUnlock(request), false);
  }
  const native = readFileSync(new URL('./runtime/link-controls.test.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(native, /deniedOrigins\.filter|deniedOriginsNodeOnly/);
  const canary = readFileSync(new URL('./runtime/api-canary.test.mjs', import.meta.url), 'utf8');
  assert.match(canary, /request-header fidelity/); assert.match(canary, /request\.headers\.has\(name\)/); assert.match(canary, /present: false, value: null/);
});

test('script refuses a changed form action before its bounded compatibility fallback', async () => {
  let reject; const h = scriptHarness({ fetcher: () => new Promise((_, fail) => { reject = fail; }) });
  h.form.action = 'https://evil.example/__Linro_browser/docs'; reject(Error('Network failure'));
  await h.settled(); assert.equal(h.requests.length, 1); assert.equal(h.forms.length, 0); assert.equal(h.navigations.length, 0);
  assert.equal(h.error.hidden, false); assert.equal(h.timers.size, 0);
});
