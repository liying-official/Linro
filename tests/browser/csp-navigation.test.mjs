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
  const chooseLanguage = (p, lang) => p.evaluate(`document.querySelector('a[hreflang="${lang}"]').click()`);
  const currentLanguage = p => p.evaluate("document.querySelector('#public-language [aria-current=true]').hreflang");
  const assertNoLicense = async p => assert.doesNotMatch(
    await p.evaluate('document.body.innerHTML'), /AGPL-3\.0-only|gnu\.org\/licenses\/agpl/i,
  );
  for (const options of [{ category: 'HOSTING_CLOUD_CONTENT' }, { tor: true }]) {
    await t.test(`early denial on ${options.category ?? 'Tor'} renders a bilingual 403 without a probe`, async sub => {
      const { f, p } = await fixture(sub, options);
      await p.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 740, deviceScaleFactor: 2, mobile: true });
      await p.navigate(f.shortOrigin + '/csp-check?_Linro_lang=zh-CN&ref=a%26b');
      await until(() => p.evaluate("document.readyState === 'complete' && !!document.querySelector('#browser-retry')"), 'Denial card missing');
      assert.equal(f.visits[0].status, 403);
      assert.equal(await currentLanguage(p), 'zh-CN');
      assert.match(await p.evaluate('document.body.innerText'), /浏览器环境检查未通过/);
      const requests = f.visits.length;
      await chooseLanguage(p, 'en');
      assert.equal(await currentLanguage(p), 'en');
      assert.equal(await p.evaluate('document.documentElement.lang'), 'en');
      assert.equal(await p.evaluate('document.title'), 'Browser environment check');
      assert.match(await p.evaluate('document.body.innerText'), /Access is denied/);
      assert.equal(await p.evaluate("new URL(document.querySelector('#browser-retry').href).searchParams.get('ref')"), 'a&b');
      assert.equal(await p.evaluate("new URL(location.href).searchParams.get('_Linro_lang')"), 'en');
      assert.ok(await p.evaluate('document.documentElement.scrollWidth <= innerWidth'));
      assert.equal(await p.evaluate("document.querySelector('form, .legal, a[href*=gnu]')"), null);
      assert.equal(f.visits.length, requests);
      assert.equal(f.visits.filter(v => v.method === 'POST').length, 0);
      assert.equal(f.count(), 0);
      assert.equal(f.targetVisits.length, 0);
      assert.deepEqual(await cspErrors(p), []);
    });
  }
  await t.test('language switches preserve password input and errors, then carry into the browser check', async sub => {
    const { f, p } = await fixture(sub, { password: true }, 'Europe/London');
    await p.navigate(f.shortOrigin + '/csp-check?_Linro_lang=zh-CN');
    await until(() => p.evaluate("document.readyState === 'complete' && !!document.querySelector('#password-form')"), 'Password page missing');
    await assertNoLicense(p);
    await p.evaluate("document.querySelector('#password').value = 'incorrect password'; document.querySelector('form').requestSubmit()");
    await until(() => p.evaluate("document.querySelector('#password-error')?.hidden === false"), 'Password error missing');
    await chooseLanguage(p, 'en');
    assert.equal(await p.evaluate("document.querySelector('#password').value"), 'incorrect password');
    assert.match(await p.evaluate('document.body.innerText'), /Incorrect password/);
    await assertNoLicense(p);
    assert.equal(await p.evaluate('document.title'), 'Enter the access password');
    await p.evaluate(`document.querySelector('#password').value = ${JSON.stringify(TEST_PASSWORD)}; document.querySelector('form').requestSubmit()`);
    await until(() => p.evaluate("document.querySelector('#browser-error')?.hidden === false"), 'Browser check failure missing');
    assert.equal(await currentLanguage(p), 'en');
    assert.match(await p.evaluate('document.body.innerText'), /The check did not pass/);
    await assertNoLicense(p);
    await p.evaluate("document.querySelector('[hreflang=en]').focus()");
    await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowLeft' });
    await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowLeft' });
    assert.equal(await currentLanguage(p), 'zh-CN');
    assert.match(await p.evaluate('document.body.innerText'), /检查未通过或暂时不可用/);
    assert.doesNotMatch(await p.evaluate('document.body.innerText'), /AGPL|The check did not pass/);
    assert.equal(f.visits.filter(v => v.path.startsWith('/__Linro_rtt')).length, 1);
    assert.equal(f.visits.filter(v => v.path.startsWith('/__Linro_browser/')).length, 1);
    assert.equal(f.count(), 0);
    assert.deepEqual(await cspErrors(p), []);
  });
  for (const code of [301, 302, 307, 308]) await t.test(`block_vpn redirect ${code} lands on a different origin with no CSP violation`, async sub => {
    const { f, p } = await fixture(sub, { code });
    await p.navigate(f.shortOrigin + '/csp-check'); await landed(f, p);
    assert.equal(await p.evaluate('document.body.innerText'), 'LINRO TEST TARGET');
    assert.deepEqual(await cspErrors(p), []); assert.deepEqual(p.blocked, []);
    assert.ok(!f.visits.some(v => v.path === '/favicon.ico'), 'Browser check must not fetch a fallback icon');
    assert.equal(f.visits.filter(v => v.path === '/__Linro_rtt' && v.method === 'POST' && v.status === 200).length, 1);
    const posts = f.visits.filter(v => v.path.startsWith('/__Linro_browser/') && v.method === 'POST'); assert.equal(posts.length, 1);
    assert.equal(posts[0].status, 200); assert.equal(posts[0].accept, 'application/json');
    assert.equal(posts[0].site, 'same-origin'); assert.match(posts[0].csp, /form-action 'self'/);
    assert.equal(f.targetVisits.filter(v => v.path === '/done').length, 1); assert.equal(f.count(), 1);
    assert.equal(f.events.filter(e => e.doubles[0] === 1).length, 1);
  });
  for (const code of [301, 302, 307, 308]) await t.test(`password-only redirect ${code} resumes a GET without CSP violations or a password body at the target`, async sub => {
    const { f, p } = await fixture(sub, { password: true, block: false, code });
    await p.navigate(f.shortOrigin + '/csp-check');
    await until(() => p.evaluate("document.readyState === 'complete' && !!document.querySelector('input[name=password]')"), 'Password page was not ready');
    assert.equal(f.count(),0);
    await p.evaluate(`document.querySelector('input[name=password]').value='wrong fixture password';document.querySelector('form').requestSubmit();`);
    await until(() => p.evaluate("document.getElementById('password-error')?.hidden === false"), 'Wrong-password error missing');
    assert.equal(f.count(),0); assert.equal(f.targetVisits.length,0);
    await p.evaluate(`document.querySelector('input[name=password]').value=${JSON.stringify(TEST_PASSWORD)};document.querySelector('form').requestSubmit();`);
    await landed(f,p); assert.deepEqual(await cspErrors(p),[]); assert.deepEqual(p.blocked,[]);
    assert.ok(!f.visits.some(v => v.path === '/favicon.ico'), 'Password page must not fetch a fallback icon');
    assert.deepEqual(f.visits.filter(v=>v.method==='POST').map(v=>[v.status,v.accept]),[[401,'application/json'],[200,'application/json']]);
    assert.deepEqual(f.targetVisits,[{path:'/done',method:'GET'}]); assert.equal(f.count(),1); assert.equal(f.events.filter(e=>e.doubles[0]===1).length,1);
  });
  await t.test('password + block_vpn completes scripted unlock then browser collection', async sub => {
    const { f, p } = await fixture(sub, { password: true, code: 301 });
    await p.navigate(f.shortOrigin + '/csp-check');
    await until(() => p.evaluate("document.readyState === 'complete' && !!document.querySelector('input[name=password]')"), 'Password page was not ready');
    await p.evaluate(`document.querySelector('input[name=password]').value=${JSON.stringify(TEST_PASSWORD)};document.querySelector('form').requestSubmit();`);
    await landed(f, p); assert.deepEqual(await cspErrors(p), []); assert.equal(f.count(), 1);
    const posts = f.visits.filter(v => v.method === 'POST' && v.path !== '/__Linro_rtt');
    assert.deepEqual(posts.map(p => p.status), [200, 200]); assert.equal(posts[0].accept, 'application/json'); assert.equal(posts[1].accept, 'application/json');
    assert.equal(posts[0].site, 'same-origin'); assert.equal(f.events.filter(e => e.doubles[0] === 1).length, 1);
  });
  await t.test('matching browser check serves literal text without executing its script-like body', async sub => {
    const { f, p } = await fixture(sub, { text: true });
    await p.navigate(f.shortOrigin + '/csp-check');
    await until(async () => (await p.evaluate('document.body.innerText')).includes('LINRO TEXT RESULT'), 'Plain text not reached');
    assert.match(await p.evaluate('document.body.innerText'), /<script>not executed<\/script>/);
    assert.deepEqual(await cspErrors(p), []); assert.equal(f.targetVisits.length, 0); assert.equal(f.count(), 1);
  });
  await t.test('a repeat visit reuses both hashed assets and runs a fresh protected flow', async sub => {
    const {f,p}=await fixture(sub,{block:false,global:true});
    const assets=()=>f.visits.filter(v=>v.path.startsWith('/__Linro_assets/')).map(v=>v.path).sort();
    await p.navigate(f.shortOrigin+'/csp-check');await landed(f,p);
    const first=assets();assert.equal(first.length,2);
    assert.ok(first.every(path=>/\.[0-9a-f]{16}\.(?:css|js)$/.test(path)));
    await p.navigate(f.shortOrigin+'/csp-check');
    await until(()=>f.count()===2,'Second visit did not complete');await landed(f,p);
    assert.deepEqual(assets(),first);
    assert.equal(f.visits.filter(v=>v.path.startsWith('/__Linro_browser/')&&v.method==='POST').length,2);
    assert.deepEqual(await cspErrors(p),[]);
  });
  await t.test('mismatch remains denied and the page does not disclose the signal or server error body', async sub => {
    const { f, p } = await fixture(sub, {}, 'Europe/London');
    await p.navigate(f.shortOrigin + '/csp-check');
    await until(() => p.evaluate("document.getElementById('browser-error')?.hidden === false"), 'Generic failure not shown');
    assert.equal(f.visits.filter(v => v.method === 'POST').length, 2); assert.equal(f.count(), 0); assert.equal(f.targetVisits.length, 0);
    assert.doesNotMatch(await p.evaluate('document.body.innerText'), /timezone|\bVPN\b|\bTor\b|时区|Cloudflare/i);
    assert.deepEqual(await cspErrors(p), []); assert.equal(f.events.filter(e => e.doubles[0] === 1).length, 0);
  });
  await t.test('reopening a password page fetches fresh HTML while reusing its password script and style', async sub => {
    const { f, p } = await fixture(sub, { block: false, password: true });
    const assets = () => f.visits.filter(v => v.path.startsWith('/__Linro_assets/')).map(v => v.path).sort();
    const open = async query => {
      await p.navigate(f.shortOrigin + '/csp-check' + query);
      await until(() => p.evaluate(`location.search === ${JSON.stringify(query)} && document.readyState === 'complete' && !!document.getElementById('password-form')`), 'Password page did not load');
    };
    await open('?visit=first');
    const first = assets();
    assert.equal(first.length, 2);
    assert.ok(first.every(path => /\/password\.[0-9a-f]{16}\.(css|js)$/.test(path)));
    await open('?visit=second');
    assert.deepEqual(assets(), first);
    assert.equal(f.visits.filter(v => v.path.startsWith('/csp-check?visit=')).length, 2);
    assert.equal(f.count(), 0);
    assert.deepEqual(await cspErrors(p), []);
  });
  await t.test('one slow probe denies a matching-timezone ISP visit without spending quota', async sub => {
    const { f, p } = await fixture(sub, { probeDelay: 100 });
    await p.navigate(f.shortOrigin + '/csp-check');
    await until(() => p.evaluate("document.getElementById('browser-error')?.hidden === false"), 'Latency denial missing');
    assert.equal(f.visits.filter(v => v.path === '/__Linro_rtt' && v.status === 200).length, 1);
    assert.deepEqual(f.events.map(e => e.blobs[9]), ['latency_mismatch']);
    assert.equal(f.count(), 0); assert.equal(f.targetVisits.length, 0);
  });
  await t.test('global collection off + unblocked link retains a direct response', async sub => {
    const { f, p } = await fixture(sub, { block: false, global: false, code: 301 });
    await p.navigate(f.shortOrigin + '/csp-check'); await landed(f, p);
    assert.equal(f.visits.filter(v => v.method === 'POST').length, 0); assert.equal(f.visits[0].status, 301); assert.equal(f.count(), 1);
    assert.deepEqual(await cspErrors(p), []);
  });
  await t.test('negative control: legacy form chain is blocked by form-action, not a failed HTTP response', async sub => {
    const { f, p } = await fixture(sub, { legacyScript: true, block: false, global: true });
    await p.navigate(f.shortOrigin + '/csp-check');
    await until(async () => (await cspErrors(p)).some(e => /form-action/i.test(e)), 'Negative control did not reproduce form-action enforcement');
    assert.notEqual(await p.evaluate('location.href'), f.targetOrigin + '/done');
    assert.equal(f.targetVisits.filter(v => v.path === '/done').length, 0);
    assert.ok(f.visits.some(v => v.method === 'POST' && v.status === 303));
    assert.ok(f.visits.some(v => v.method === 'GET' && v.status === 302));
    // The server authorized its redirect; delivery is not the quota contract.
    assert.equal(f.count(), 1);
  });
  await t.test('negative control: legacy password-only native form is blocked by the unchanged form-action policy', async sub => {
    const {f,p}=await fixture(sub,{password:true,block:false,legacyPassword:true});
    await p.navigate(f.shortOrigin+'/csp-check');
    await until(()=>p.evaluate("!!document.querySelector('input[name=password]')"),'Password prompt missing');
    await p.evaluate(`document.querySelector('input[name=password]').value=${JSON.stringify(TEST_PASSWORD)};document.querySelector('form').requestSubmit();`);
    await until(async()=> (await cspErrors(p)).some(e=>/form-action/i.test(e)),'Legacy password chain did not reproduce CSP enforcement');
    assert.equal(f.targetVisits.length,0);assert.ok(f.visits.some(v=>v.method==='POST'&&v.status===303));assert.equal(f.count(),1);
  });
});
