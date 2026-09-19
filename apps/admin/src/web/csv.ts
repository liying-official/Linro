/** RFC-4180 style quoted fields, including escaped quotes and embedded newlines. */
export function parseCSV(source: string): Record<string, string>[] {
  if (source.length > 2 * 1024 * 1024) throw new Error('CSV 文件超过 2 MiB。');
  const rows: string[][] = []; let row: string[] = []; let field = ''; let quoted = false; let closed = false;
  const s = source.replace(/^\uFEFF/, '');
  const pushRow = () => { row.push(field); field = ''; if (row.some(v => v !== '')) rows.push(row); row = []; closed = false; if (rows.length > 5001) throw new Error('单次导入最多 5000 行。'); };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else { quoted = false; closed = true; } }
      else field += c;
    } else if (c === ',' || c === '\n' || c === '\r') {
      if (c === ',') { row.push(field); field = ''; closed = false; }
      else { if (c === '\r' && s[i + 1] === '\n') i++; pushRow(); }
    } else if (c === '"' && field === '' && !closed) quoted = true;
    else { if (closed || c === '"') throw new Error('CSV 引号格式错误。'); field += c; }
  }
  if (quoted) throw new Error('CSV 包含未闭合引号。');
  if (row.length || field.length || closed) pushRow();
  if (!rows.length) return [];
  const headings = rows.shift()!.map(h => h.trim().toLowerCase());
  if (new Set(headings).size !== headings.length || headings.some(h => !h)) throw new Error('CSV 列名为空或重复。');
  return rows.map((values, index) => {
    if (values.length !== headings.length) throw new Error(`第 ${index + 2} 行列数不匹配。`);
    const out: Record<string, string> = {};
    headings.forEach((key, i) => { out[key] = values[i] ?? ''; });
    if (out._cf_links_csv === '1') {
      for (const key of Object.keys(out)) if (out[key]?.startsWith("'") && (/^[\s]*[=+\-@]/.test(out[key]!.slice(1)) || /^[\t\r\n']/.test(out[key]!.slice(1)))) out[key] = out[key]!.slice(1);
    }
    return out;
  });
}
export function exportCSV(rows: Record<string, any>[]): string {
  const keys = ['_cf_links_csv', 'hostname', 'slug', 'target_url', 'title', 'description', 'redirect_code', 'query_mode', 'enabled', 'expires_at', 'cache_ttl', 'geo_rules', 'password_protected', 'max_redirects', 'redirect_count', 'response_mode', 'text_content', 'block_vpn'];
  const cell = (v: unknown) => {
    let s = v == null ? '' : String(v);
    if (/^[\s]*[=+\-@]/.test(s) || /^[\t\r\n']/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  return '\uFEFF' + [keys.map(cell).join(','), ...rows.map(row => keys.map(k => cell(k === '_cf_links_csv' ? '1' : k === 'geo_rules' ? JSON.stringify(row[k] ?? []) : row[k])).join(','))].join('\r\n') + '\r\n';
}
