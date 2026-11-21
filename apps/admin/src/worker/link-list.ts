import type { Link } from '../../../../packages/shared/src/platform.js';
import { encodeUTF8 } from '../../../../packages/shared/src/encoding.js';
import { fail, json, nowSeconds } from '../../../../packages/shared/src/http.js';
import type { ApiContext } from './api-context.js';
import { publicLink } from './data.js';
import { cursorResults, listPagination } from './list-pagination.js';

function linkFilters(url: URL) {
  const clauses: string[] = [];
  const values: unknown[] = [];
  const query = url.searchParams.get('q');
  if (query) {
    const pattern = '%' + query.replace(/[\\%_]/g, '\\$&') + '%';
    if (encodeUTF8(pattern).byteLength > 50)
      fail(
        400,
        'search_too_long',
        'The search pattern is limited to 50 UTF-8 bytes including wildcards and escapes.',
      );
    clauses.push(
      "(l.slug LIKE ? ESCAPE '\\' OR l.title LIKE ? ESCAPE '\\' OR l.target_url LIKE ? ESCAPE '\\')",
    );
    values.push(pattern, pattern, pattern);
  }
  const domain = url.searchParams.get('domain_id');
  if (domain) {
    clauses.push('l.domain_id=?');
    values.push(domain);
  }
  const status = url.searchParams.get('status');
  if (status === 'active') {
    clauses.push(
      'l.enabled=1 AND d.enabled=1 AND (l.expires_at IS NULL OR l.expires_at>?) ' +
        'AND (l.max_redirects IS NULL OR l.redirect_count<l.max_redirects)',
    );
    values.push(nowSeconds());
  } else if (status === 'disabled') {
    clauses.push('(l.enabled=0 OR d.enabled=0)');
  } else if (status === 'expired') {
    clauses.push('l.expires_at IS NOT NULL AND l.expires_at<=?');
    values.push(nowSeconds());
  } else if (status === 'exhausted') {
    clauses.push('l.max_redirects IS NOT NULL AND l.redirect_count>=l.max_redirects');
  } else if (status && status !== 'all') {
    fail(400, 'invalid_status', 'Unknown status filter.');
  }
  return { clauses, values, needsDomain: status === 'active' || status === 'disabled' };
}

const where = (clauses: string[]): string =>
  clauses.length ? ' WHERE ' + clauses.join(' AND ') : '';

export async function getLinks({ env, url }: ApiContext): Promise<Response> {
  const pagination = listPagination(url, 'links');
  const cursor = pagination.mode === 'cursor';
  const view = url.searchParams.get('view') ?? 'full';
  if (view !== 'full' && view !== 'picker') fail(400, 'invalid_view', 'Unknown links view.');
  const includeTotal = url.searchParams.get('include_total') ?? String(!cursor);
  if (includeTotal !== 'true' && includeTotal !== 'false')
    fail(400, 'invalid_pagination', 'include_total must be true or false.');

  const filter = linkFilters(url);
  const join = ' FROM links l JOIN domains d ON d.id=l.domain_id';
  const count =
    includeTotal === 'true'
      ? env.DB.prepare(
          'SELECT COUNT(*) AS total' +
            (filter.needsDomain ? join : ' FROM links l') +
            where(filter.clauses),
        ).bind(...filter.values)
      : null;
  if (pagination.key) {
    filter.clauses.push('(l.created_at,l.id)<(?,?)');
    filter.values.push(...pagination.key);
  }
  async function readPage<Row extends Pick<Link, 'id' | 'created_at'>>(
    columns: string,
    project: (row: Row) => unknown,
  ) {
    const statement = env.DB.prepare(
      'SELECT ' +
        columns +
        join +
        where(filter.clauses) +
        ' ORDER BY l.created_at DESC,l.id DESC LIMIT ?' +
        (cursor ? '' : ' OFFSET ?'),
    ).bind(
      ...filter.values,
      cursor ? pagination.limit + 1 : pagination.limit,
      ...(cursor ? [] : [pagination.offset]),
    );
    const [data, total] = count
      ? await env.DB.batch<Row & { total?: number }>([statement, count])
      : ([await statement.all<Row>(), undefined] as const);
    const rows = data?.results ?? [];
    const page = cursor
      ? cursorResults(rows, pagination.limit, (row) => [row.created_at, row.id])
      : { items: rows, page: pagination.page, limit: pagination.limit };
    return json({
      ...page,
      items: page.items.map(project),
      ...(total ? { total: total.results[0]?.total ?? 0 } : {}),
    });
  }

  if (view === 'picker') {
    type PickerRow = Pick<Link, 'id' | 'slug' | 'created_at'> & { hostname: string };
    return readPage<PickerRow>(
      'l.id,d.hostname,l.slug' + (cursor ? ',l.created_at' : ''),
      ({ id, hostname, slug }) => ({ id, hostname, slug }),
    );
  }
  return readPage<Link>('l.*,d.hostname,d.enabled AS domain_enabled', (row) =>
    publicLink(row, env),
  );
}
