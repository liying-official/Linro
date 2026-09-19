import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadRuntimeToolchain } from '../../scripts/runtime-toolchain.mjs';
import { createOutboundRouter } from './outbound-router.mjs';

// Use the pinned tools bundled with Wrangler. Missing tools MUST fail the gate.
// The official converter supplies the Miniflare 5 workers[] representation;
// the deleted createFetchMock/fetchMock API is not used.
const { Miniflare, convertV4MiniflareOptions, build } = loadRuntimeToolchain();
const bundled = await build({ entryPoints: [fileURLToPath(new URL('./worker.ts', import.meta.url))], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false });
const script = bundled.outputFiles[0].text;
const issuer = 'https://runtime-jwks.cloudflareaccess.com';
const aud = 'r'.repeat(64);
const account = 'a'.repeat(32);
const endpoint = `https://api.cloudflare.com/client/v4/accounts/${account}/analytics_engine/sql`;
const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'runtime-test-key', alg: 'RS256', use: 'sig' };
async function token(changes = {}) {
  const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${enc({ alg: 'RS256', kid: jwk.kid })}.${enc({ type: 'app', iss: issuer, aud, sub: 'runtime-user', email: 'user@example.com', iat: now - 10, exp: now + 300, ...changes })}`;
  return `${unsigned}.${Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(unsigned))).toString('base64url')}`;
}
async function fixture(t) {
  const router = createOutboundRouter();
  const mf = new Miniflare(convertV4MiniflareOptions({ cf: false, modules: true, script, compatibilityDate: '2026-09-15', outboundService: router.outboundService, bindings: {
    ACCESS_ISSUER: issuer, ACCESS_AUD: aud, ANALYTICS_ENABLED: 'true', ANALYTICS_DATASET: 'cf_links_clicks',
    CLOUDFLARE_ACCOUNT_ID: account, ANALYTICS_API_TOKEN: 'runtime-fixture-not-a-real-secret',
  } }));
  t.after(async () => { try { await mf.dispose(); } finally { router.assertComplete(); } });
  return { mf, router };
}
async function access(mf, jwt = undefined) {
  return mf.dispatchFetch('https://test.invalid/jwks', { redirect: 'manual', method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: jwt ?? await token() }) });
}
test('workerd native fetch obtains JWKS and verifies a real RSA signature', { timeout: 60000 }, async t => {
  const { mf, router } = await fixture(t);
  router.expect({ url: issuer + '/cdn-cgi/access/certs' }, { status: 200, body: JSON.stringify({ keys: [jwk] }) });
  const response = await access(mf); assert.equal(response.status, 200);
  assert.equal((await response.json()).data.sub, 'runtime-user');
  router.assertComplete();
});
for (const code of [301, 302, 303, 307, 308]) test(`workerd JWKS ${code} never follows another host or accepts redirected keys`, { timeout: 60000 }, async t => {
  const { mf, router } = await fixture(t); let followed = 0;
  router.expect({ url: issuer + '/cdn-cgi/access/certs' }, { status: code, headers: { location: 'https://must-not-contact.invalid/keys' } });
  router.expect({ url: 'https://must-not-contact.invalid/keys' }, () => { followed++; return { status: 200, body: JSON.stringify({ keys: [jwk] }) }; }, { optional: true, persist: true });
  const response = await access(mf); assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'access_keys_unavailable'); assert.equal(followed, 0);
});
test('workerd rejects malformed JWKS and keeps access fail-closed', { timeout: 60000 }, async t => {
  const { mf, router } = await fixture(t);
  router.expect({ url: issuer + '/cdn-cgi/access/certs' }, { status: 200, body: '{"keys":[]}' });
  const response = await access(mf); assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'access_keys_unavailable');
});
test('workerd Analytics query uses native POST fetch and reads a successful result', { timeout: 60000 }, async t => {
  const { mf, router } = await fixture(t);
  router.expect({ url: endpoint, method: 'POST', headers: { authorization: 'Bearer runtime-fixture-not-a-real-secret' }, body: 'SELECT 1 FORMAT JSON' }, { status: 200, body: '{"data":[{"ok":1}]}' });
  const response = await mf.dispatchFetch('https://test.invalid/analytics', { redirect: 'manual' });
  assert.equal(response.status, 200); assert.deepEqual((await response.json()).data, [{ ok: 1 }]);
  router.assertComplete();
});
for (const code of [301, 302, 303, 307, 308]) test(`workerd Analytics ${code} never forwards bearer credentials`, { timeout: 60000 }, async t => {
  const { mf, router } = await fixture(t); let followed = 0;
  router.expect({ url: endpoint, method: 'POST' }, { status: code, headers: { location: 'https://must-not-contact.invalid/collect' } });
  for (const method of ['GET', 'POST']) router.expect({ url: 'https://must-not-contact.invalid/collect', method }, () => { followed++; return { status: 200, body: '{"data":[]}' }; }, { optional: true, persist: true });
  const response = await mf.dispatchFetch('https://test.invalid/analytics', { redirect: 'manual' }); assert.equal(response.status, 502);
  assert.equal((await response.json()).error.code, 'analytics_query_failed'); assert.equal(followed, 0);
});
