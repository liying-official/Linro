import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import admin from '../.build/apps/admin/src/worker/index.js';
import redirect from '../.build/apps/redirect/src/index.js';
export { admin, redirect };
/** Real SQLite with a small D1-compatible async surface. It tests actual SQL,
 * constraints and atomic batches; it does NOT emulate workerd/network/quotas. */
export class SQLiteD1 {
  constructor(filename = ':memory:', migrate = true) {
    this.sqlite = new DatabaseSync(filename); this.queries = []; this.sqlite.exec('PRAGMA foreign_keys=ON');
    if (migrate) for (const name of readdirSync(new URL('../migrations/', import.meta.url)).filter(n => n.endsWith('.sql')).sort()) this.sqlite.exec(readFileSync(new URL('../migrations/' + name, import.meta.url), 'utf8'));
  }
  prepare(sql) { return new Statement(this, sql, []); }
  async batch(statements) {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try { const results = statements.map(s => s.execute()); this.sqlite.exec('COMMIT'); return results; }
    catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
  }
  close() { this.sqlite.close(); }
}
class Statement {
  constructor(db, sql, values) { this.db = db; this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.db, this.sql, values); }
  execute() {
    if (this.values.some(value => value === undefined)) throw new Error('D1 cannot bind undefined');
    this.db.queries.push(this.sql);
    const results = this.db.sqlite.prepare(this.sql).all(...this.values);
    const meta = this.db.sqlite.prepare('SELECT changes() AS changes,last_insert_rowid() AS last_row_id').get();
    return { success: true, results: results.map(row => ({ ...row })), meta: { ...meta } };
  }
  async first(column) { const row = this.execute().results[0] ?? null; return column ? row?.[column] ?? null : row; }
  async all() { return this.execute(); }
  async run() { return this.execute(); }
}
export function environment(overrides = {}) {
  return {
    DB: new SQLiteD1(), ENVIRONMENT: 'development', ADMIN_ORIGIN: 'http://127.0.0.1:8787',
    BOOTSTRAP_OWNER_EMAIL: 'owner@example.com', LOCAL_DEV_TOKEN: 'local-development-test-token-not-for-production-0123456789',
    ACCESS_ISSUER: 'https://test.cloudflareaccess.com', ACCESS_AUD: 'a'.repeat(64), ANALYTICS_ENABLED: 'false', BROWSER_TIMEZONE_ENABLED: 'false',
    ASSETS: { fetch: async () => new Response('<html>test asset</html>', { headers: { 'Content-Type': 'text/html' } }) },
    REDIRECT_LIMITER: { limit: async () => ({ success: true }) },
    WRITE_LIMITER: { limit: async () => ({ success: true }) }, AUTH_LIMITER: { limit: async () => ({ success: true }) }, ...overrides,
  };
}
export async function call(env, path, method = 'GET', body, options = {}) {
  const headers = new Headers({ 'X-Linro-Dev': env.LOCAL_DEV_TOKEN, 'X-Linro-CSRF': '1', Origin: env.ADMIN_ORIGIN, ...options.headers });
  if (options.noDev) headers.delete('X-Linro-Dev');
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  const req = new Request(options.url ?? env.ADMIN_ORIGIN + '/Linro/v1' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const response = await admin.fetch(req, env);
  let data; try { data = await response.clone().json(); } catch { data = null; }
  return { response, status: response.status, body: data, data: data?.data, error: data?.error };
}
export async function setup(overrides = {}) {
  const env = environment(overrides);
  const session = await call(env, '/session');
  if (session.status !== 200) throw new Error(JSON.stringify(session.body));
  const domain = await call(env, '/domains', 'POST', { hostname: 'go.example.com', name: 'Primary' });
  if (domain.status !== 201) throw new Error(JSON.stringify(domain.body));
  return { env, user: session.data.user, domain: domain.data };
}
export async function createLink(env, domain, values = {}) {
  const result = await call(env, '/links', 'POST', { domain_id: domain.id, slug: 'docs', target_url: 'https://example.org/docs', ...values });
  if (result.status !== 201) throw new Error(JSON.stringify(result.body));
  return result.data;
}
export async function visit(env, path = '/docs', method = 'GET', extra = {}) {
  return redirect.fetch(new Request('https://go.example.com' + path, { method, ...extra }), env);
}
