import { newToken, sha256 } from '../../../../packages/shared/src/crypto.js';
import {
  fail,
  integer,
  json,
  nowSeconds,
  readJSON,
  rejectUnknown,
  text,
} from '../../../../packages/shared/src/http.js';
import { TOKEN_SCOPES } from './auth.js';
import { audit } from './data.js';
import { routeId, type ApiContext } from './api-context.js';

export async function getTokens({ env, principal }: ApiContext): Promise<Response> {
  const data = await env.DB.prepare(
    `SELECT
    id,name,prefix,scopes,expires_at,revoked_at,created_at
    FROM api_tokens WHERE user_id=? ORDER BY created_at DESC`,
  )
    .bind(principal.user.id)
    .all();
  return json(data.results);
}

export async function createToken(context: ApiContext): Promise<Response> {
  const { env, principal, request, requestId } = context;
  const body = await readJSON(request);
  rejectUnknown(body, ['name', 'scopes', 'expires_at']);
  const name = text(body.name, 'name', 100);
  if (!name.trim()) fail(400, 'invalid_name', 'Token name is required.');
  if (
    !Array.isArray(body.scopes) ||
    !body.scopes.length ||
    body.scopes.length > TOKEN_SCOPES.length ||
    body.scopes.some(
      (scope) =>
        typeof scope !== 'string' ||
        !TOKEN_SCOPES.includes(scope) ||
        !principal.scopes.includes(scope),
    )
  ) {
    fail(403, 'invalid_scopes', 'Choose non-administrative scopes allowed by your role.');
  }
  const expires = integer(
    body.expires_at,
    'expires_at',
    nowSeconds() + 60,
    nowSeconds() + 365 * 86400,
  );
  const active = await env.DB.prepare(
    `SELECT COUNT(*) AS n
    FROM api_tokens WHERE user_id=? AND revoked_at IS NULL`,
  )
    .bind(principal.user.id)
    .first<{ n: number }>();
  if ((active?.n ?? 0) >= 50) {
    fail(409, 'token_limit', 'Revoke unused tokens before creating more.');
  }
  const token = newToken();
  const id = crypto.randomUUID();
  const scopes = [...new Set(body.scopes as string[])];
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO api_tokens(
      id,user_id,name,token_hash,prefix,scopes,expires_at,created_at
    ) VALUES(?,?,?,?,?,?,?,?)`,
    ).bind(
      id,
      principal.user.id,
      name,
      await sha256(token),
      token.slice(0, 12),
      JSON.stringify(scopes),
      expires,
      nowSeconds(),
    ),
    audit(env.DB, principal, requestId, 'create', 'token', id, {
      name,
      scopes,
      expires_at: expires,
    }),
  ]);
  return json({ id, token, name, scopes, expires_at: expires, shown_once: true }, 201);
}

export async function revokeToken(context: ApiContext): Promise<Response> {
  const { env, principal, requestId } = context;
  const id = routeId(context);
  const result = await env.DB.batch([
    env.DB.prepare(
      `UPDATE api_tokens SET revoked_at=?
      WHERE id=? AND user_id=? AND revoked_at IS NULL RETURNING id`,
    ).bind(nowSeconds(), id, principal.user.id),
    audit(env.DB, principal, requestId, 'revoke', 'token', id, {}, true),
  ]);
  if (!result[0]?.results.length) fail(404, 'not_found', 'Active token not found.');
  return json({ revoked: true });
}
