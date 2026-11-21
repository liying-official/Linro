// TEST ENTRY ONLY. No production config, route or import references this file.
import { visitorDimensions } from '../../packages/shared/src/visitor-dimensions.js';
import redirect from '../../apps/redirect/src/index.js';
import admin from '../../apps/admin/src/worker/index.js';
import { hashLinkPassword, verifyLinkPassword } from '../../packages/shared/src/link-password.js';
import type { Database, D1Result, D1Statement, Env, KVBinding } from '../../packages/shared/src/platform.js';
const cacheCalls = { get: 0, put: 0, delete: 0 };
const d1 = { calls: 0, rowsRead: 0, rowsWritten: 0 };
// A D1 first() drops metadata. The fixture runs the same bound SELECT/RETURNING
// with all() so real workerd D1 can report its rows_read and rows_written.
function measuredDb(db: Database): Database {
  const native = new WeakMap<D1Statement, D1Statement>();
  function countRows<T>(result: D1Result<T>): D1Result<T> {
    d1.rowsRead += result.meta.rows_read ?? 0;
    d1.rowsWritten += result.meta.rows_written ?? 0;
    return result;
  }
  function wrap(statement: D1Statement): D1Statement {
    const measured: D1Statement = {
      bind: (...values) => wrap(statement.bind(...values)),
      async first<T>(column?: string) {
        const {results} = await measured.all();
        const row = results[0];
        return (row && column ? row[column] : row ?? null) as T | null;
      },
      async all<T>() {
        d1.calls++;
        return countRows(await statement.all<T>());
      },
      async run<T>() {
        d1.calls++;
        return countRows(await statement.run<T>());
      },
    };
    native.set(measured, statement);
    return measured;
  }
  return {
    prepare: sql => wrap(db.prepare(sql)),
    async batch<T>(statements: D1Statement[]) {
      d1.calls++;
      return (await db.batch<T>(statements.map(statement => native.get(statement) ?? statement))).map(countRows);
    },
  };
}
const measured = new WeakMap<KVBinding, KVBinding>();
function measuredCache(binding: KVBinding): KVBinding {
  let wrapper = measured.get(binding);
  if (!wrapper) {
    wrapper = {
      get: (key, options) => { cacheCalls.get++; return binding.get(key, options); },
      put: (key, value, options) => { cacheCalls.put++; return binding.put(key, value, options); },
      delete: key => { cacheCalls.delete++; return binding.delete(key); },
    };
    measured.set(binding, wrapper);
  }
  return wrapper;
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const measure = (env as Env & { MEASURE_KV?: string }).MEASURE_KV === 'true';
    if (measure && new URL(request.url).pathname === '/__test__/kv-metrics') return Response.json(cacheCalls);
    if (measure && new URL(request.url).pathname === '/__test__/route-metrics') return Response.json({...d1,...cacheCalls});
    // Invoke the real Admin handler; no auth or data gate is mocked.
    if (new URL(request.url).hostname === 'admin.example.com') return admin.fetch(request, { ...env, AUTH_LIMITER: { limit: async () => ({ success: true }) } });
    if (new URL(request.url).pathname === '/__test__/dimensions') return Response.json(visitorDimensions(request, { ...env, CLOUDFLARE_DEVICE_TYPE_ENABLED: 'true' }));
    if (new URL(request.url).pathname === '/__test__/password') {
      const { password } = await request.json() as { password: string };
      const hash = await hashLinkPassword(password, env);
      return Response.json({ hash, valid: await verifyLinkPassword(password, hash, env), invalid: await verifyLinkPassword('wrong test password', hash, env) });
    }
    // Only the per-location rate bindings are controlled test doubles here.
    // Crypto, Request/Response, D1 SQL, KV and redirect code run inside workerd.
    // Without a Context, the production cache helper awaits its write, making
    // this fixture deterministic without relying on sleeps or network mocks.
    return redirect.fetch(request, { ...env, ...(measure ? {DB:measuredDb(env.DB)} : {}),
      ...(env.ANALYTICS_ENABLED === 'true' ? {ANALYTICS:{writeDataPoint(){}}} : {}),
      ...(measure && env.REDIRECT_CACHE ? { REDIRECT_CACHE: measuredCache(env.REDIRECT_CACHE) } : {}),
      REDIRECT_LIMITER: { limit: async () => ({ success: true }) }, PASSWORD_LIMITER: { limit: async () => ({ success: true }) } });
  },
};
