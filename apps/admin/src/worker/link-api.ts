import { MAX_LINK_BATCH_ROWS } from '../../../../packages/shared/src/limits.js';
import type { Link } from '../../../../packages/shared/src/platform.js';
import {
  fail,
  integer,
  json,
  nowSeconds,
  readJSON,
  rejectUnknown,
  text,
} from '../../../../packages/shared/src/http.js';
import { evictRouteCache, putRouteCache } from '../../../../packages/shared/src/redirect-cache.js';
import { canMutateLink, linkWriteScope, requireLinkOwner, requireScope } from './auth.js';
import { needVersion, routeId, type ApiContext } from './api-context.js';
import {
  audit,
  changed,
  current,
  importDomains,
  insertLink,
  linkAudit,
  prepareLink,
  readLink,
  writeLinkBatch,
  type PreparedLink,
} from './data.js';

export async function createLink(context: ApiContext): Promise<Response> {
  const { env, executionContext, principal, request, requestId } = context;
  const body = await readJSON(request);
  const automaticSlug = body.slug === undefined || body.slug === '';
  for (let attempt = 0; attempt < 5; attempt++) {
    const { link, destinationHosts } = await prepareLink(body, env);
    try {
      await writeLinkBatch(env.DB, destinationHosts, [
        insertLink(env.DB, link, principal.user.id),
        audit(env.DB, principal, requestId, 'create', 'link', link.id, linkAudit(link)),
      ]);
    } catch (error) {
      if (automaticSlug && error instanceof Error && /UNIQUE/.test(error.message) && attempt < 4) {
        continue;
      }
      throw error;
    }
    await putRouteCache(env, link, executionContext);
    return json(await readLink(env.DB, link.id, env), 201);
  }
  return fail(500, 'slug_generation_failed', 'Could not allocate a unique slug.');
}

export async function getLink(context: ApiContext): Promise<Response> {
  return json(await readLink(context.env.DB, routeId(context), context.env));
}

export async function updateLink(context: ApiContext): Promise<Response> {
  const { env, executionContext, principal, request, requestId } = context;
  const id = routeId(context);
  const body = await readJSON(request);
  const version = needVersion(body);
  const old = await current<Link>(env.DB, 'links', id, version);
  requireLinkOwner(principal, old);
  const { link, destinationHosts } = await prepareLink(body, env, old);
  const resetCount = body.reset_redirect_count === true ? 1 : 0;
  const workspace = linkWriteScope(principal) === 'workspace' ? 1 : 0;
  const result = await writeLinkBatch(env.DB, destinationHosts, [
    env.DB.prepare(
      `UPDATE links SET domain_id=?,
      slug=?,target_url=?,title=?,description=?,redirect_code=?,query_mode=?,
      enabled=?,expires_at=?,cache_ttl=?,kv_cache_ttl=?,geo_rules=?,password_hash=?,
      max_redirects=?,response_mode=?,text_content=?,block_vpn=?,
      redirect_count=CASE WHEN ?=1 THEN 0 ELSE redirect_count END,
      updated_at=?,version=version+1
      WHERE id=? AND version=? AND (?=1 OR created_by=?) RETURNING id`,
    ).bind(
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
      link.kv_cache_ttl,
      link.geo_rules,
      link.password_hash,
      link.max_redirects,
      link.response_mode,
      link.text_content,
      link.block_vpn,
      resetCount,
      link.updated_at,
      link.id,
      version,
      workspace,
      principal.user.id,
    ),
    audit(
      env.DB,
      principal,
      requestId,
      'update',
      'link',
      link.id,
      {
        before: linkAudit(old),
        after: linkAudit(link),
        reset_redirect_count: body.reset_redirect_count === true,
      },
      true,
    ),
  ]);
  changed(result);
  if (env.REDIRECT_CACHE && (old.slug !== link.slug || old.domain_id !== link.domain_id)) {
    try {
      const previousDomain = await env.DB.prepare('SELECT hostname FROM domains WHERE id=?')
        .bind(old.domain_id)
        .first<{ hostname: string }>();
      await evictRouteCache(env, previousDomain?.hostname, old.slug, executionContext, old);
    } catch {
      console.warn(
        JSON.stringify({ event: 'redirect_cache_failure', operation: 'invalidate-host' }),
      );
    }
    // Mutation already committed. Fresh D1 hit guards reject old keys even if
    // cache maintenance fails or propagation is delayed.
  }
  await putRouteCache(env, link, executionContext);
  return json(await readLink(env.DB, id, env));
}

export async function deleteLink(context: ApiContext): Promise<Response> {
  const { env, executionContext, principal, requestId, url } = context;
  const id = routeId(context);
  const version = integer(
    Number(url.searchParams.get('version')),
    'version',
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const old = await current<Link>(env.DB, 'links', id, version);
  requireLinkOwner(principal, old);
  const workspace = linkWriteScope(principal) === 'workspace' ? 1 : 0;
  const result = await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM links
      WHERE id=? AND version=? AND (?=1 OR created_by=?) RETURNING id`,
    ).bind(id, version, workspace, principal.user.id),
    audit(env.DB, principal, requestId, 'delete', 'link', id, linkAudit(old), true),
  ]);
  changed(result);
  if (env.REDIRECT_CACHE) {
    try {
      const previousDomain = await env.DB.prepare('SELECT hostname FROM domains WHERE id=?')
        .bind(old.domain_id)
        .first<{ hostname: string }>();
      await evictRouteCache(env, previousDomain?.hostname, old.slug, executionContext, old);
    } catch {
      console.warn(
        JSON.stringify({ event: 'redirect_cache_failure', operation: 'invalidate-host' }),
      );
    }
    // Mutation already committed. Fresh D1 hit guards reject old keys even if
    // cache maintenance fails or propagation is delayed.
  }
  return json({ deleted: true });
}

export async function importLinks(context: ApiContext): Promise<Response> {
  const { env, executionContext, principal, request, requestId } = context;
  const body = await readJSON(request);
  rejectUnknown(body, ['links']);
  if (
    !Array.isArray(body.links) ||
    body.links.length < 1 ||
    body.links.length > MAX_LINK_BATCH_ROWS
  ) {
    fail(400, 'invalid_import', 'Each atomic import batch must contain 1–10 links.');
  }
  const items = body.links.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      fail(400, 'invalid_import', 'Each imported item must be an object.');
    }
    return item as Record<string, unknown>;
  });
  const domains = await importDomains(env.DB, items);
  const prepared: PreparedLink[] = [];
  for (const item of items) {
    prepared.push(await prepareLink(item, env, undefined, domains));
  }
  const normalized = prepared.map(({ link }) => link);
  const statements = normalized.flatMap((link) => [
    insertLink(env.DB, link, principal.user.id),
    audit(env.DB, principal, requestId, 'import', 'link', link.id, linkAudit(link)),
  ]);
  await writeLinkBatch(
    env.DB,
    prepared.flatMap(({ destinationHosts }) => destinationHosts),
    statements,
  );
  for (const link of normalized) await putRouteCache(env, link, executionContext);
  return json({ imported: normalized.length, ids: normalized.map((link) => link.id) }, 201);
}

export async function bulkLinks(context: ApiContext): Promise<Response> {
  const { env, executionContext, principal, request, requestId } = context;
  const body = await readJSON(request);
  rejectUnknown(body, ['action', 'items']);
  const action = body.action;
  if (action !== 'enable' && action !== 'disable' && action !== 'delete') {
    fail(400, 'invalid_action', 'Unknown bulk action.');
  }
  requireScope(principal, action === 'delete' ? 'links:delete' : 'links:write');
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > MAX_LINK_BATCH_ROWS) {
    fail(400, 'invalid_batch', 'Select 1–10 items per batch.');
  }
  const items: { id: string; version: number }[] = [];
  for (const item of body.items) {
    if (!item || typeof item !== 'object') fail(400, 'invalid_batch', 'Invalid item.');
    const row = item as Record<string, unknown>;
    const id = text(row.id, 'id', 36);
    const version = needVersion(row);
    if (items.some((candidate) => candidate.id === id)) {
      fail(400, 'duplicate_item', 'Duplicate item.');
    }
    items.push({ id, version });
  }
  // Snapshot ownership once, then repeat it in the conditional SQL mutation.
  // An ownership race cannot widen access; unauthorized entries do not emit a
  // successful-change audit record. Partial bulk semantics remain explicit.
  const placeholders = items.map(() => '?').join(',');
  const rows = await env.DB.prepare(
    `SELECT l.*,d.hostname,d.enabled AS domain_enabled
    FROM links l JOIN domains d ON d.id=l.domain_id
    WHERE l.id IN (${placeholders})`,
  )
    .bind(...items.map((item) => item.id))
    .all<Link>();
  const ownership = new Map(rows.results.map((row) => [row.id, row]));
  const workspace = linkWriteScope(principal) === 'workspace' ? 1 : 0;
  const results: { id: string; ok: boolean; conflict?: boolean; forbidden?: boolean }[] = [];
  for (const item of items) {
    const row = ownership.get(item.id);
    if (row && !canMutateLink(principal, row)) {
      results.push({ id: item.id, ok: false, forbidden: true });
      continue;
    }
    const statement =
      action === 'delete'
        ? env.DB.prepare(
            `DELETE FROM links
          WHERE id=? AND version=? AND (?=1 OR created_by=?) RETURNING id`,
          ).bind(item.id, item.version, workspace, principal.user.id)
        : env.DB.prepare(
            `UPDATE links SET enabled=?,updated_at=?,version=version+1
          WHERE id=? AND version=? AND (?=1 OR created_by=?) RETURNING id`,
          ).bind(
            action === 'enable' ? 1 : 0,
            nowSeconds(),
            item.id,
            item.version,
            workspace,
            principal.user.id,
          );
    const result = await env.DB.batch([
      statement,
      audit(env.DB, principal, requestId, action, 'link', item.id, {}, true),
    ]);
    const success = !!result[0]?.results.length;
    if (success && row) {
      if (action === 'delete') {
        await evictRouteCache(env, row.hostname, row.slug, executionContext, row);
      } else {
        await putRouteCache(
          env,
          {
            ...row,
            enabled: action === 'enable' ? 1 : 0,
            version: row.version + 1,
            rule_revision: row.rule_revision + 1,
          },
          executionContext,
        );
      }
    }
    results.push({ id: item.id, ok: success, ...(!success ? { conflict: true } : {}) });
  }
  return json({ results });
}
