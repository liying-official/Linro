import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, cp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { configs, validateConfig } from '../scripts/config-lib.mjs';
import { securityPolicy } from '../.build/packages/shared/src/policy.js';
const valid = { account_id: 'b'.repeat(32), database_id: '11111111-1111-4111-8111-111111111111', admin_host: 'admin.example.com', redirect_hosts: ['go.example.com', 's.example.net'], access_issuer: 'https://test.cloudflareaccess.com', access_aud: 'a'.repeat(64), owner_email: 'owner@example.com' };
async function preflight(t, pair) {
  const dir = await mkdtemp(join(tmpdir(), 'cf-links-preflight-security-')); t.after(() => rm(dir, { recursive: true, force: true }));
  await cp(new URL('../scripts/', import.meta.url), join(dir, 'scripts'), { recursive: true });
  for (const name of ['admin', 'redirect']) { await mkdir(join(dir, 'apps', name), { recursive: true }); await writeFile(join(dir, 'apps', name, 'wrangler.jsonc'), JSON.stringify(pair[name])); }
  return spawnSync(process.execPath, ['scripts/preflight.mjs'], { cwd: dir, encoding: 'utf8' });
}
test('legacy deployment input generates explicit, identical fail-closed security policy on both Workers', async t => {
  const pair = configs(valid); const p = securityPolicy(pair.redirect.vars);
  assert.deepEqual(p.queryKeys, ['utm_source','utm_medium','utm_campaign','utm_term','utm_content']);
  assert.deepEqual(p.privateTargets, []); assert.equal(p.expiredStatus, 404); assert.deepEqual(securityPolicy(pair.admin.vars), p);
  assert.equal(pair.redirect.vars.ADMIN_ORIGIN, pair.admin.vars.ADMIN_ORIGIN);
  assert.deepEqual(pair.redirect.ratelimits, [{ name: 'REDIRECT_LIMITER', namespace_id: '21003', simple: { limit: 300, period: 60 } }, { name: 'PASSWORD_LIMITER', namespace_id: '21004', simple: { limit: 5, period: 60 } }]);
  assert.equal((await preflight(t, pair)).status, 0);
});
test('reviewed query/private exceptions, custom public rate and explicit 410 round-trip through preflight', async t => {
  const pair = configs({ ...valid, query_forward_allowlist: ['utm_source','ref'], private_target_allowlist: ['192.168.1.8','printer.local'], expired_link_status: 410, redirect_rate_namespace: '29003', redirect_rate_limit: 90 });
  const p = securityPolicy(pair.redirect.vars); assert.deepEqual(p.queryKeys, ['utm_source','ref']); assert.deepEqual(p.privateTargets, ['192.168.1.8','printer.local']); assert.equal(p.expiredStatus, 410);
  assert.equal((await preflight(t, pair)).status, 0);
});
test('all public/Admin rate namespaces must be distinct and rates positive bounded integers', () => {
  for (const delta of [{ redirect_rate_namespace: '21001' }, { redirect_rate_namespace: '21002' }, { redirect_rate_namespace: 0 }, { redirect_rate_limit: 0 }, { redirect_rate_limit: -1 }, { redirect_rate_limit: 1.1 }, { redirect_rate_limit: 100001 }, { redirect_rate_limit: '300' }]) assert.throws(() => validateConfig({ ...valid, ...delta }));
});
test('configuration and Worker reject the same malformed query-key policies', () => {
  for (const keys of [['next'], ['redirect_uri'], ['access_token'], ['return_to'], ['callback'], ['client_id'], ['password'], ['x','x'], ['CamelCase'], ['bad-key'], [1], Array.from({ length: 33 }, (_, i) => 'k' + i)]) {
    assert.throws(() => validateConfig({ ...valid, query_forward_allowlist: keys }), JSON.stringify(keys));
    assert.throws(() => securityPolicy({ QUERY_FORWARD_ALLOWLIST: JSON.stringify(keys) }), JSON.stringify(keys));
  }
});
test('configuration and Worker reject invalid exact target exception syntax', () => {
  for (const hosts of [['*'], ['*.example.org'], ['10.0.0.0/8'], ['127.1'], ['http://a.example'], ['a.example/path'], ['a.example:80'], ['a.example.'], ['EXAMPLE.ORG'], ['host','host'], [1]]) {
    assert.throws(() => validateConfig({ ...valid, private_target_allowlist: hosts }), JSON.stringify(hosts));
    assert.throws(() => securityPolicy({ PRIVATE_TARGET_ALLOWLIST: JSON.stringify(hosts) }), JSON.stringify(hosts));
  }
});
test('old generated configurations missing redirect binding, origin or policy cannot pass preflight', async t => {
  for (const remove of [p => { delete p.redirect.ratelimits; }, p => { delete p.redirect.vars.ADMIN_ORIGIN; }, p => { delete p.redirect.vars.QUERY_FORWARD_ALLOWLIST; }, p => { delete p.admin.vars.PRIVATE_TARGET_ALLOWLIST; }]) {
    const pair = configs(valid); remove(pair); const result = await preflight(t, pair); assert.equal(result.status, 1); assert.match(result.stderr, /Preflight blocked deployment/);
  }
});
test('policy drift, sensitive-key injection and invalid limiter windows fail preflight', async t => {
  for (const change of [p => { p.redirect.vars.PRIVATE_TARGET_ALLOWLIST = '["192.168.1.1"]'; }, p => { p.redirect.ratelimits[0].namespace_id = '21001'; }, p => { p.redirect.ratelimits[0].simple.period = 10; }, p => { p.redirect.ratelimits[0].simple.limit = 0; }, p => { p.admin.vars.QUERY_FORWARD_ALLOWLIST = p.redirect.vars.QUERY_FORWARD_ALLOWLIST = '["next"]'; }, p => { p.redirect.vars.EXPIRED_LINK_STATUS = p.admin.vars.EXPIRED_LINK_STATUS = '200'; }]) {
    const pair = configs(valid); change(pair); assert.equal((await preflight(t, pair)).status, 1);
  }
});
test('CI and deploy gate require native runtime tests; the runtime command cannot silently skip', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const ci = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const runtime = await readFile(new URL('./runtime/fetch-security.test.mjs', import.meta.url), 'utf8');
  assert.match(pkg.scripts['test:runtime'], /npm run toolchain:versions && npm run test:runtime:canary && node --test/);
  assert.equal(pkg.scripts['test:runtime:canary'], 'node --test tests/runtime/api-canary.test.mjs');
  assert.match(pkg.scripts.deploy, /npm run test:runtime &&/); assert.match(ci, /npm run test:runtime/);
  assert.doesNotMatch(runtime, /test\.skip|\.skip\(|skip: true/); assert.match(runtime, /new Miniflare/); assert.match(runtime, /outboundService: router.outboundService/);
  assert.match(runtime, /router.assertComplete\(\)/);
  assert.match(runtime, /convertV4MiniflareOptions/);
});
