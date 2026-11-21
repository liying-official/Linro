import { json } from '../../../../packages/shared/src/http.js';
import type { ApiContext } from './api-context.js';
import { checkStatsSelection, statsSelection } from './analytics.js';
import { cursorResults, listPagination } from './list-pagination.js';

export async function getStatsArchive({ env, url }: ApiContext): Promise<Response> {
  const page = listPagination(url, 'archive');
  const ids = statsSelection(url);
  await checkStatsSelection(env, ids);
  const select =
    'SELECT s.*,l.slug,d.hostname FROM daily_stats s JOIN links l ON l.id=s.link_id JOIN domains d ON d.id=l.domain_id';
  const selection = ids ? 's.link_id IN (SELECT value FROM json_each(?))' : '';
  const values: unknown[] = ids ? [JSON.stringify(ids)] : [];
  let sql = select + (selection ? ' WHERE ' + selection : '');
  if (page.key) {
    const [date, id] = page.key;
    // Each branch seeks directly into the mixed DESC/ASC index, including ties
    // spanning many pages. UNION ALL merges the two disjoint ordered ranges.
    const filtered = selection ? selection + ' AND ' : '';
    sql =
      select +
      ' WHERE ' +
      filtered +
      's.date=? AND s.link_id>? UNION ALL ' +
      select +
      ' WHERE ' +
      filtered +
      's.date<?';
    values.push(date, id, ...(ids ? [JSON.stringify(ids)] : []), date);
  }
  sql += ' ORDER BY date DESC,link_id ASC LIMIT ?';
  const cursor = page.mode === 'cursor';
  values.push(cursor ? page.limit + 1 : page.limit);
  if (!cursor) {
    sql += ' OFFSET ?';
    values.push(page.offset);
  }
  const data = await env.DB.prepare(sql)
    .bind(...values)
    .all<{ date: string; link_id: string }>();
  const result = cursor
    ? cursorResults(data.results, page.limit, (row) => [row.date, row.link_id])
    : { items: data.results, page: page.page, limit: page.limit };
  return json({ ...result, sampled: true, link_ids: ids, dimension_detail_available: false });
}
