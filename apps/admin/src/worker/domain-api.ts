import type { Domain } from '../../../../packages/shared/src/platform.js';
import {
  booleanInt,
  fail,
  integer,
  json,
  nowSeconds,
  readJSON,
  rejectUnknown,
  text,
} from '../../../../packages/shared/src/http.js';
import { hostname, redirectCode } from '../../../../packages/shared/src/validation.js';
import { canonicalHost } from '../../../../packages/shared/src/policy.js';
import { needVersion, routeId, type ApiContext } from './api-context.js';
import { audit, changed, current } from './data.js';

export async function getDomains({ env, url }: ApiContext): Promise<Response> {
  const view = url.searchParams.get('view') ?? 'full';
  if (view !== 'full' && view !== 'directory') fail(400, 'invalid_view', 'Unknown domains view.');
  const sql =
    view === 'directory'
      ? 'SELECT id,hostname,enabled,default_redirect_code FROM domains ORDER BY hostname'
      : `SELECT d.*,
    (SELECT COUNT(*) FROM links l WHERE l.domain_id=d.id) AS link_count
    FROM domains d ORDER BY hostname`;
  const data = await env.DB.prepare(sql).all();
  return json(data.results);
}

export async function createDomain(context: ApiContext): Promise<Response> {
  const { env, principal, request, requestId } = context;
  const body = await readJSON(request);
  rejectUnknown(body, ['hostname', 'name', 'enabled', 'default_redirect_code']);
  const host = hostname(body.hostname, env.ENVIRONMENT === 'development');
  if (
    host === canonicalHost(new URL(env.ADMIN_ORIGIN).hostname) &&
    env.ENVIRONMENT !== 'development'
  ) {
    fail(400, 'admin_hostname', 'The admin hostname must be separate.');
  }
  const id = crypto.randomUUID();
  const now = nowSeconds();
  const values = {
    hostname: host,
    name: text(body.name, 'name', 100, ''),
    enabled: booleanInt(body.enabled),
    code: redirectCode(body.default_redirect_code ?? 301),
  };
  const result = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO domains(
      id,hostname,name,enabled,default_redirect_code,created_at,updated_at
    ) SELECT ?,?,?,?,?,?,?
      WHERE NOT EXISTS(SELECT 1 FROM link_destination_hosts WHERE hostname=?)
      RETURNING id`,
    ).bind(id, host, values.name, values.enabled, values.code, now, now, host),
    audit(env.DB, principal, requestId, 'create', 'domain', id, values, true),
  ]);
  if (!result[0]?.results.length) {
    fail(
      409,
      'hostname_is_destination',
      'Existing links target this hostname; migrate them to final destinations first.',
    );
  }
  return json(await current<Domain>(env.DB, 'domains', id), 201);
}

export async function updateDomain(context: ApiContext): Promise<Response> {
  const { env, principal, request, requestId } = context;
  const id = routeId(context);
  const body = await readJSON(request);
  rejectUnknown(body, ['version', 'name', 'enabled', 'default_redirect_code']);
  const version = needVersion(body);
  const old = await current<Domain>(env.DB, 'domains', id, version);
  const values = {
    name: text(body.name, 'name', 100, old.name),
    enabled: booleanInt(body.enabled, old.enabled),
    code: redirectCode(body.default_redirect_code ?? old.default_redirect_code),
  };
  const result = await env.DB.batch([
    env.DB.prepare(
      `UPDATE domains
      SET name=?,enabled=?,default_redirect_code=?,updated_at=?,version=version+1
      WHERE id=? AND version=? RETURNING id`,
    ).bind(values.name, values.enabled, values.code, nowSeconds(), id, version),
    audit(env.DB, principal, requestId, 'update', 'domain', id, values, true),
  ]);
  changed(result);
  return json(await current<Domain>(env.DB, 'domains', id));
}

export async function deleteDomain(context: ApiContext): Promise<Response> {
  const { env, principal, requestId, url } = context;
  const id = routeId(context);
  const version = integer(
    Number(url.searchParams.get('version')),
    'version',
    1,
    Number.MAX_SAFE_INTEGER,
  );
  await current<Domain>(env.DB, 'domains', id, version);
  const result = await env.DB.batch([
    env.DB.prepare('DELETE FROM domains WHERE id=? AND version=? RETURNING id').bind(id, version),
    audit(env.DB, principal, requestId, 'delete', 'domain', id, {}, true),
  ]);
  changed(result);
  return json({ deleted: true });
}
