import assert from 'node:assert/strict';
import { setup, call, createLink, redirect } from './harness.mjs';
export { call, createLink, redirect };
// Never a deployment secret. Fixtures are confined to ephemeral test databases.
export const PASSWORD = 'correct horse fixture password';
export const PEPPER = 'test-only-pepper-not-for-deployment-0123456789ABCD';
export class FakeKV {
  values = new Map(); operations = []; failGet = false; failPut = false; failDelete = false;
  async get(key, options) { this.operations.push(['get', key, options]); if (this.failGet) throw new Error('fixture read outage'); return this.values.get(key) ?? null; }
  async put(key, value, options) { this.operations.push(['put', key, options]); if (this.failPut) throw new Error('fixture write outage'); this.values.set(key, value); }
  async delete(key) { this.operations.push(['delete', key]); if (this.failDelete) throw new Error('fixture deletion outage'); this.values.delete(key); }
}
export async function featureFixture(t, { kv = false, ...overrides } = {}) {
  const cache = kv ? new FakeKV() : undefined;
  const f = await setup({ LINK_PASSWORD_SECRET: PEPPER, PASSWORD_LIMITER: { limit: async () => ({ success: true }) }, ...(cache ? { REDIRECT_CACHE: cache } : {}), ...overrides });
  t.after(() => f.env.DB.close());
  return { ...f, kv: cache };
}
export function row(env, id) { return { ...env.DB.sqlite.prepare('SELECT l.*,d.hostname,d.enabled AS domain_enabled FROM links l JOIN domains d ON d.id=l.domain_id WHERE l.id=?').get(id) }; }
export function count(env, id) { return row(env, id).redirect_count; }
export async function patch(env, link, changes) {
  const result = await call(env, '/links/' + link.id, 'PATCH', { version: row(env, link.id).version, ...changes });
  assert.equal(result.status, 200, JSON.stringify(result.body)); return result.data;
}
export function request(env, path = '/docs', { cf, method = 'GET', headers, body, host = 'go.example.com', ctx } = {}) {
  const req = new Request(`https://${host}${path}`, { method, headers, body });
  if (cf !== undefined) Object.defineProperty(req, 'cf', { value: cf });
  return redirect.fetch(req, env, ctx);
}
export function unlock(env, slug = 'docs', password = PASSWORD, headers = {}, search = '') {
  return request(env, `/__Linro_unlock/${slug}${search}`, { method: 'POST', headers: { origin: 'https://go.example.com', 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams({ password }).toString() });
}
export function cookie(response) { return response.headers.get('set-cookie')?.split(';')[0] ?? ''; }
export async function noTarget(response, status) { assert.equal(response.status, status); assert.equal(response.headers.get('location'), null); assert.match(response.headers.get('cache-control'), /no-store/); }
