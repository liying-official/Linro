import type {
  Database,
  D1Statement,
  AdminEnv,
  Link,
  Principal,
} from '../../../../packages/shared/src/platform.js';
import { fail, nowSeconds, integer, text } from '../../../../packages/shared/src/http.js';
import { randomSlug, safeAuditURL } from '../../../../packages/shared/src/validation.js';
import { storedGeoRules, type GeoRule } from '../../../../packages/shared/src/geo.js';
import { sourceDomainId, normalizeLinkFields, type LinkDomain } from './link-fields.js';
import { browserChecksConfigured } from '../../../../packages/shared/src/browser-check.js';
import { hashLinkPassword } from '../../../../packages/shared/src/link-password.js';
export type PublicLink = Omit<Link, 'password_hash' | 'geo_rules'> & {
  geo_rules: GeoRule[];
  password_protected: boolean;
  short_url: string;
  remaining_redirects: number | null;
};
export function audit(
  db: Database,
  p: Principal,
  requestId: string,
  action: string,
  type: string,
  id: string,
  details: unknown = {},
  conditional = false,
): D1Statement {
  return db
    .prepare(
      `INSERT INTO audit_logs(id,user_id,actor_email,action,resource_type,resource_id,details,request_id,created_at)
    SELECT ?,?,?,?,?,?,?,?,? ${conditional ? 'WHERE changes()=1' : ''}`,
    )
    .bind(
      crypto.randomUUID(),
      p.user.id,
      p.user.email,
      action,
      type,
      id,
      JSON.stringify(details),
      requestId,
      nowSeconds(),
    );
}
export async function current<T extends { version: number }>(
  db: Database,
  table: 'links' | 'domains' | 'users',
  id: string,
  version?: unknown,
): Promise<T> {
  const row = await db.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(id).first<T>();
  if (!row) fail(404, 'not_found', 'Resource not found.');
  if (
    version !== undefined &&
    row.version !== integer(version, 'version', 1, Number.MAX_SAFE_INTEGER)
  )
    fail(409, 'version_conflict', 'This item changed. Refresh before saving again.');
  return row;
}
export function changed(results: { results: unknown[] }[]): void {
  if (!results[0]?.results.length)
    fail(409, 'version_conflict', 'This item changed. Refresh before saving again.');
}
export function publicLink(link: Link, env: AdminEnv): PublicLink {
  const host = link.hostname ?? '';
  const base =
    env.ENVIRONMENT === 'development' && ['localhost', '127.0.0.1'].includes(host)
      ? `http://${host}:8788`
      : `https://${host}`;
  // A public API/read/export must never include a password verifier or salt.
  const { password_hash, geo_rules, ...safe } = link;
  return {
    ...safe,
    target_url: link.response_mode === 'text' ? '' : link.target_url,
    geo_rules: storedGeoRules(geo_rules),
    password_protected: password_hash !== null,
    remaining_redirects:
      link.max_redirects === null ? null : Math.max(0, link.max_redirects - link.redirect_count),
    short_url: `${base}/${link.slug}`,
  };
}
export async function readLink(db: Database, id: string, env: AdminEnv): Promise<PublicLink> {
  const link = await db
    .prepare('SELECT l.*,d.hostname FROM links l JOIN domains d ON d.id=l.domain_id WHERE l.id=?')
    .bind(id)
    .first<Link>();
  if (!link) fail(404, 'not_found', 'Link not found.');
  return publicLink(link, env);
}
const sourceDomainColumns = 'id,hostname,enabled,default_redirect_code';
export interface PreparedLink {
  link: Link;
  destinationHosts: string[];
}

/** Import at most ten sources in one read. The map belongs to this request. */
export async function importDomains(db: Database, items: Record<string, unknown>[]) {
  const ids = [...new Set(items.map((item) => text(item.domain_id, 'domain_id', 36)))];
  const rows = await db
    .prepare(
      `SELECT ${sourceDomainColumns} FROM domains WHERE id IN (${ids.map(() => '?').join(',')})`,
    )
    .bind(...ids)
    .all<LinkDomain>();
  return new Map(rows.results.map((domain) => [domain.id, domain]));
}

/** The managed-host check and all mutations/audits see one D1 transaction. */
export async function writeLinkBatch(db: Database, hosts: string[], statements: D1Statement[]) {
  if (!hosts.length) return db.batch(statements);
  const guard = db
    .prepare('INSERT INTO check_link_destinations(hostname) SELECT value FROM json_each(?)')
    .bind(JSON.stringify([...new Set(hosts)]));
  const [, ...results] = await db.batch([guard, ...statements]);
  return results;
}

export async function prepareLink(
  body: Record<string, unknown>,
  env: AdminEnv,
  existing?: Link,
  domains?: ReadonlyMap<string, LinkDomain>,
): Promise<PreparedLink> {
  const id = sourceDomainId(body, existing);
  const domain = domains
    ? domains.get(id)
    : await env.DB.prepare(`SELECT ${sourceDomainColumns} FROM domains WHERE id=?`)
        .bind(id)
        .first<LinkDomain>();
  if (!domain) fail(400, 'domain_not_found', 'Select an existing domain.');
  const { fields, destinationHosts } = normalizeLinkFields(
    body,
    domain,
    env,
    browserChecksConfigured(env),
    existing,
  );
  const passwordHash =
    body.password === undefined
      ? (existing?.password_hash ?? null)
      : body.password === null
        ? null
        : await hashLinkPassword(body.password, env);
  const now = nowSeconds();
  return {
    link: {
      ...fields,
      id: existing?.id ?? crypto.randomUUID(),
      slug: fields.slug ?? randomSlug(),
      created_at: existing?.created_at ?? now,
      updated_at: now,
      password_hash: passwordHash,
    },
    destinationHosts,
  };
}
export function insertLink(db: Database, link: Link, userId: string): D1Statement {
  return db
    .prepare(
      `INSERT INTO links(id,domain_id,slug,target_url,title,description,redirect_code,query_mode,enabled,expires_at,cache_ttl,created_by,created_at,updated_at,geo_rules,password_hash,max_redirects,response_mode,text_content,block_vpn,kv_cache_ttl)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      link.id,
      link.domain_id,
      link.slug,
      link.target_url,
      link.title,
      link.description,
      link.redirect_code,
      link.query_mode,
      link.enabled,
      link.expires_at,
      link.cache_ttl,
      userId,
      link.created_at,
      link.updated_at,
      link.geo_rules,
      link.password_hash,
      link.max_redirects,
      link.response_mode,
      link.text_content,
      link.block_vpn,
      link.kv_cache_ttl,
    );
}
export function linkAudit(link: Link): Record<string, unknown> {
  return {
    block_vpn: !!link.block_vpn,
    response_mode: link.response_mode,
    text_length: link.text_content.length,
    domain_id: link.domain_id,
    slug: link.slug,
    target_url: link.response_mode === 'text' ? '' : safeAuditURL(link.target_url),
    redirect_code: link.redirect_code,
    query_mode: link.query_mode,
    enabled: link.enabled,
    expires_at: link.expires_at,
    cache_ttl: link.cache_ttl,
    kv_cache_ttl: link.kv_cache_ttl,
    version: link.version,
    geo_rules: storedGeoRules(link.geo_rules).map((rule) => ({
      ...rule,
      target_url: safeAuditURL(rule.target_url),
    })),
    password_protected: link.password_hash !== null,
    max_redirects: link.max_redirects,
  };
}
