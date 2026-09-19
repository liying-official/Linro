import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptedOrigins, deniedOrigins, deniedOriginsNodeOnly } from './unlock-cases.mjs';
import { featureFixture, createLink, PASSWORD, request, count, cookie } from './feature-helpers.mjs';
import { checkCSRF } from '../.build/apps/admin/src/worker/auth.js';
import { isSameOriginUnlock } from '../.build/apps/redirect/src/unlock-origin.js';

for (const [name, headers] of acceptedOrigins) test(`D2 accepts ${name} but still verifies password, D1 revision and quota`, async t => {
  const { env, domain } = await featureFixture(t, { kv: true });
  const link = await createLink(env, domain, { password: PASSWORD, max_redirects: 2 });
  env.ENVIRONMENT = 'production'; env.ADMIN_ORIGIN = 'https://admin.example.com';
  const initial = await request(env, '/docs');
  assert.equal(initial.status, 200); assert.equal(initial.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(initial.headers.get('location'), null); assert.doesNotMatch(await initial.text(), /https:\/\/example\.org\/docs/);
  const unlocked = await request(env, '/__Linro_unlock/docs', { method: 'POST', headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ password: PASSWORD }).toString() });
  assert.equal(unlocked.status, 303); assert.equal(unlocked.headers.get('location'), '/docs');
  assert.match(unlocked.headers.get('set-cookie'), /__Host-.*HttpOnly.*SameSite=Lax.*Secure/);
  assert.equal(count(env, link.id), 0, 'internal 303 is not a counted redirect');
  const granted = await request(env, '/docs', { headers: { cookie: cookie(unlocked) } });
  assert.equal(granted.status, 301); assert.equal(granted.headers.get('location'), 'https://example.org/docs'); assert.equal(count(env, link.id), 1);
  env.DB.sqlite.prepare('UPDATE links SET title=? WHERE id=?').run('revoke cookie', link.id);
  const revoked = await request(env, '/docs', { headers: { cookie: cookie(unlocked) } });
  assert.equal(revoked.status, 200); assert.equal(revoked.headers.get('location'), null); assert.equal(count(env, link.id), 1);
});
for (const [name, headers] of [...deniedOrigins, ...deniedOriginsNodeOnly]) test(`D2 rejects ${name} without password work, cookie, Location or count`, async t => {
  let attempts = 0;
  const { env, domain } = await featureFixture(t, { kv: true, PASSWORD_LIMITER: { limit: async () => { attempts++; return { success: true }; } } });
  const link = await createLink(env, domain, { password: PASSWORD, max_redirects: 2 });
  const r = await request(env, '/__Linro_unlock/docs', { method: 'POST', headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded', 'accept-language': 'en' }, body: new URLSearchParams({ password: PASSWORD }).toString() });
  assert.equal(r.status, 403); assert.equal(r.headers.get('location'), null); assert.equal(r.headers.get('set-cookie'), null);
  assert.equal(await r.text(), 'Please submit the form from the short link password page.');
  assert.match(r.headers.get('cache-control'), /no-store/); assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(attempts, 0); assert.equal(count(env, link.id), 0);
});
test('D2 denied form message is bilingual and does not echo attacker-controlled headers or queries', async t => {
  const { env, domain } = await featureFixture(t); await createLink(env, domain, { password: PASSWORD });
  const r = await request(env, '/__Linro_unlock/docs?_Linro_lang=zh-CN&target=unsafe', { method: 'POST', headers: { origin: 'https://evil.example', 'sec-fetch-site': 'same-origin', 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=' + PASSWORD });
  assert.equal(r.status, 403); assert.equal(r.headers.get('content-language'), 'zh-CN');
  assert.equal(await r.text(), '请从短链密码页提交。');
});
test('D2 opaque-origin allowance does not bypass wrong password, form bounds or password rate limiting', async t => {
  const { env, domain } = await featureFixture(t); const link = await createLink(env, domain, { password: PASSWORD, max_redirects: 2 });
  const headers = { origin: 'null', 'sec-fetch-site': 'same-origin', 'content-type': 'application/x-www-form-urlencoded' };
  for (const [body, status, type] of [['password=wrong-long-password', 401], ['password=a&password=b', 400], ['password=' + 'x'.repeat(8192), 413], [JSON.stringify({ password: PASSWORD }), 415, 'application/json']]) {
    const r = await request(env, '/__Linro_unlock/docs', { method: 'POST', headers: { ...headers, 'content-type': type ?? headers['content-type'] }, body });
    assert.equal(r.status, status); assert.equal(r.headers.get('set-cookie'), null); assert.equal(r.headers.get('location'), null);
  }
  env.PASSWORD_LIMITER = { limit: async () => ({ success: false }) };
  assert.equal((await request(env, '/__Linro_unlock/docs', { method: 'POST', headers, body: new URLSearchParams({ password: PASSWORD }).toString() })).status, 429);
  assert.equal(count(env, link.id), 0);
});
for (const method of ['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS']) test(`D2 ${method} unlock endpoint is uniform 405 Allow:POST and does no D1 work`, async t => {
  const { env, domain } = await featureFixture(t); await createLink(env, domain, { password: PASSWORD });
  env.DB.queries.length = 0;
  for (const slug of ['docs', 'absent']) {
    const r = await request(env, '/__Linro_unlock/' + slug, { method });
    assert.equal(r.status, 405); assert.equal(r.headers.get('allow'), 'POST'); assert.equal(r.headers.get('location'), null);
    if (method === 'HEAD') assert.equal(await r.text(), '');
  }
  assert.equal(env.DB.queries.length, 0);
});
test('D2 does not relax the existing Admin Access-session CSRF guard', () => {
  // Local development secrets are explicit credentials, not ambient Access
  // cookies. Test the Access principal here; access.test covers real RSA flow.
  const env = { ADMIN_ORIGIN: 'https://admin.example.com' };
  const principal = { kind: 'access' };
  for (const origin of ['null', 'https://evil.example']) {
    assert.throws(() => checkCSRF(new Request(env.ADMIN_ORIGIN + '/Linro/v1/links', {
      method: 'POST', headers: { Origin: origin, 'Sec-Fetch-Site': 'same-origin', 'X-Linro-CSRF': '1' },
    }), principal, env), error => error.status === 403 && error.code === 'csrf');
  }
  assert.doesNotThrow(() => checkCSRF(new Request(env.ADMIN_ORIGIN + '/Linro/v1/links', {
    method: 'POST', headers: { Origin: env.ADMIN_ORIGIN, 'Sec-Fetch-Site': 'same-origin', 'X-Linro-CSRF': '1' },
  }), principal, env));
});
test('D2 check is exact for port and scheme and cannot normalize a foreign Origin into an allow', () => {
  assert.equal(isSameOriginUnlock(new Request('https://go.example.com:444/__Linro_unlock/docs', { method: 'POST', headers: { origin: 'https://go.example.com:444' } })), true);
  assert.equal(isSameOriginUnlock(new Request('https://go.example.com:444/__Linro_unlock/docs', { method: 'POST', headers: { origin: 'https://go.example.com', 'sec-fetch-site': 'same-origin' } })), false);
});
