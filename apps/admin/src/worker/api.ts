import { sourceURL } from '../../../../packages/shared/src/legal.js';
import type { Env, Principal, Link, Domain, User, Role, Context } from '../../../../packages/shared/src/platform.js';
import { VERSION } from '../../../../packages/shared/src/platform.js';
import { json, fail, readJSON, nowSeconds, pageParams, text, integer, booleanInt, rejectUnknown } from '../../../../packages/shared/src/http.js';
import { hostname, redirectCode, email } from '../../../../packages/shared/src/validation.js';
import { newToken, sha256 } from '../../../../packages/shared/src/crypto.js';
import { requireScope, requireBrowser, TOKEN_SCOPES, ROLE_SCOPES, linkWriteScope, canMutateLink, requireLinkOwner } from './auth.js';
import { audit, current, changed, normalizeLink, insertLink, linkAudit, readLink, publicLink } from './data.js';
import { browserCollectionEnabled, browserChecksConfigured } from '../../../../packages/shared/src/browser-check.js';
import { stats, analyticsConfigured, statsSelection, checkStatsSelection } from './analytics.js';
import { securityPolicy } from '../../../../packages/shared/src/policy.js';
import { passwordsConfigured } from '../../../../packages/shared/src/link-password.js';
import { putRouteCache, evictRouteCache } from '../../../../packages/shared/src/redirect-cache.js';

function userView(u: User): unknown { return { id: u.id, email: u.email, display_name: u.display_name, role: u.role, enabled: u.enabled, created_at: u.created_at, updated_at: u.updated_at, version: u.version }; }
function pathId(path: string, base: string): string | null {
  const match = new RegExp(`^${base}/([0-9a-f-]{36})$`).exec(path); return match?.[1] ?? null;
}
function needVersion(body: Record<string, unknown>): number { return integer(body.version, 'version', 1, Number.MAX_SAFE_INTEGER); }
function like(value: string): string { return value.replace(/[\\%_]/g, '\\$&'); }

export async function api(request: Request, env: Env, p: Principal, requestId: string, ctx?: Context): Promise<Response> {
  const url = new URL(request.url); const path = url.pathname.slice('/Linro/v1'.length); const method = request.method;
  if (path === '/session' && method === 'GET') {
    const setting = await env.DB.prepare("SELECT value FROM settings WHERE key='site_name'").first<{ value: string }>();
    const policy = securityPolicy(env);
    return json({ user: userView(p.user), scopes: p.scopes, source_url: sourceURL(env.SOURCE_URL), auth_kind: p.kind, site_name: !setting?.value || setting.value === 'cf-links' ? 'Linro' : setting.value, analytics_configured: analyticsConfigured(env), link_write_scope: linkWriteScope(p), features: { browser_timezone_collection_enabled: browserCollectionEnabled(env), browser_checks_configured: browserChecksConfigured(env), redirect_cache: !!env.REDIRECT_CACHE, cache_consistency: 'd1-guarded', passwords_configured: passwordsConfigured(env), text_responses: true, device_header_enabled: env.CLOUDFLARE_DEVICE_TYPE_ENABLED === 'true' }, security: { queryKeys: policy.queryKeys, expiredStatus: policy.expiredStatus }, version: VERSION });
  }
  if (path === '/summary' && method === 'GET') {
    requireScope(p, 'links:read'); const now = nowSeconds();
    const counts = await env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM links) AS links,
      (SELECT COUNT(*) FROM links l JOIN domains d ON d.id=l.domain_id WHERE l.enabled=1 AND d.enabled=1 AND (l.expires_at IS NULL OR l.expires_at>?) AND (l.max_redirects IS NULL OR l.redirect_count<l.max_redirects)) AS active,
      (SELECT COUNT(*) FROM links WHERE expires_at IS NOT NULL AND expires_at<=?) AS expired,
      (SELECT COUNT(*) FROM domains) AS domains`).bind(now, now).first();
    return json(counts);
  }
  if (path === '/links' && method === 'GET') {
    requireScope(p, 'links:read'); const pg = pageParams(url); const clauses: string[] = []; const values: unknown[] = [];
    const q = url.searchParams.get('q') ?? '';
    if (q.length > 120) fail(400, 'search_too_long', 'Search is limited to 120 characters.');
    if (q) { clauses.push("(l.slug LIKE ? ESCAPE '\\' OR l.title LIKE ? ESCAPE '\\' OR l.target_url LIKE ? ESCAPE '\\')"); values.push(`%${like(q)}%`, `%${like(q)}%`, `%${like(q)}%`); }
    const domain = url.searchParams.get('domain_id'); if (domain) { clauses.push('l.domain_id=?'); values.push(domain); }
    const status = url.searchParams.get('status'); const now = nowSeconds();
    if (status === 'active') { clauses.push('l.enabled=1 AND d.enabled=1 AND (l.expires_at IS NULL OR l.expires_at>?) AND (l.max_redirects IS NULL OR l.redirect_count<l.max_redirects)'); values.push(now); }
    else if (status === 'disabled') clauses.push('(l.enabled=0 OR d.enabled=0)');
    else if (status === 'expired') { clauses.push('l.expires_at IS NOT NULL AND l.expires_at<=?'); values.push(now); }
    else if (status === 'exhausted') clauses.push('l.max_redirects IS NOT NULL AND l.redirect_count>=l.max_redirects');
    else if (status && status !== 'all') fail(400, 'invalid_status', 'Unknown status filter.');
    const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
    const [data, count] = await env.DB.batch([
      env.DB.prepare(`SELECT l.*,d.hostname,d.enabled AS domain_enabled FROM links l JOIN domains d ON d.id=l.domain_id ${where} ORDER BY l.created_at DESC,l.id DESC LIMIT ? OFFSET ?`).bind(...values, pg.limit, pg.offset),
      env.DB.prepare(`SELECT COUNT(*) AS total FROM links l JOIN domains d ON d.id=l.domain_id ${where}`).bind(...values),
    ]);
    return json({ items: (data?.results as unknown as Link[] ?? []).map(l => publicLink(l, env)), total: count?.results[0]?.total ?? 0, page: pg.page, limit: pg.limit });
  }
  if (path === '/links' && method === 'POST') {
    requireScope(p, 'links:write'); const body = await readJSON(request); const auto = body.slug === undefined || body.slug === '';
    for (let attempt = 0; attempt < 5; attempt++) {
      const link = await normalizeLink(body, env);
      try { await env.DB.batch([insertLink(env.DB, link, p.user.id), audit(env.DB, p, requestId, 'create', 'link', link.id, linkAudit(link))]); }
      catch (error) { if (auto && error instanceof Error && /UNIQUE/.test(error.message) && attempt < 4) continue; throw error; }
      await putRouteCache(env, link, ctx);
      return json(await readLink(env.DB, link.id, env), 201);
    }
  }
  const linkId = pathId(path, '/links');
  if (linkId && method === 'GET') { requireScope(p, 'links:read'); return json(await readLink(env.DB, linkId, env)); }
  if (linkId && method === 'PATCH') {
    requireScope(p, 'links:write'); const body = await readJSON(request); const version = needVersion(body);
    const old = await current<Link>(env.DB, 'links', linkId, version); requireLinkOwner(p, old); const link = await normalizeLink(body, env, old);
    const result = await env.DB.batch([
      env.DB.prepare(`UPDATE links SET domain_id=?,slug=?,target_url=?,title=?,description=?,redirect_code=?,query_mode=?,enabled=?,expires_at=?,cache_ttl=?,geo_rules=?,password_hash=?,max_redirects=?,response_mode=?,text_content=?,block_vpn=?,redirect_count=CASE WHEN ?=1 THEN 0 ELSE redirect_count END,updated_at=?,version=version+1 WHERE id=? AND version=? AND (?=1 OR created_by=?) RETURNING id`).bind(link.domain_id, link.slug, link.target_url, link.title, link.description, link.redirect_code, link.query_mode, link.enabled, link.expires_at, link.cache_ttl, link.geo_rules, link.password_hash, link.max_redirects, link.response_mode, link.text_content, link.block_vpn, body.reset_redirect_count === true ? 1 : 0, link.updated_at, link.id, version, linkWriteScope(p) === 'workspace' ? 1 : 0, p.user.id),
      audit(env.DB, p, requestId, 'update', 'link', link.id, { before: linkAudit(old), after: linkAudit(link), reset_redirect_count: body.reset_redirect_count === true }, true),
    ]); changed(result);
    if (env.REDIRECT_CACHE && (old.slug !== link.slug || old.domain_id !== link.domain_id)) {
      try {
        const previousDomain = await env.DB.prepare('SELECT hostname FROM domains WHERE id=?').bind(old.domain_id).first<{ hostname: string }>();
        await evictRouteCache(env, previousDomain?.hostname, old.slug, ctx);
      } catch { console.warn(JSON.stringify({ event: 'redirect_cache_failure', operation: 'invalidate-host' })); }
      // Mutation already committed. A cache maintenance failure is not a failed
      // write; fresh D1 hit guards reject old keys regardless of KV propagation.
    }
    await putRouteCache(env, link, ctx);
    return json(await readLink(env.DB, linkId, env));
  }
  if (linkId && method === 'DELETE') {
    requireScope(p, 'links:delete'); const version = integer(Number(url.searchParams.get('version')), 'version', 1, Number.MAX_SAFE_INTEGER);
    const old = await current<Link>(env.DB, 'links', linkId, version); requireLinkOwner(p, old);
    const result = await env.DB.batch([
      env.DB.prepare('DELETE FROM links WHERE id=? AND version=? AND (?=1 OR created_by=?) RETURNING id').bind(linkId, version, linkWriteScope(p) === 'workspace' ? 1 : 0, p.user.id),
      audit(env.DB, p, requestId, 'delete', 'link', linkId, linkAudit(old), true),
    ]); changed(result);
    if (env.REDIRECT_CACHE) {
      try {
        const previousDomain = await env.DB.prepare('SELECT hostname FROM domains WHERE id=?').bind(old.domain_id).first<{ hostname: string }>();
        await evictRouteCache(env, previousDomain?.hostname, old.slug, ctx);
      } catch { console.warn(JSON.stringify({ event: 'redirect_cache_failure', operation: 'invalidate-host' })); }
      // Mutation already committed. A cache maintenance failure is not a failed
      // write; fresh D1 hit guards reject old keys regardless of KV propagation.
    }
    return json({ deleted: true });
  }
  if (path === '/links/import' && method === 'POST') {
    requireScope(p, 'links:write'); const body = await readJSON(request); rejectUnknown(body, ['links']);
    if (!Array.isArray(body.links) || body.links.length < 1 || body.links.length > 10) fail(400, 'invalid_import', 'Each atomic import batch must contain 1–10 links.');
    const normalized: Link[] = [];
    for (const item of body.links) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) fail(400, 'invalid_import', 'Each imported item must be an object.');
      normalized.push(await normalizeLink(item as Record<string, unknown>, env));
    }
    const statements = normalized.flatMap(link => [insertLink(env.DB, link, p.user.id), audit(env.DB, p, requestId, 'import', 'link', link.id, linkAudit(link))]);
    await env.DB.batch(statements);
    for (const link of normalized) await putRouteCache(env, link, ctx);
    return json({ imported: normalized.length, ids: normalized.map(link => link.id) }, 201);
  }
  if (path === '/links/bulk' && method === 'POST') {
    const body = await readJSON(request); rejectUnknown(body, ['action', 'items']);
    const action = body.action;
    if (action !== 'enable' && action !== 'disable' && action !== 'delete') fail(400, 'invalid_action', 'Unknown bulk action.');
    requireScope(p, action === 'delete' ? 'links:delete' : 'links:write');
    if (!Array.isArray(body.items) || !body.items.length || body.items.length > 10) fail(400, 'invalid_batch', 'Select 1–10 items per batch.');
    const items: { id: string; version: number }[] = [];
    for (const item of body.items) {
      if (!item || typeof item !== 'object') fail(400, 'invalid_batch', 'Invalid item.');
      const row = item as Record<string, unknown>;
      const id = text(row.id, 'id', 36); const version = needVersion(row);
      if (items.some(i => i.id === id)) fail(400, 'duplicate_item', 'Duplicate item.');
      items.push({ id, version });
    }
    // Snapshot ownership once, then repeat it in the conditional SQL mutation.
    // An ownership race cannot widen access; unauthorized entries do not emit
    // a successful-change audit record. Partial bulk semantics remain explicit.
    const rows = await env.DB.prepare(`SELECT l.*,d.hostname,d.enabled AS domain_enabled FROM links l JOIN domains d ON d.id=l.domain_id WHERE l.id IN (${items.map(() => '?').join(',')})`).bind(...items.map(i => i.id)).all<Link>();
    const ownership = new Map(rows.results.map(row => [row.id, row]));
    const all = linkWriteScope(p) === 'workspace' ? 1 : 0;
    const results: { id: string; ok: boolean; conflict?: boolean; forbidden?: boolean }[] = [];
    for (const item of items) {
      const row = ownership.get(item.id);
      if (row && !canMutateLink(p, row)) { results.push({ id: item.id, ok: false, forbidden: true }); continue; }
      const statement = action === 'delete' ? env.DB.prepare('DELETE FROM links WHERE id=? AND version=? AND (?=1 OR created_by=?) RETURNING id').bind(item.id, item.version, all, p.user.id)
        : env.DB.prepare('UPDATE links SET enabled=?,updated_at=?,version=version+1 WHERE id=? AND version=? AND (?=1 OR created_by=?) RETURNING id').bind(action === 'enable' ? 1 : 0, nowSeconds(), item.id, item.version, all, p.user.id);
      const result = await env.DB.batch([statement, audit(env.DB, p, requestId, action, 'link', item.id, {}, true)]);
      const success = !!result[0]?.results.length;
      if (success && row) {
        if (action === 'delete') await evictRouteCache(env, row.hostname, row.slug, ctx);
        else await putRouteCache(env, { ...row, enabled: action === 'enable' ? 1 : 0, version: row.version + 1, rule_revision: row.rule_revision + 1 }, ctx);
      }
      results.push({ id: item.id, ok: success, ...(!success ? { conflict: true } : {}) });
    }
    return json({ results });
  }
  if (path === '/domains' && method === 'GET') {
    requireScope(p, 'domains:read');
    const data = await env.DB.prepare('SELECT d.*,(SELECT COUNT(*) FROM links l WHERE l.domain_id=d.id) AS link_count FROM domains d ORDER BY hostname').all();
    return json(data.results);
  }
  if (path === '/domains' && method === 'POST') {
    requireScope(p, 'domains:write'); const body = await readJSON(request); rejectUnknown(body, ['hostname', 'name', 'enabled', 'default_redirect_code']);
    const host = hostname(body.hostname, env.ENVIRONMENT === 'development');
    if (host === new URL(env.ADMIN_ORIGIN).hostname && env.ENVIRONMENT !== 'development') fail(400, 'admin_hostname', 'The admin hostname must be separate.');
    const patterns = [`https://${host}/%`, `http://${host}/%`, `https://${host}:%`, `http://${host}:%`];
    const refs = await env.DB.prepare(`SELECT id FROM links l WHERE target_url LIKE ? OR target_url LIKE ? OR target_url LIKE ? OR target_url LIKE ?
      OR EXISTS(SELECT 1 FROM json_each(l.geo_rules) r WHERE json_extract(r.value,'$.target_url') LIKE ? OR json_extract(r.value,'$.target_url') LIKE ?
      OR json_extract(r.value,'$.target_url') LIKE ? OR json_extract(r.value,'$.target_url') LIKE ?) LIMIT 1`).bind(...patterns, ...patterns).first();
    if (refs) fail(409, 'hostname_is_destination', 'Existing links target this hostname; migrate them to final destinations first.');
    const id = crypto.randomUUID(); const now = nowSeconds();
    const values = { hostname: host, name: text(body.name, 'name', 100, ''), enabled: booleanInt(body.enabled), code: redirectCode(body.default_redirect_code ?? 301) };
    await env.DB.batch([
      env.DB.prepare('INSERT INTO domains(id,hostname,name,enabled,default_redirect_code,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind(id, host, values.name, values.enabled, values.code, now, now),
      audit(env.DB, p, requestId, 'create', 'domain', id, values),
    ]); return json(await current<Domain>(env.DB, 'domains', id), 201);
  }
  const domainId = pathId(path, '/domains');
  if (domainId && method === 'PATCH') {
    requireScope(p, 'domains:write'); const body = await readJSON(request); rejectUnknown(body, ['version', 'name', 'enabled', 'default_redirect_code']);
    const version = needVersion(body); const old = await current<Domain>(env.DB, 'domains', domainId, version);
    const values = { name: text(body.name, 'name', 100, old.name), enabled: booleanInt(body.enabled, old.enabled), code: redirectCode(body.default_redirect_code ?? old.default_redirect_code) };
    const result = await env.DB.batch([
      env.DB.prepare('UPDATE domains SET name=?,enabled=?,default_redirect_code=?,updated_at=?,version=version+1 WHERE id=? AND version=? RETURNING id').bind(values.name, values.enabled, values.code, nowSeconds(), domainId, version),
      audit(env.DB, p, requestId, 'update', 'domain', domainId, values, true),
    ]); changed(result); return json(await current<Domain>(env.DB, 'domains', domainId));
  }
  if (domainId && method === 'DELETE') {
    requireScope(p, 'domains:write'); const version = integer(Number(url.searchParams.get('version')), 'version', 1, Number.MAX_SAFE_INTEGER);
    await current<Domain>(env.DB, 'domains', domainId, version);
    const result = await env.DB.batch([env.DB.prepare('DELETE FROM domains WHERE id=? AND version=? RETURNING id').bind(domainId, version), audit(env.DB, p, requestId, 'delete', 'domain', domainId, {}, true)]);
    changed(result); return json({ deleted: true });
  }
  if (path === '/stats' && method === 'GET') {
    requireScope(p, 'analytics:read'); const days = integer(Number(url.searchParams.get('days') ?? 7), 'days', 1, 90);
    return json(await stats(env, days, statsSelection(url)));
  }
  if (path === '/stats/archive' && method === 'GET') {
    requireScope(p, 'analytics:read'); const pg = pageParams(url);
    const ids = statsSelection(url); await checkStatsSelection(env, ids);
    const filter = ids ? `WHERE s.link_id IN (${ids.map(() => '?').join(',')})` : '';
    const data = await env.DB.prepare(`SELECT s.*,l.slug,d.hostname FROM daily_stats s JOIN links l ON l.id=s.link_id JOIN domains d ON d.id=l.domain_id ${filter} ORDER BY s.date DESC,s.link_id LIMIT ? OFFSET ?`).bind(...(ids ?? []), pg.limit, pg.offset).all();
    return json({ items: data.results, sampled: true, page: pg.page, limit: pg.limit, link_ids: ids, dimension_detail_available: false });
  }
  if (path === '/users' && method === 'GET') {
    requireScope(p, 'users:write'); requireBrowser(p);
    const data = await env.DB.prepare('SELECT * FROM users ORDER BY created_at').all<User>(); return json(data.results.map(userView));
  }
  if (path === '/users' && method === 'POST') {
    requireScope(p, 'users:write'); requireBrowser(p); const body = await readJSON(request); rejectUnknown(body, ['email', 'display_name', 'role']);
    const e = email(body.email); const role = text(body.role, 'role', 10, 'viewer') as Role;
    if (!Object.hasOwn(ROLE_SCOPES, role)) fail(400, 'invalid_role', 'Unknown role.');
    const id = crypto.randomUUID(); const now = nowSeconds(); const name = text(body.display_name, 'display_name', 100, '');
    await env.DB.batch([
      env.DB.prepare('INSERT INTO users(id,email,display_name,role,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(id, e, name, role, now, now),
      audit(env.DB, p, requestId, 'create', 'user', id, { email: e, role }),
    ]); return json(userView(await current<User>(env.DB, 'users', id)), 201);
  }
  const userId = pathId(path, '/users');
  if (userId && method === 'PATCH') {
    requireScope(p, 'users:write'); requireBrowser(p); const body = await readJSON(request); rejectUnknown(body, ['version', 'display_name', 'role', 'enabled']);
    const version = needVersion(body); const old = await current<User>(env.DB, 'users', userId, version);
    const role = (body.role ?? old.role) as Role;
    if (typeof role !== 'string' || !Object.hasOwn(ROLE_SCOPES, role)) fail(400, 'invalid_role', 'Unknown role.');
    const enabled = booleanInt(body.enabled, old.enabled); const name = text(body.display_name, 'display_name', 100, old.display_name);
    const result = await env.DB.batch([
      env.DB.prepare('UPDATE users SET display_name=?,role=?,enabled=?,updated_at=?,version=version+1 WHERE id=? AND version=? RETURNING id').bind(name, role, enabled, nowSeconds(), userId, version),
      audit(env.DB, p, requestId, 'update', 'user', userId, { role, enabled }, true),
    ]); changed(result); return json(userView(await current<User>(env.DB, 'users', userId)));
  }
  if (path === '/tokens' && method === 'GET') {
    requireBrowser(p);
    return json((await env.DB.prepare('SELECT id,name,prefix,scopes,expires_at,revoked_at,created_at FROM api_tokens WHERE user_id=? ORDER BY created_at DESC').bind(p.user.id).all()).results);
  }
  if (path === '/tokens' && method === 'POST') {
    requireBrowser(p); const body = await readJSON(request); rejectUnknown(body, ['name', 'scopes', 'expires_at']);
    const name = text(body.name, 'name', 100); if (!name.trim()) fail(400, 'invalid_name', 'Token name is required.');
    if (!Array.isArray(body.scopes) || !body.scopes.length || body.scopes.length > TOKEN_SCOPES.length || body.scopes.some(s => typeof s !== 'string' || !TOKEN_SCOPES.includes(s) || !p.scopes.includes(s))) fail(403, 'invalid_scopes', 'Choose non-administrative scopes allowed by your role.');
    const expires = integer(body.expires_at, 'expires_at', nowSeconds() + 60, nowSeconds() + 365 * 86400);
    const active = await env.DB.prepare('SELECT COUNT(*) AS n FROM api_tokens WHERE user_id=? AND revoked_at IS NULL').bind(p.user.id).first<{ n: number }>();
    if ((active?.n ?? 0) >= 50) fail(409, 'token_limit', 'Revoke unused tokens before creating more.');
    const token = newToken(); const id = crypto.randomUUID(); const scopes = [...new Set(body.scopes as string[])];
    await env.DB.batch([
      env.DB.prepare('INSERT INTO api_tokens(id,user_id,name,token_hash,prefix,scopes,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(id, p.user.id, name, await sha256(token), token.slice(0, 12), JSON.stringify(scopes), expires, nowSeconds()),
      audit(env.DB, p, requestId, 'create', 'token', id, { name, scopes, expires_at: expires }),
    ]); return json({ id, token, name, scopes, expires_at: expires, shown_once: true }, 201);
  }
  const tokenId = pathId(path, '/tokens');
  if (tokenId && method === 'DELETE') {
    requireBrowser(p);
    const result = await env.DB.batch([
      env.DB.prepare('UPDATE api_tokens SET revoked_at=? WHERE id=? AND user_id=? AND revoked_at IS NULL RETURNING id').bind(nowSeconds(), tokenId, p.user.id),
      audit(env.DB, p, requestId, 'revoke', 'token', tokenId, {}, true),
    ]); if (!result[0]?.results.length) fail(404, 'not_found', 'Active token not found.'); return json({ revoked: true });
  }
  if (path === '/audit' && method === 'GET') {
    requireScope(p, 'audit:read'); const pg = pageParams(url);
    const [rows, count] = await env.DB.batch([
      env.DB.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?').bind(pg.limit, pg.offset),
      env.DB.prepare('SELECT COUNT(*) AS total FROM audit_logs'),
    ]); return json({ items: rows?.results ?? [], total: count?.results[0]?.total ?? 0, page: pg.page, limit: pg.limit });
  }
  if (path === '/settings' && method === 'GET') {
    requireScope(p, 'settings:write'); requireBrowser(p);
    return json((await env.DB.prepare('SELECT * FROM settings ORDER BY key').all()).results);
  }
  if (path === '/settings' && method === 'PATCH') {
    requireScope(p, 'settings:write'); requireBrowser(p); const body = await readJSON(request); rejectUnknown(body, ['site_name']);
    const name = text(body.site_name, 'site_name', 80); if (!name.trim()) fail(400, 'invalid_name', 'Site name is required.');
    await env.DB.batch([
      env.DB.prepare("INSERT INTO settings(key,value,updated_at) VALUES('site_name',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(name, nowSeconds()),
      audit(env.DB, p, requestId, 'update', 'settings', 'site_name', { site_name: name }),
    ]); return json({ site_name: name });
  }
  if (path === '/system/health' && method === 'GET') {
    requireScope(p, 'settings:write');
    await env.DB.prepare('SELECT 1 AS ok').first();
    return json({ worker: 'ok', database: 'ok', analytics: analyticsConfigured(env) ? 'configured_not_probed' : 'disabled_or_incomplete', version: VERSION });
  }
  return fail(404, 'api_not_found', 'API endpoint or method not found.');
}
