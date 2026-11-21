import type { Role, User } from '../../../../packages/shared/src/platform.js';
import {
  booleanInt,
  fail,
  json,
  nowSeconds,
  readJSON,
  rejectUnknown,
  text,
} from '../../../../packages/shared/src/http.js';
import { email } from '../../../../packages/shared/src/validation.js';
import { ROLE_SCOPES } from './auth.js';
import { audit, changed, current } from './data.js';
import { needVersion, routeId, type ApiContext } from './api-context.js';

export function userView(user: User): unknown {
  return {
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    role: user.role,
    enabled: user.enabled,
    created_at: user.created_at,
    updated_at: user.updated_at,
    version: user.version,
  };
}

export async function getUsers({ env }: ApiContext): Promise<Response> {
  const data = await env.DB.prepare('SELECT * FROM users ORDER BY created_at').all<User>();
  return json(data.results.map(userView));
}

export async function createUser(context: ApiContext): Promise<Response> {
  const { env, principal, request, requestId } = context;
  const body = await readJSON(request);
  rejectUnknown(body, ['email', 'display_name', 'role']);
  const normalizedEmail = email(body.email);
  const role = text(body.role, 'role', 10, 'viewer') as Role;
  if (!Object.hasOwn(ROLE_SCOPES, role)) fail(400, 'invalid_role', 'Unknown role.');
  const id = crypto.randomUUID();
  const now = nowSeconds();
  const name = text(body.display_name, 'display_name', 100, '');
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users(
      id,email,display_name,role,created_at,updated_at
    ) VALUES(?,?,?,?,?,?)`,
    ).bind(id, normalizedEmail, name, role, now, now),
    audit(env.DB, principal, requestId, 'create', 'user', id, { email: normalizedEmail, role }),
  ]);
  return json(userView(await current<User>(env.DB, 'users', id)), 201);
}

export async function updateUser(context: ApiContext): Promise<Response> {
  const { env, principal, request, requestId } = context;
  const id = routeId(context);
  const body = await readJSON(request);
  rejectUnknown(body, ['version', 'display_name', 'role', 'enabled']);
  const version = needVersion(body);
  const old = await current<User>(env.DB, 'users', id, version);
  const role = (body.role ?? old.role) as Role;
  if (typeof role !== 'string' || !Object.hasOwn(ROLE_SCOPES, role)) {
    fail(400, 'invalid_role', 'Unknown role.');
  }
  const enabled = booleanInt(body.enabled, old.enabled);
  const name = text(body.display_name, 'display_name', 100, old.display_name);
  const result = await env.DB.batch([
    env.DB.prepare(
      `UPDATE users
      SET display_name=?,role=?,enabled=?,updated_at=?,version=version+1
      WHERE id=? AND version=? RETURNING id`,
    ).bind(name, role, enabled, nowSeconds(), id, version),
    audit(env.DB, principal, requestId, 'update', 'user', id, { role, enabled }, true),
  ]);
  changed(result);
  return json(userView(await current<User>(env.DB, 'users', id)));
}
