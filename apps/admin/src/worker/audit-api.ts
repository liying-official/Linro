import { json } from '../../../../packages/shared/src/http.js';
import type { ApiContext } from './api-context.js';
import { listPagination, cursorResults } from './list-pagination.js';

export async function getAudit({ env, url }: ApiContext): Promise<Response> {
  const pagination = listPagination(url, 'audit');
  if (pagination.mode === 'cursor') {
    const condition = pagination.key ? 'WHERE (created_at,id)<(?,?)' : '';
    const data = await env.DB.prepare(
      `SELECT * FROM audit_logs ${condition} ORDER BY created_at DESC,id DESC LIMIT ?`,
    )
      .bind(...(pagination.key ?? []), pagination.limit + 1)
      .all<{ created_at: number; id: string }>();
    return json(cursorResults(data.results, pagination.limit, (row) => [row.created_at, row.id]));
  }
  const [rows, count] = await env.DB.batch([
    env.DB.prepare(
      `SELECT * FROM audit_logs
      ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`,
    ).bind(pagination.limit, pagination.offset),
    env.DB.prepare('SELECT COUNT(*) AS total FROM audit_logs'),
  ]);
  return json({
    items: rows?.results ?? [],
    total: count?.results[0]?.total ?? 0,
    page: pagination.page,
    limit: pagination.limit,
  });
}
