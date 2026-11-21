// Test entry for native D1. Both routes use the production Workers and bindings.
import admin from '../../apps/admin/src/worker/index.js';
import redirect from '../../apps/redirect/src/index.js';
import type { Database, D1Statement, Env } from '../../packages/shared/src/platform.js';

interface QueryMeasure {
  rows_read?: number;
  plan: string[];
}

function measuredDatabase(db: Database, measures: QueryMeasure[]): Database {
  const originals = new WeakMap<
    D1Statement,
    { statement: D1Statement; measure: (rows: number | undefined) => Promise<void> }
  >();
  function observe(sql: string, statement: D1Statement, args: unknown[] = []): D1Statement {
    const measure = async (rows_read: number | undefined) => {
      const plan = await db
        .prepare('EXPLAIN QUERY PLAN ' + sql)
        .bind(...args)
        .all<{ detail: string }>();
      measures.push({ rows_read, plan: plan.results.map((row) => row.detail) });
    };
    const wrapped: D1Statement = {
      bind: (...values) => observe(sql, statement.bind(...values), values),
      first: statement.first.bind(statement),
      run: statement.run.bind(statement),
      async all<T>() {
        const result = await statement.all<T>();
        await measure(result.meta.rows_read);
        return result;
      },
    };
    originals.set(wrapped, { statement, measure });
    return wrapped;
  }
  return {
    prepare: (sql) => observe(sql, db.prepare(sql)),
    async batch<T>(statements: D1Statement[]) {
      const sources = statements.map((stmt) => originals.get(stmt)!);
      const result = await db.batch<T>(sources.map((s) => s.statement));
      for (const [i, row] of result.entries()) await sources[i]!.measure(row.meta.rows_read);
      return result;
    },
  };
}

export default {
  async fetch(request: Request, env: Env) {
    if (new URL(request.url).origin !== env.ADMIN_ORIGIN) {
      return redirect.fetch(request, {
        ...env,
        REDIRECT_LIMITER: { limit: async () => ({ success: true }) },
      });
    }
    if (!request.headers.has('x-fixture-d1')) return admin.fetch(request, env);
    const queries: QueryMeasure[] = [];
    const response = await admin.fetch(request, { ...env, DB: measuredDatabase(env.DB, queries) });
    const headers = new Headers(response.headers);
    headers.set('x-fixture-d1', JSON.stringify(queries));
    return new Response(response.body, { status: response.status, headers });
  },
};
