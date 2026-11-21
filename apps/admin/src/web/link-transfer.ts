import { VERSION } from '../../../../packages/shared/src/platform';
import { parseCSV, exportCSV } from './csv';
import {
  MAX_LINK_BATCH_ROWS,
  MAX_JSON_BODY_BYTES,
  MAX_IMPORT_ROWS,
} from '../../../../packages/shared/src/limits';
import { api, download } from './client';
import { UI } from './i18n-dict';
import type { Locale } from './i18n';
import type { CursorPage, DomainRow, DomainOption, ImportRow, JsonRecord, LinkRow } from './models';
import { linkPagePath } from './link-list';

export function planImport(
  rows: ImportRow[],
  domains: DomainOption[],
  fallback: string,
  locale: Locale,
): JsonRecord[][] {
  const links = rows.map((row, index) => {
    const domain = row.hostname
      ? domains.find((domain) => domain.hostname === String(row.hostname).toLowerCase())
      : domains.find((domain) => domain.id === fallback);
    if (!domain) throw new Error(UI[locale].links.missingDomain(index + 1));
    const slug = row.slug ?? row.keyword ?? '';
    const target = row.response_mode === 'text' ? '' : (row.target_url ?? row.url);
    if (typeof target !== 'string') throw new Error(UI[locale].links.missingTarget(index + 1));
    const result: JsonRecord = {
      response_mode: row.response_mode ?? 'redirect',
      text_content: row.text_content ?? '',
      domain_id: domain.id,
      slug,
      target_url: target,
      title: row.title ?? '',
      description: row.description ?? '',
    };
    if (Object.hasOwn(row, 'kv_cache_ttl')) {
      const raw = row.kv_cache_ttl,
        ttl = raw === null || raw === '' ? null : Number(raw);
      if (
        ttl !== null &&
        (!['number', 'string'].includes(typeof raw) ||
          !Number.isSafeInteger(ttl) ||
          (ttl !== 0 && (ttl < 60 || ttl > 86400)))
      )
        throw new Error(
          locale === 'zh-CN'
            ? '导入的 KV 缓存时间须为 null、0 或 60–86400 的整数秒。'
            : 'Imported KV cache time must be null, 0, or an integer from 60 to 86400 seconds.',
        );
      result.kv_cache_ttl = ttl;
    }
    for (const key of ['redirect_code', 'cache_ttl'])
      if (row[key] !== undefined && row[key] !== '') result[key] = Number(row[key]);
    if (row.enabled !== undefined && row.enabled !== '')
      result.enabled =
        row.enabled === true || row.enabled === 1 || row.enabled === '1' || row.enabled === 'true';
    if (row.block_vpn !== undefined && row.block_vpn !== '') {
      const blockVPN = row.block_vpn;
      if (!(
        blockVPN === true ||
        blockVPN === false ||
        blockVPN === 0 ||
        blockVPN === 1 ||
        blockVPN === '0' ||
        blockVPN === '1' ||
        blockVPN === 'true' ||
        blockVPN === 'false'
      ))
        throw new Error(
          locale === 'zh-CN'
            ? '无效的 block_vpn 值，禁止静默移除保护。'
            : 'Invalid block_vpn value; protection cannot be silently removed.',
        );
      result.block_vpn =
        blockVPN === true || blockVPN === 1 || blockVPN === '1' || blockVPN === 'true';
    }
    const protectedExport =
      row.password_protected === true ||
      row.password_protected === 1 ||
      row.password_protected === '1' ||
      row.password_protected === 'true';
    if (protectedExport && !row.password)
      throw new Error(
        locale === 'zh-CN'
          ? `第 ${index + 1} 条是密码保护链接，请提供新 password；禁止静默导入为公开链接。`
          : `Row ${index + 1} is password protected. Provide a new password; it cannot be silently imported as public.`,
      );
    if (row.password !== undefined && row.password !== '') result.password = row.password;
    if (row.geo_rules)
      result.geo_rules =
        typeof row.geo_rules === 'string' ? JSON.parse(row.geo_rules) : row.geo_rules;
    if (row.max_redirects !== undefined && row.max_redirects !== null && row.max_redirects !== '')
      result.max_redirects = Number(row.max_redirects);
    // Exported counters are read-only snapshots, never client-assigned during import.
    if (row.query_mode) result.query_mode = row.query_mode;
    if (row.expires_at !== undefined && row.expires_at !== null && row.expires_at !== '')
      result.expires_at = Number(row.expires_at);
    return result;
  });
  // Respect both the server's 10-row atomic limit and its 256 KiB JSON
  // byte limit. Text/geo data can make ten valid rows too large together.
  // Plan every batch before writes so one oversized row fails before import.
  const batches: JsonRecord[][] = [];
  let batch: JsonRecord[] = [];
  const encoder = new TextEncoder();
  const bytes = (rows: JsonRecord[]) => encoder.encode(JSON.stringify({ links: rows })).length;
  for (const link of links) {
    if (bytes([link]) > MAX_JSON_BODY_BYTES)
      throw new Error(
        locale === 'zh-CN'
          ? '单条导入记录超过 256 KiB 请求上限。'
          : 'An import row exceeds the 256 KiB request limit.',
      );
    const candidate = [...batch, link];
    if (candidate.length > MAX_LINK_BATCH_ROWS || bytes(candidate) > MAX_JSON_BODY_BYTES) {
      batches.push(batch);
      batch = [link];
    } else batch = candidate;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

export async function readExport(locale: Locale, signal: AbortSignal): Promise<LinkRow[]> {
  const labels = UI[locale].links;
  const rows: LinkRow[] = [];
  const seen = new Set<string>();
  let total: number | undefined;
  let cursor: string | undefined;
  do {
    signal.throwIfAborted();
    const params = new URLSearchParams({ limit: '100' });
    // Compare the total at the start and the expected final page of a multi-page export.
    if (total === undefined || rows.length + 100 >= total) params.set('include_total', 'true');
    const data = await api<CursorPage<LinkRow>>(
      linkPagePath(params, cursor),
      'GET',
      undefined,
      signal,
    );
    if (total === undefined) total = data.total;
    if (total === undefined || (data.total !== undefined && data.total !== total))
      throw new Error(labels.exportChanged);
    if (total > 10000) throw new Error(labels.exportLimit);
    for (const row of data.items) {
      if (seen.has(row.id)) throw new Error(labels.exportChanged);
      seen.add(row.id);
      rows.push(row);
    }
    if (
      (data.next_cursor && (data.items.length !== 100 || rows.length >= total)) ||
      rows.length > total
    )
      throw new Error(labels.exportChanged);
    cursor = data.next_cursor ?? undefined;
  } while (cursor);
  if (rows.length !== total) throw new Error(labels.exportChanged);
  return rows;
}

export async function downloadExport(
  format: 'csv' | 'json',
  locale: Locale,
  siteName: string | undefined,
  signal: AbortSignal,
): Promise<number> {
  const rows = await readExport(locale, signal);
  const domains =
    format === 'json' ? await api<DomainRow[]>('/domains', 'GET', undefined, signal) : [];
  signal.throwIfAborted();
  const name = `Linro-${new Date().toISOString().slice(0, 10)}`;
  if (format === 'csv') download(name + '.csv', exportCSV(rows), 'text/csv;charset=utf-8');
  else
    download(
      name + '.json',
      JSON.stringify(
        {
          format: 'linro',
          version: VERSION,
          exported_at: new Date().toISOString(),
          domains,
          settings: { site_name: siteName },
          links: rows,
        },
        null,
        2,
      ),
      'application/json',
    );
  return rows.length;
}

export function parseImportFile(source: string, name: string, locale: Locale): ImportRow[] {
  let rows: ImportRow[];
  if (name.toLowerCase().endsWith('.json')) {
    const data = JSON.parse(source);
    rows = Array.isArray(data) ? data : data.links;
    if (!Array.isArray(rows)) throw new Error(UI[locale].links.jsonNeedsArray);
  } else rows = parseCSV(source);
  if (
    !rows.length ||
    rows.length > MAX_IMPORT_ROWS ||
    rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))
  )
    throw new Error(UI[locale].links.importRowsInvalid);
  return rows;
}
