import type { Domain, Link } from '../../../../packages/shared/src/platform.js';
import {
  booleanInt,
  fail,
  integer,
  rejectUnknown,
  text,
} from '../../../../packages/shared/src/http.js';
import {
  slug,
  targetURL,
  redirectCode,
  queryMode,
  expiration,
} from '../../../../packages/shared/src/validation.js';
import {
  validateDestinationHost,
  type DestinationSettings,
} from '../../../../packages/shared/src/destination.js';
import { checkQueryPolicy } from '../../../../packages/shared/src/policy.js';
import { geoRules, storedGeoRules } from '../../../../packages/shared/src/geo.js';
import { responseMode, plainText } from '../../../../packages/shared/src/text-response.js';

const LINK_FIELDS = [
  'domain_id',
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
  'password',
  'max_redirects',
  'response_mode',
  'text_content',
  'block_vpn',
];
export type LinkDomain = Pick<Domain, 'id' | 'hostname' | 'enabled' | 'default_redirect_code'>;
type LinkFields = Omit<Link, 'id' | 'created_at' | 'updated_at' | 'password_hash' | 'slug'> & {
  slug: string | null;
};

export function sourceDomainId(body: Record<string, unknown>, existing?: Link): string {
  rejectUnknown(body, [...LINK_FIELDS, ...(existing ? ['version', 'reset_redirect_count'] : [])]);
  return text(
    Object.hasOwn(body, 'domain_id') ? body.domain_id : existing?.domain_id,
    'domain_id',
    36,
  );
}

/** Normalizes form fields against a resolved domain and deployment policy. */
export function normalizeLinkFields(
  body: Record<string, unknown>,
  domain: LinkDomain,
  settings: DestinationSettings,
  browserReady: boolean,
  existing?: Link,
) {
  const merged = { ...(existing ?? {}), ...body };
  if (
    body.block_vpn !== undefined &&
    ![true, false, 0, 1].includes(body.block_vpn as boolean | number)
  )
    fail(400, 'invalid_block_vpn', 'block_vpn must be a boolean or 0/1.');
  const blockVPN = booleanInt(merged.block_vpn, 0);
  if (blockVPN && !existing?.block_vpn && !browserReady)
    fail(
      503,
      'browser_check_unconfigured',
      'Configure BROWSER_CHECK_SECRET on both Workers before enabling VPN blocking.',
    );
  const output = responseMode(merged.response_mode ?? 'redirect');
  const content = output === 'text' ? plainText(merged.text_content) : '';
  // Keep the legacy non-empty target_url constraint without a table rebuild.
  // This inert, non-HTTP sentinel is never fetched; old redirect code rejects it.
  const target = output === 'text' ? 'about:blank' : targetURL(merged.target_url);
  const rules =
    body.geo_rules === undefined
      ? existing
        ? storedGeoRules(existing.geo_rules)
        : []
      : geoRules(body.geo_rules);
  const serializedRules = JSON.stringify(rules);
  if (serializedRules.length > 65536)
    fail(400, 'invalid_geo_rules', 'Geographic rules are too large.');
  if (output === 'text' && rules.length)
    fail(
      400,
      'text_geo_conflict',
      'Plain text links cannot use geographic target rules. Clear geo_rules explicitly.',
    );
  const mode = output === 'text' ? 'discard' : queryMode(merged.query_mode ?? 'discard');
  const destinationHosts =
    output === 'text'
      ? []
      : [target, ...rules.map((rule) => rule.target_url)].map((destination) => {
          const host = validateDestinationHost(destination, settings);
          checkQueryPolicy(destination, mode);
          return host;
        });
  if (body.reset_redirect_count !== undefined && typeof body.reset_redirect_count !== 'boolean')
    fail(400, 'invalid_field', 'reset_redirect_count must be a boolean.');
  const maxRedirects =
    merged.max_redirects == null
      ? null
      : integer(merged.max_redirects, 'max_redirects', 1, 1000000000);
  const kvCacheTTL =
    merged.kv_cache_ttl == null ? null : integer(merged.kv_cache_ttl, 'kv_cache_ttl', 0, 86400);
  if (kvCacheTTL !== null && kvCacheTTL !== 0 && kvCacheTTL < 60)
    fail(400, 'invalid_field', 'kv_cache_ttl must be null, 0, or 60–86400 seconds.');
  const fields: LinkFields = {
    domain_id: domain.id,
    slug: !existing && (merged.slug === undefined || merged.slug === '') ? null : slug(merged.slug),
    target_url: target,
    response_mode: output,
    text_content: content,
    block_vpn: blockVPN,
    title: text(merged.title, 'title', 200, ''),
    description: text(merged.description, 'description', 2000, ''),
    redirect_code: redirectCode(merged.redirect_code ?? domain.default_redirect_code),
    query_mode: mode,
    enabled: booleanInt(merged.enabled),
    expires_at: expiration(merged.expires_at),
    cache_ttl: integer(merged.cache_ttl ?? 0, 'cache_ttl', 0, 3600),
    kv_cache_ttl: kvCacheTTL,
    created_by: existing?.created_by ?? null,
    version: existing ? existing.version + 1 : 1,
    hostname: domain.hostname,
    domain_enabled: domain.enabled,
    geo_rules: serializedRules,
    max_redirects: maxRedirects,
    redirect_count: existing?.redirect_count ?? 0,
    rule_revision: existing ? existing.rule_revision + 1 : 1,
  };
  return { fields, destinationHosts };
}
