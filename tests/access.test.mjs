import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyAccess, validateAccessConfig } from '../.build/packages/shared/src/access.js';
import { environment, admin, call } from './harness.mjs';

const issuer = 'https://jwt-unit-test.cloudflareaccess.com';
const audience = 'a'.repeat(64);
const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...await crypto.subtle.exportKey('jwk', keys.publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' };
const b64 = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
const now = () => Math.floor(Date.now() / 1000);
async function signed(claims = {}, header = {}, signer = keys.privateKey) {
  const h = b64({ alg: 'RS256', kid: 'test-key', ...header });
  const p = b64({ type: 'app', iss: issuer, aud: [audience], sub: 'owner-subject', email: 'owner@example.com', iat: now() - 5, exp: now() + 300, ...claims });
  return h + '.' + p + '.' + Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signer, new TextEncoder().encode(h + '.' + p))).toString('base64url');
}
const fetchKeys = async (url, options) => {
  assert.match(String(url), /^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com\/cdn-cgi\/access\/certs$/);
  assert.equal(options.redirect, 'manual'); // Supplemented by native workerd tests in tests/runtime/.
  return Response.json({ keys: [jwk] });
};
const invalid = (fn, status = 401) => assert.rejects(fn, error => error.status === status);

test('RS256 verifies a real 2048-bit signature and accepts string/array audiences', async () => {
  assert.equal((await verifyAccess(await signed(), issuer, audience, fetchKeys)).email, 'owner@example.com');
  assert.equal((await verifyAccess(await signed({ aud: audience }), issuer, audience, fetchKeys)).sub, 'owner-subject');
});
test('claims reject wrong issuer/audience, expiry, future issue/not-before and absent subject', async () => {
  for (const claims of [{ iss: 'https://evil.cloudflareaccess.com' }, { aud: 'x'.repeat(64) }, { aud: [audience, 7] }, { exp: now() - 1 }, { iat: now() + 90 }, { nbf: now() + 90 }, { sub: '' }, { type: 'org' }, { exp: '123' }, { iat: 1.2 }]) {
    await invalid(async () => verifyAccess(await signed(claims), issuer, audience, fetchKeys));
  }
});
test('algorithm confusion, token-controlled key sources and unknown critical headers are rejected', async () => {
  for (const header of [{ alg: 'none' }, { alg: 'HS256' }, { jku: 'https://evil.example/jwks' }, { jwk }, { x5u: 'https://evil.example/key' }, { crit: ['b64'] }, { kid: 'unknown-key' }]) {
    await invalid(async () => verifyAccess(await signed({}, header), issuer, audience, fetchKeys));
  }
});
test('signature tampering, malformed segments and oversized assertions fail closed', async () => {
  const token = await signed(); const parts = token.split('.');
  parts[1] = b64({ type: 'app', iss: issuer, aud: audience, sub: 'attacker', exp: now() + 300, iat: now() });
  for (const value of [parts.join('.'), '', 'a.b.c', token + '.extra', token.slice(0, -10), 'x'.repeat(16385)]) await invalid(() => verifyAccess(value, issuer, audience, fetchKeys));
});
test('weak RSA keys and untrusted deployment issuer configurations are not accepted', async () => {
  const weakIssuer = 'https://weak-key-test.cloudflareaccess.com';
  const weak = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 1024, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const publicKey = { ...await crypto.subtle.exportKey('jwk', weak.publicKey), kid: 'test-key' };
  await invalid(async () => verifyAccess(await signed({ iss: weakIssuer }, {}, weak.privateKey), weakIssuer, audience, async () => Response.json({ keys: [publicKey] })));
  for (const configured of ['http://test.cloudflareaccess.com', 'https://test.cloudflareaccess.com.evil.example', 'https://test.cloudflareaccess.com/']) assert.throws(() => validateAccessConfig(configured, audience), e => e.status === 503);
});
test('JWKS outages are explicit 503s and an unknown kid does not cause repeated immediate fetches', async () => {
  const badIssuer = 'https://keys-unavailable-test.cloudflareaccess.com';
  await invalid(async () => verifyAccess(await signed({ iss: badIssuer }), badIssuer, audience, async () => new Response('unavailable', { status: 503 })), 503);
  const cacheIssuer = 'https://cache-test.cloudflareaccess.com'; let requests = 0;
  const fetcher = async () => { requests++; return Response.json({ keys: [jwk] }); };
  await verifyAccess(await signed({ iss: cacheIssuer }), cacheIssuer, audience, fetcher);
  for (let i = 0; i < 3; i++) await invalid(async () => verifyAccess(await signed({ iss: cacheIssuer }, { kid: 'unknown-' + i }), cacheIssuer, audience, fetcher));
  assert.equal(requests, 1);
});
test('production integration requires signed Access, checks CSRF and never trusts an email header', async t => {
  const originalFetch = globalThis.fetch; globalThis.fetch = fetchKeys; t.after(() => { globalThis.fetch = originalFetch; });
  const env = environment({ ENVIRONMENT: 'production', ADMIN_ORIGIN: 'https://admin.example.com', ACCESS_ISSUER: issuer, ACCESS_AUD: audience }); t.after(() => env.DB.close());
  const jwt = await signed(); const options = { noDev: true, headers: { 'Cf-Access-Jwt-Assertion': jwt } };
  assert.equal((await call(env, '/session', 'GET', undefined, { noDev: true, headers: { 'Cf-Access-Authenticated-User-Email': 'owner@example.com' } })).status, 401);
  assert.equal((await call(env, '/session', 'GET', undefined, options)).status, 200);
  for (const headers of [{ Origin: 'https://evil.example' }, { Origin: 'null', 'Sec-Fetch-Site': 'same-origin' }, { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'same-origin' }, { 'X-Linro-CSRF': '' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    assert.equal((await call(env, '/domains', 'POST', { hostname: 'go.example.org' }, { ...options, headers: { ...options.headers, ...headers } })).status, 403);
  }
  assert.equal((await call(env, '/domains', 'POST', { hostname: 'go.example.org' }, options)).status, 201);
  assert.equal((await admin.fetch(new Request(env.ADMIN_ORIGIN + '/deep/link', { headers: options.headers }), env)).status, 200);
  const stranger = await signed({ email: 'stranger@example.com', sub: 'stranger' });
  assert.equal((await call(env, '/session', 'GET', undefined, { noDev: true, headers: { 'Cf-Access-Jwt-Assertion': stranger } })).status, 403);
  const changedSub = await signed({ sub: 'different-subject' });
  assert.equal((await call(env, '/session', 'GET', undefined, { noDev: true, headers: { 'Cf-Access-Jwt-Assertion': changedSub } })).status, 403);
});
test('automation requires both an Access service assertion and an application-scoped token', async t => {
  const originalFetch = globalThis.fetch; globalThis.fetch = fetchKeys; t.after(() => { globalThis.fetch = originalFetch; });
  const env = environment({ ENVIRONMENT: 'production', ADMIN_ORIGIN: 'https://admin.example.com', ACCESS_ISSUER: issuer, ACCESS_AUD: audience }); t.after(() => env.DB.close());
  const browser = { noDev: true, headers: { 'Cf-Access-Jwt-Assertion': await signed() } };
  assert.equal((await call(env, '/session', 'GET', undefined, browser)).status, 200);
  const created = await call(env, '/tokens', 'POST', { name: 'automation', scopes: ['links:read'], expires_at: now() + 30 * 86400 }, browser);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const token = created.data.token;
  assert.equal((await call(env, '/links', 'GET', undefined, { noDev: true, headers: { Authorization: 'Bearer ' + token } })).status, 401);
  const service = await signed({ email: undefined, sub: '', common_name: 'unit-service-token.access' });
  const headers = { 'Cf-Access-Jwt-Assertion': service };
  assert.equal((await call(env, '/links', 'GET', undefined, { noDev: true, headers })).status, 403);
  assert.equal((await call(env, '/links', 'GET', undefined, { noDev: true, headers: { ...headers, Authorization: 'Bearer ' + token } })).status, 200);
});
