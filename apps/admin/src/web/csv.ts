import { MAX_CSV_SOURCE_CHARS, MAX_IMPORT_ROWS } from '../../../../packages/shared/src/limits.js';

type CSVErrorCode =
  | 'csv_too_large'
  | 'csv_too_many_rows'
  | 'csv_invalid_quote'
  | 'csv_unclosed_quote'
  | 'csv_invalid_headers'
  | 'csv_column_count';

export class CSVError extends Error {
  constructor(
    public code: CSVErrorCode,
    public row?: number,
  ) {
    super(code);
  }
}

/** RFC-4180 style quoted fields, including escaped quotes and embedded newlines. */
export function parseCSV(source: string): Record<string, string>[] {
  if (source.length > MAX_CSV_SOURCE_CHARS) throw new CSVError('csv_too_large');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let closed = false;
  const s = source.replace(/^\uFEFF/, '');
  const pushRow = () => {
    row.push(field);
    field = '';
    if (row.some((v) => v !== '')) rows.push(row);
    row = [];
    closed = false;
    if (rows.length > MAX_IMPORT_ROWS + 1) throw new CSVError('csv_too_many_rows');
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += c;
    } else if (c === ',' || c === '\n' || c === '\r') {
      if (c === ',') {
        row.push(field);
        field = '';
        closed = false;
      } else {
        if (c === '\r' && s[i + 1] === '\n') i++;
        pushRow();
      }
    } else if (c === '"' && field === '' && !closed) quoted = true;
    else {
      if (closed || c === '"') throw new CSVError('csv_invalid_quote');
      field += c;
    }
  }
  if (quoted) throw new CSVError('csv_unclosed_quote');
  if (row.length || field.length || closed) pushRow();
  if (!rows.length) return [];
  const headings = rows.shift()!.map((h) => h.trim().toLowerCase());
  if (new Set(headings).size !== headings.length || headings.some((h) => !h))
    throw new CSVError('csv_invalid_headers');
  return rows.map((values, index) => {
    if (values.length !== headings.length) throw new CSVError('csv_column_count', index + 2);
    const out: Record<string, string> = {};
    headings.forEach((key, i) => {
      out[key] = values[i] ?? '';
    });
    if (out._cf_links_csv === '1') {
      for (const key of Object.keys(out))
        if (
          out[key]?.startsWith("'") &&
          (/^[\s]*[=+\-@]/.test(out[key]!.slice(1)) || /^[\t\r\n']/.test(out[key]!.slice(1)))
        )
          out[key] = out[key]!.slice(1);
    }
    return out;
  });
}
export function exportCSV<T extends object>(rows: T[]): string {
  const keys = [
    '_cf_links_csv',
    'hostname',
    'slug',
    'target_url',
    'title',
    'description',
    'redirect_code',
    'query_mode',
    'enabled',
    'expires_at',
    'cache_ttl',
    'kv_cache_ttl',
    'geo_rules',
    'password_protected',
    'max_redirects',
    'redirect_count',
    'response_mode',
    'text_content',
    'block_vpn',
  ];
  const cell = (v: unknown) => {
    let s = v == null ? '' : String(v);
    if (/^[\s]*[=+\-@]/.test(s) || /^[\t\r\n']/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  return (
    '\uFEFF' +
    [
      keys.map(cell).join(','),
      ...rows.map((row) => {
        const record = row as Record<string, unknown>;
        return keys
          .map((key) =>
            cell(
              key === '_cf_links_csv'
                ? '1'
                : key === 'geo_rules'
                  ? JSON.stringify(record[key] ?? [])
                  : record[key],
            ),
          )
          .join(',');
      }),
    ].join('\r\n') +
    '\r\n'
  );
}
