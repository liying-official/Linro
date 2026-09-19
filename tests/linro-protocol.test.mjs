import test from 'node:test';
import assert from 'node:assert/strict';
import { environment, setup, call, createLink, admin, redirect } from './harness.mjs';
import { sha256 } from '../.build/packages/shared/src/crypto.js';
import { checkCSRF } from '../.build/apps/admin/src/worker/auth.js';
import { issueUnlockCookie, hasUnlockCookie } from '../.build/packages/shared/src/link-password.js';
import { slug } from '../.build/packages/shared/src/validation.js';

test('new API authenticates; retired API cannot fall through to GUI; old dev header fails', async t => {
  const env = environment(); t.after(() => env.DB.close());
  const fetch = (path, headers) => admin.fetch(new Request(env.ADMIN_ORIGIN + path, { headers }), env);
  assert.equal((await fetch('/Linro/v1/session', { 'X-Linro-Dev': env.LOCAL_DEV_TOKEN })).status, 200);
  for (const path of ['/api', '/api/v1/session']) assert.equal((await fetch(path, { 'X-Linro-Dev': env.LOCAL_DEV_TOKEN })).status, 404);
  assert.equal((await fetch('/Linro/v1/session', { 'X-CF-Links-Dev': env.LOCAL_DEV_TOKEN })).status, 401);
  assert.equal((await fetch('/Linro/v2/session', { 'X-Linro-Dev': env.LOCAL_DEV_TOKEN })).status, 404);
});

test('new token works end to end; even a stored legacy token is rejected; revoked token stays rejected', async t => {
  const { env } = await setup(); t.after(() => env.DB.close());
  const made = await call(env, '/tokens', 'POST', { name: 'Protocol regression', scopes: ['links:read'], expires_at: Math.floor(Date.now()/1000)+3600 });
  assert.equal(made.status, 201); const token = made.data.token; assert.match(token, /^Linro_[A-Za-z0-9_-]{43}$/);
  const auth = value => admin.fetch(new Request(env.ADMIN_ORIGIN + '/Linro/v1/links', { headers: { Authorization: 'Bearer '+value } }), env);
  assert.equal((await auth(token)).status, 200);
  const legacy = token.replace(/^Linro_/, 'cfl_');
  await env.DB.prepare('UPDATE api_tokens SET token_hash=? WHERE token_hash=?').bind(await sha256(legacy), await sha256(token)).run();
  assert.equal((await auth(legacy)).status, 401);
  await env.DB.prepare('UPDATE api_tokens SET token_hash=?, revoked_at=1 WHERE token_hash=?').bind(await sha256(token), await sha256(legacy)).run();
  assert.equal((await auth(token)).status, 401);
});

test('CSRF accepts only the new header, retaining same-origin and fetch-site constraints', () => {
  const env = { ADMIN_ORIGIN: 'https://admin.example.com' }, principal = { kind: 'access' };
  const request = headers => new Request(env.ADMIN_ORIGIN+'/Linro/v1/links', { method: 'POST', headers: { Origin: env.ADMIN_ORIGIN, 'Sec-Fetch-Site': 'same-origin', ...headers } });
  assert.doesNotThrow(() => checkCSRF(request({ 'X-Linro-CSRF': '1' }), principal, env));
  assert.throws(() => checkCSRF(request({ 'X-CF-Links-CSRF': '1' }), principal, env), e => e.status === 403);
  assert.throws(() => checkCSRF(request({ 'X-Linro-CSRF': '1', Origin: 'https://evil.example' }), principal, env), e => e.status === 403);
});

test('new production cookie is host-bound and legacy cookie names do not grant access', async t => {
  const { env, domain } = await setup({ LINK_PASSWORD_SECRET: 'p'.repeat(43) }); t.after(() => env.DB.close());
  const link = await createLink(env, domain, { slug: 'private' });
  const production = { ...env, ENVIRONMENT: 'production' };
  const issued = await issueUnlockCookie(link, 'go.example.com', production);
  assert.match(issued, /^__Host-Linro_unlock_/); assert.match(issued, /; Secure/); assert.match(issued, /; HttpOnly/);
  const cookie = issued.split(';')[0];
  assert.equal(await hasUnlockCookie(new Request('https://go.example.com/private', { headers: { cookie } }), link, production), true);
  assert.equal(await hasUnlockCookie(new Request('https://go.example.com/private', { headers: { cookie: cookie.replace('Linro_', 'cfl_') } }), link, production), false);
  assert.equal(await hasUnlockCookie(new Request('https://other.example.com/private', { headers: { cookie } }), link, production), false);
});

test('new internal assets are served and namespace cannot be allocated as a short link', async t => {
  const env = environment(); t.after(() => env.DB.close());
  for (const name of ['password.css', 'browser.js']) {
    assert.equal((await redirect.fetch(new Request('https://go.example.com/__Linro_assets/'+name), env)).status, 200);
    assert.equal((await redirect.fetch(new Request('https://go.example.com/__cfl_assets/'+name), env)).status, 404);
  }
  for (const value of ['Linro', 'linro', '__Linro_unlock', '__linro_browser', '__LINRO_ASSETS']) assert.throws(() => slug(value), e => e.status === 400);
});
