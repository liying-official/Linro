import type { DomainRow, JsonRecord, LinkRow, UserRow } from './models';
import type { Locale } from './i18n';
export function linkFormBody(
  values: FormData,
  row: LinkRow | undefined,
  locale: Locale,
): JsonRecord {
  const expires = String(values.get('expires_at') ?? '');
  let geo: unknown;
  try {
    geo = JSON.parse(String(values.get('geo_rules_json') ?? '[]'));
  } catch {
    throw new Error(locale === 'zh-CN' ? '地理规则格式无效。' : 'Invalid geographic rule data.');
  }
  const output = values.get('response_mode') === 'text' ? 'text' : 'redirect';
  const kvInput = values.get('kv_cache_ttl');
  const kvCacheTTL = kvInput === null || kvInput === '' ? null : Number(kvInput);
  if (
    kvCacheTTL !== null &&
    (!Number.isSafeInteger(kvCacheTTL) ||
      (kvCacheTTL !== 0 && (kvCacheTTL < 60 || kvCacheTTL > 86400)))
  ) {
    throw new Error(
      locale === 'zh-CN'
        ? 'KV 缓存时间须留空、填 0，或填写 60–86400 的整数秒。'
        : 'KV cache time must be blank, 0, or an integer from 60 to 86400 seconds.',
    );
  }
  const body: JsonRecord = {
    response_mode: output,
    text_content: output === 'text' ? values.get('text_content') : '',
    domain_id: values.get('domain_id'),
    slug: values.get('slug'),
    target_url: output === 'text' ? '' : values.get('target_url'),
    title: values.get('title'),
    description: values.get('description'),
    redirect_code:
      output === 'text' ? (row?.redirect_code ?? 301) : Number(values.get('redirect_code')),
    query_mode: output === 'text' ? 'discard' : values.get('query_mode'),
    enabled: values.get('enabled') === 'on',
    block_vpn: values.get('block_vpn') === 'on',
    expires_at: expires ? Math.floor(new Date(expires).getTime() / 1000) : null,
    cache_ttl: output === 'text' ? 0 : Number(values.get('cache_ttl')),
    kv_cache_ttl: kvCacheTTL,
    geo_rules: output === 'text' ? [] : geo,
    max_redirects: values.get('max_redirects') ? Number(values.get('max_redirects')) : null,
  };
  if (values.get('password_action') === 'set') body.password = values.get('password');
  else if (values.get('password_action') === 'remove') body.password = null;
  if (row) {
    body.version = row.version;
    body.reset_redirect_count = values.get('reset_redirect_count') === 'on';
  }
  return body;
}
export function domainFormBody(values: FormData, row?: DomainRow): JsonRecord {
  const body: JsonRecord = {
    name: values.get('name'),
    enabled: values.get('enabled') === 'on',
    default_redirect_code: Number(values.get('default_redirect_code')),
  };
  if (row) body.version = row.version;
  else body.hostname = values.get('hostname');
  return body;
}
export function userFormBody(values: FormData, row?: UserRow): JsonRecord {
  const body: JsonRecord = { display_name: values.get('display_name'), role: values.get('role') };
  if (row) {
    body.version = row.version;
    body.enabled = values.get('enabled') === 'on';
  } else body.email = values.get('email');
  return body;
}
export function tokenFormBody(values: FormData, now: number): JsonRecord {
  return {
    name: values.get('name'),
    scopes: values.getAll('scopes'),
    expires_at: Math.floor(now / 1000) + Number(values.get('days')) * 86400,
  };
}
