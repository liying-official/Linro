import type { Database, D1Statement, Env, Link, Principal, Domain } from '../../../../packages/shared/src/platform.js';
import { fail, nowSeconds, text, integer, booleanInt, rejectUnknown } from '../../../../packages/shared/src/http.js';
import { slug, randomSlug, targetURL, redirectCode, queryMode, expiration, safeAuditURL } from '../../../../packages/shared/src/validation.js';
import { validateDestinations } from '../../../../packages/shared/src/destination.js';
import { checkQueryPolicy } from '../../../../packages/shared/src/policy.js';
import { geoRules, storedGeoRules, type GeoRule } from '../../../../packages/shared/src/geo.js';
import { responseMode, plainText } from '../../../../packages/shared/src/text-response.js';
import { browserChecksConfigured } from '../../../../packages/shared/src/browser-check.js';
import { hashLinkPassword } from '../../../../packages/shared/src/link-password.js';
export type PublicLink = Omit<Link, 'password_hash' | 'geo_rules'> & { geo_rules: GeoRule[]; password_protected: boolean; short_url: string; remaining_redirects: number | null };
export const LINK_FIELDS = ['domain_id', 'slug', 'target_url', 'title', 'description', 'redirect_code', 'query_mode', 'enabled', 'expires_at', 'cache_ttl', 'geo_rules', 'password', 'max_redirects', 'response_mode', 'text_content', 'block_vpn'];
export function audit(db: Database, p: Principal, requestId: string, action: string, type: string, id: string, details: unknown = {}, conditional = false): D1Statement {
  return db.prepare(`INSERT INTO audit_logs(id,user_id,actor_email,action,resource_type,resource_id,details,request_id,created_at)
    SELECT ?,?,?,?,?,?,?,?,? ${conditional ? 'WHERE changes()=1' : ''}`).bind(
    crypto.randomUUID(), p.user.id, p.user.email, action, type, id, JSON.stringify(details), requestId, nowSeconds());
}
export async function current<T extends { version: number }>(db: Database, table: 'links' | 'domains' | 'users', id: string, version?: unknown): Promise<T> {
  const row = await db.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(id).first<T>();
  if (!row) fail(404, 'not_found', 'Resource not found.');
  if (version !== undefined && row.version !== integer(version, 'version', 1, Number.MAX_SAFE_INTEGER)) fail(409, 'version_conflict', 'This item changed. Refresh before saving again.');
  return row;
}
export function changed(results: { results: unknown[] }[]): void {
  if (!results[0]?.results.length) fail(409, 'version_conflict', 'This item changed. Refresh before saving again.');
}
export function publicLink(link: Link, env: Env): PublicLink {
  const host = link.hostname ?? '';
  const base = env.ENVIRONMENT === 'development' && ['localhost', '127.0.0.1'].includes(host) ? `http://${host}:8788` : `https://${host}`;
  // A public API/read/export must never include a password verifier or salt.
  const { password_hash, geo_rules, ...safe } = link;
  return { ...safe, target_url: link.response_mode === 'text' ? '' : link.target_url, geo_rules: storedGeoRules(geo_rules), password_protected: password_hash !== null,
    remaining_redirects: link.max_redirects === null ? null : Math.max(0, link.max_redirects - link.redirect_count),
    short_url: `${base}/${link.slug}` };
}
export async function readLink(db: Database, id: string, env: Env): Promise<PublicLink> {
  const link = await db.prepare('SELECT l.*,d.hostname FROM links l JOIN domains d ON d.id=l.domain_id WHERE l.id=?').bind(id).first<Link>();
  if (!link) fail(404, 'not_found', 'Link not found.');
  return publicLink(link, env);
}
export async function normalizeLink(body: Record<string, unknown>, env: Env, existing?: Link): Promise<Link> {
  rejectUnknown(body, [...LINK_FIELDS, ...(existing ? ['version', 'reset_redirect_count'] : [])]);
  const merged = { ...(existing ?? {}), ...body };
  const domainId = text(merged.domain_id, 'domain_id', 36);
  const domain = await env.DB.prepare('SELECT * FROM domains WHERE id=?').bind(domainId).first<Domain>();
  if (!domain) fail(400, 'domain_not_found', 'Select an existing domain.');
  if (body.block_vpn !== undefined && ![true, false, 0, 1].includes(body.block_vpn as boolean | number)) fail(400, 'invalid_block_vpn', 'block_vpn must be a boolean or 0/1.');
  const blockVPN = booleanInt(merged.block_vpn, 0);
  if (blockVPN && !existing?.block_vpn && !browserChecksConfigured(env)) fail(503, 'browser_check_unconfigured', 'Configure BROWSER_CHECK_SECRET on both Workers before enabling VPN blocking.');
  const output = responseMode(merged.response_mode ?? 'redirect');
  const content = output === 'text' ? plainText(merged.text_content) : '';
  // Keep the legacy non-empty target_url constraint without a table rebuild.
  // This inert, non-HTTP sentinel is never fetched; old redirect code rejects it.
  const target = output === 'text' ? 'about:blank' : targetURL(merged.target_url);
  const rules = body.geo_rules === undefined ? (existing ? storedGeoRules(existing.geo_rules) : []) : geoRules(body.geo_rules);
  const serializedRules = JSON.stringify(rules);
  if (serializedRules.length > 65536) fail(400, 'invalid_geo_rules', 'Geographic rules are too large.');
  if (output === 'text' && rules.length) fail(400, 'text_geo_conflict', 'Plain text links cannot use geographic target rules. Clear geo_rules explicitly.');
  const mode = output === 'text' ? 'discard' : queryMode(merged.query_mode ?? 'discard');
  if (output === 'redirect') {
    await validateDestinations(env.DB, [target, ...rules.map(rule => rule.target_url)], env);
    for (const destination of [target, ...rules.map(rule => rule.target_url)]) checkQueryPolicy(destination, mode);
  }
  if (body.reset_redirect_count !== undefined && typeof body.reset_redirect_count !== 'boolean') fail(400, 'invalid_field', 'reset_redirect_count must be a boolean.');
  const passwordHash = body.password === undefined ? (existing?.password_hash ?? null)
    : body.password === null ? null : await hashLinkPassword(body.password, env);
  const maxRedirects = merged.max_redirects == null ? null : integer(merged.max_redirects, 'max_redirects', 1, 1000000000);
  const now = nowSeconds();
  return {
    id: existing?.id ?? crypto.randomUUID(), domain_id: domainId,
    slug: slug(!existing && (merged.slug === undefined || merged.slug === '') ? randomSlug() : merged.slug),
    target_url: target, response_mode: output, text_content: content, block_vpn: blockVPN,
    title: text(merged.title, 'title', 200, ''), description: text(merged.description, 'description', 2000, ''),
    redirect_code: redirectCode(merged.redirect_code ?? domain.default_redirect_code),
    query_mode: mode,
    enabled: booleanInt(merged.enabled), expires_at: expiration(merged.expires_at),
    cache_ttl: integer(merged.cache_ttl ?? 0, 'cache_ttl', 0, 3600),
    created_by: existing?.created_by ?? null, created_at: existing?.created_at ?? now,
    updated_at: now, version: existing ? existing.version + 1 : 1,
    hostname: domain.hostname, domain_enabled: domain.enabled,
    geo_rules: serializedRules, password_hash: passwordHash, max_redirects: maxRedirects,
    redirect_count: existing?.redirect_count ?? 0, rule_revision: existing ? existing.rule_revision + 1 : 1,
  };
}
export function insertLink(db: Database, link: Link, userId: string): D1Statement {
  return db.prepare(`INSERT INTO links(id,domain_id,slug,target_url,title,description,redirect_code,query_mode,enabled,expires_at,cache_ttl,created_by,created_at,updated_at,geo_rules,password_hash,max_redirects,response_mode,text_content,block_vpn)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(link.id, link.domain_id, link.slug, link.target_url, link.title, link.description, link.redirect_code, link.query_mode, link.enabled, link.expires_at, link.cache_ttl, userId, link.created_at, link.updated_at, link.geo_rules, link.password_hash, link.max_redirects, link.response_mode, link.text_content, link.block_vpn);
}
export function linkAudit(link: Link): Record<string, unknown> {
  return { block_vpn: !!link.block_vpn, response_mode: link.response_mode, text_length: link.text_content.length, domain_id: link.domain_id, slug: link.slug, target_url: link.response_mode === 'text' ? '' : safeAuditURL(link.target_url), redirect_code: link.redirect_code, query_mode: link.query_mode, enabled: link.enabled, expires_at: link.expires_at, cache_ttl: link.cache_ttl, version: link.version,
    geo_rules: storedGeoRules(link.geo_rules).map(rule => ({ ...rule, target_url: safeAuditURL(rule.target_url) })),
    password_protected: link.password_hash !== null, max_redirects: link.max_redirects };
}
