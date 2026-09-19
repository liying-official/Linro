import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, until } from './chromium-cdp.mjs';
import { cspFixture, TEST_PASSWORD } from './csp-fixture.mjs';

// A real Chromium-family browser is mandatory: missing tools/policy blocks fail
// this suite. Node/network tests are NOT treated as substitutes for CSP checks.
test('Chromium CSP navigation regression (real engine, loopback Worker/SQLite fixture)', { timeout: 180000 }, async t => {
  const browser = await chromium(); t.after(() => browser.close());
  console.log(JSON.stringify({ browser: browser.version, executable: browser.command, noSandbox: browser.noSandbox,
    fixture: 'Node + compiled Worker + SQLite; cf metadata is a test input; no Cloudflare deployment' }));
  async function fixture(sub, options = {}, timezone = 'Asia/Tokyo') {
    const f = await cspFixture(options); sub.after(() => f.close());
    const p = await browser.page([f.shortOrigin, f.targetOrigin], timezone); sub.after(() => p.close());
    return { f, p };
  }
  const cspErrors = async p => [...p.log.filter(e => /Content Security Policy|form-action/i.test(e.text ?? '')).map(e => e.text), ...(await p.evaluate('window.__cflCSP || []') ?? [])];
  const landed = async (f, p) => until(async () => (await p.evaluate('location.href')) === f.targetOrigin + '/done', 'Browser did not reach the target. ' + JSON.stringify(p.failures));
  for (const code of [301, 302, 307, 308]) await t.test(`F1 block_vpn redirect ${code} lands on a different origin with no CSP violation`, async sub => {
    const { f, p } = await fixture(sub, { code });
    await p.navigate(f.shortOrigin + '/csp-check'); await landed(f, p);
    assert.equal(await p.evaluate('document.body.innerText'), 'CF-LINKS TEST TARGET');
    assert.deepEqual(await cspErrors(p), []); assert.deepEqual(p.blocked, []);
    const posts = f.visits.filter(v => v.method === 'POST'); assert.equal(posts.length, 1);
    assert.equal(posts[0].status, 200); assert.equal(posts[0].accept, 'application/json');
    assert.equal(posts[0].site, 'same-origin'); assert.match(posts[0].csp, /form-action 'self'/);
    assert.equal(f.targetVisits.filter(v => v.path === '/done').length, 1); assert.equal(f.count(), 1);
    assert.equal(f.events.filter(e => e.doubles[0] === 1).length, 1);
  });
  await t.test('password + block_vpn completes real form navigation then scripted collection', async sub => {
    const { f, p } = await fixture(sub, { password: true, code: 301 });
    await p.navigate(f.shortOrigin + '/csp-check');
    await until(() => p.evaluate("!!document.querySelector('input[name=password]')"), 'Password prompt missing');
    await p.evaluate(`document.querySelector('input[name=password]').value=${JSON.stringify(TEST_PASSWORD)};document.querySelector('form').requestSubmit();`);
    await landed(f, p); assert.deepEqual(await cspErrors(p), []); assert.equal(f.count(), 1);
    const posts = f.visits.filter(v => v.method === 'POST');
    assert.deepEqual(posts.map(p => p.status), [303, 200]); assert.equal(posts[1].accept, 'application/json');
    assert.equal(posts[0].site, 'same-origin'); assert.equal(f.events.filter(e => e.doubles[0] === 1).length, 1);
  });
  await t.test('matching browser check serves literal text without executing its script-like body', async sub => {
    const { f, p } = await fixture(sub, { text: true });
    await p.navigate(f.shortOrigin + '/csp-check');
    await until(async () => (await p.evaluate('document.body.innerText')).includes('CF-LINKS TEXT RESULT'), 'Plain text not reached');
    assert.match(await p.evaluate('document.body.innerText'), /<script>not executed<\/script>/);
    assert.deepEqual(await cspErrors(p), []); assert.equal(f.targetVisits.length, 0); assert.equal(f.count(), 1);
  });
  await t.test('mismatch remains denied and the page does not disclose the signal or server error body', async sub => {
    const { f, p } = await fixture(sub, {}, 'Europe/London');
    await p.navigate(f.shortOrigin + '/csp-check');
    await until(() => p.evaluate("document.getElementById('browser-error')?.hidden === false"), 'Generic failure not shown');
    assert.equal(f.visits.filter(v => v.method === 'POST').length, 1); assert.equal(f.count(), 0); assert.equal(f.targetVisits.length, 0);
    assert.doesNotMatch(await p.evaluate('document.body.innerText'), /timezone|\bVPN\b|\bTor\b|时区|Cloudflare/i);
    assert.deepEqual(await cspErrors(p), []); assert.equal(f.events.filter(e => e.doubles[0] === 1).length, 0);
  });
  await t.test('global collection off + unblocked link retains a direct response', async sub => {
    const { f, p } = await fixture(sub, { block: false, global: false, code: 301 });
    await p.navigate(f.shortOrigin + '/csp-check'); await landed(f, p);
    assert.equal(f.visits.filter(v => v.method === 'POST').length, 0); assert.equal(f.visits[0].status, 301); assert.equal(f.count(), 1);
    assert.deepEqual(await cspErrors(p), []);
  });
  await t.test('negative control: legacy form chain is blocked by form-action, not a failed HTTP response', async sub => {
    const { f, p } = await fixture(sub, { legacyScript: true });
    await p.navigate(f.shortOrigin + '/csp-check');
    await until(async () => (await cspErrors(p)).some(e => /form-action/i.test(e)), 'Negative control did not reproduce form-action enforcement');
    assert.notEqual(await p.evaluate('location.href'), f.targetOrigin + '/done');
    assert.equal(f.targetVisits.filter(v => v.path === '/done').length, 0);
    assert.ok(f.visits.some(v => v.method === 'POST' && v.status === 303));
    assert.ok(f.visits.some(v => v.method === 'GET' && v.status === 302));
    // The server authorized its redirect; delivery is not the quota contract.
    assert.equal(f.count(), 1);
  });
});
