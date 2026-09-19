import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRuntimeToolchain } from '../../scripts/runtime-toolchain.mjs';
import { createOutboundRouter } from './outbound-router.mjs';

// This command runs BEFORE the semantic suite. API/toolchain failure is a
// dedicated failing canary, never 18 misleading semantic failures or a skip.
const { Miniflare, convertV4MiniflareOptions, versions } = loadRuntimeToolchain();
console.log('Native toolchain:', JSON.stringify(versions));
test('Miniflare 5 API canary: /health, raw 303, and outboundService work without Internet', { timeout: 60000 }, async t => {
  const router = createOutboundRouter();
  router.expect({ url: 'https://upstream.invalid/ping' }, { status: 200, body: 'intercepted' });
  const mf = new Miniflare(convertV4MiniflareOptions({
    cf: false, modules: true, compatibilityDate: '2026-09-15', outboundService: router.outboundService,
    script: `export default { async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === '/health') return Response.json({status:'ok'});
      if (path === '/redirect') return Response.redirect('https://never-contact.invalid/target',303);
      return fetch('https://upstream.invalid/ping', {redirect:'manual'});
    } };`,
  }));
  t.after(async () => { try { await mf.dispose(); } finally { router.assertComplete(); } });
  const health = await mf.dispatchFetch('https://test.invalid/health', { redirect: 'manual' });
  assert.equal(health.status, 200); assert.deepEqual(await health.json(), { status: 'ok' });
  const moved = await mf.dispatchFetch('https://test.invalid/redirect', { redirect: 'manual' });
  assert.equal(moved.status, 303); assert.equal(moved.headers.get('location'), 'https://never-contact.invalid/target');
  const intercepted = await mf.dispatchFetch('https://test.invalid/outbound', { redirect: 'manual' });
  assert.equal(intercepted.status, 200); assert.equal(await intercepted.text(), 'intercepted');
  assert.equal(router.calls.length, 1);
});

// The native transport, not production authorization, is the subject here.
// If an upgrade starts preserving empty values, this FAILS until the native
// matrix is reviewed. Do not silently relabel a dropped header as an empty one.
test('native request-header fidelity: empty values are absent, nonempty values survive', { timeout: 60000 }, async t => {
  const router = createOutboundRouter(); // any unexpected egress is a test failure
  const mf = new Miniflare(convertV4MiniflareOptions({
    cf: false, modules: true, compatibilityDate: '2026-09-15', outboundService: router.outboundService,
    script: `export default { fetch(request) {
      return Response.json(Object.fromEntries(['origin','x-probe','sec-fetch-site'].map(name =>
        [name, {present: request.headers.has(name), value: request.headers.get(name)}])));
    } };`,
  }));
  t.after(async () => { try { await mf.dispose(); } finally { router.assertComplete(); } });
  for (const empty of ['', ' ']) {
    const r = await mf.dispatchFetch('https://test.invalid/probe', { redirect: 'manual', method: 'POST',
      headers: { origin: empty, 'x-probe': empty, 'sec-fetch-site': 'same-origin' }, body: 'probe' });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), {
      origin: { present: false, value: null }, 'x-probe': { present: false, value: null },
      'sec-fetch-site': { present: true, value: 'same-origin' },
    }, 'Native transport behavior changed: review deniedOriginsNodeOnly instead of weakening policy.');
  }
  for (const value of ['null', 'NULL', 'https://test.invalid']) {
    const r = await mf.dispatchFetch('https://test.invalid/probe', { redirect: 'manual', method: 'POST',
      headers: { origin: value, 'x-probe': value }, body: 'probe' });
    const actual = await r.json();
    assert.deepEqual(actual.origin, { present: true, value });
    assert.deepEqual(actual['x-probe'], { present: true, value });
    assert.deepEqual(actual['sec-fetch-site'], { present: false, value: null });
  }
});
