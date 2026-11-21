import {
  base64UrlDecode,
  base64UrlEncode,
  encodeUTF8,
} from '../../../../packages/shared/src/encoding.js';
import { fail, pageParams } from '../../../../packages/shared/src/http.js';

type CursorKey = [sort: number | string, id: string];

export function listPagination(url: URL, resource: 'links' | 'archive' | 'audit') {
  const mode = url.searchParams.get('pagination') ?? 'page';
  if (mode !== 'page' && mode !== 'cursor')
    fail(400, 'invalid_pagination', 'Use page or cursor pagination.');
  const { page, offset, limit } = pageParams(url);
  const token = url.searchParams.get('cursor');
  if ((mode === 'page' && token !== null) || (mode === 'cursor' && url.searchParams.has('page')))
    fail(400, 'invalid_pagination', 'Page and cursor pagination parameters cannot be combined.');

  let key: CursorKey | null = null;
  if (token) {
    try {
      if (token.length > 512) throw new Error();
      const fields: unknown = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(base64UrlDecode(token, true)),
      );
      if (!Array.isArray(fields) || fields.length !== 2) throw new Error();
      const [sort, id] = fields;
      const validSort =
        resource !== 'archive'
          ? Number.isSafeInteger(sort)
          : typeof sort === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sort);
      if (!validSort || typeof id !== 'string' || !id.length || id.length > 128) throw new Error();
      key = [sort, id];
    } catch {
      fail(400, 'invalid_cursor', 'Invalid pagination cursor.');
    }
  }
  return { mode, page, offset, limit, key };
}

export function cursorResults<Row>(rows: Row[], limit: number, key: (row: Row) => CursorKey) {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  const next_cursor =
    rows.length > limit && last ? base64UrlEncode(encodeUTF8(JSON.stringify(key(last)))) : null;
  return { items, limit, next_cursor };
}
