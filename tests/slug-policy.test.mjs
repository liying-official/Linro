import test from 'node:test';
import assert from 'node:assert/strict';
import { slug } from '../.build/packages/shared/src/validation.js';
import { setup, call, createLink, visit, redirect } from './harness.mjs';
import { api as demoAPI, resetDemo, enterDemo } from '../apps/demo/src/store.mjs';

const allowed = ['Linro', 'linro', 'LINRO', 'admin', 'api', 'assets', 'robots', 'favicon', 'well-known'];
const reserved = ['health', 'HEALTH', 'cdn-cgi', 'CDN-CGI', '__Linro_unlock', '__linro_browser', '__LINRO_ASSETS', '__Linro_future'];

test('short-link names reserve only live service namespaces and retain syntax restrictions', () => {
  for (const value of allowed) assert.equal(slug(value), value);
  for (const value of [...reserved, '.well-known', 'robots.txt', 'favicon.ico', 'a/b', 'a b', '你好', 'x'.repeat(65)]) {
    assert.throws(() => slug(value), e => e.status === 400 && e.code === 'invalid_slug', value);
  }
});

test('formerly reserved business slugs can be created, renamed, and resolved without affecting system routes', async t => {
  const { env, domain } = await setup({ BROWSER_TIMEZONE_ENABLED: 'false' });
  t.after(() => env.DB.close());
  for (const value of allowed) {
    const link = await createLink(env, domain, { slug: value, target_url: `https://example.org/${value}`, redirect_code: 302 });
    for (const method of ['GET', 'HEAD']) {
      const response = await visit(env, '/'+value, method);
      assert.equal(response.status, 302, value);
      assert.equal(response.headers.get('location'), `https://example.org/${value}`);
    }
    assert.equal(link.slug, value);
  }
  const imported = await call(env, '/links/import', 'POST', { links: [{ domain_id: domain.id, slug: 'Api', target_url: 'https://example.org/import' }] });
  assert.equal(imported.status, 201);
  const row = await createLink(env, domain, { slug: 'rename-me' });
  assert.equal((await call(env, '/links/'+row.id, 'PATCH', { version: row.version, slug: 'Admin' })).status, 200);
  assert.equal((await visit(env, '/Admin')).status, 301);
  for (const value of reserved) assert.equal((await call(env, '/links', 'POST', { domain_id: domain.id, slug: value, target_url: 'https://example.org/' })).error.code, 'invalid_slug');
  assert.equal((await call(env, '/session')).status, 200);
  assert.equal((await visit(env, '/health')).status, 200);
  assert.match(await (await visit(env, '/robots.txt')).text(), /Disallow: \//);
  for (const asset of ['password.css', 'browser.js']) assert.equal((await redirect.fetch(new Request('https://go.example.com/__Linro_assets/'+asset), env)).status, 200);
});

test('Linro short links still enforce password protection', async t => {
  const { env, domain } = await setup({ BROWSER_TIMEZONE_ENABLED: 'false', LINK_PASSWORD_SECRET: 'p'.repeat(43), PASSWORD_LIMITER: { limit: async () => ({success:true}) } });
  t.after(() => env.DB.close());
  await createLink(env, domain, { slug:'Linro', password:'fixture-password-only', target_url:'https://example.org/protected' });
  const response=await visit(env,'/Linro');
  assert.equal(response.status,200); assert.equal(response.headers.get('location'),null);
  assert.match(await response.text(), /__Linro_unlock\/Linro/);
});

test('demo and real short-link validation agree on allowed and necessary reserved names', async () => {
  resetDemo(); enterDemo('Linro'); const [domain]=await demoAPI('/domains');
  for (const value of allowed) assert.equal((await demoAPI('/links','POST',{domain_id:domain.id,slug:value,target_url:'https://content.example/page'})).slug,value);
  for (const value of reserved) await assert.rejects(demoAPI('/links','POST',{domain_id:domain.id,slug:value,target_url:'https://content.example/page'}),e=>e.code==='invalid_slug');
});
