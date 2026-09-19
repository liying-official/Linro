// SPDX-License-Identifier: AGPL-3.0-only
// Linro modifications: 2026-09-18; inherited attribution is in NOTICE.
import type { Env, Context } from '../../../../packages/shared/src/platform.js';
import { addSourceLink } from '../../../../packages/shared/src/legal.js';
import { VERSION } from '../../../../packages/shared/src/platform.js';
import { fail, json, secure, errorResponse } from '../../../../packages/shared/src/http.js';
import { sha256 } from '../../../../packages/shared/src/crypto.js';
import { checkAdminHost, authenticate, localMode, checkCSRF } from './auth.js';
import { api } from './api.js';
import { rollup } from './analytics.js';
async function handle(request: Request, env: Env, requestId: string, ctx?: Context): Promise<Response> {
  checkAdminHost(request, env);
  const path = new URL(request.url).pathname;
  // Retired API routes must not fall through to the GUI's SPA response.
  if (path === '/api' || path.startsWith('/api/')) fail(404, 'api_not_found', 'Use /Linro/v1.');
  const isHealth = path === '/health';
  const isAPI = path === '/Linro' || path.startsWith('/Linro/');
  if ((isAPI || isHealth) && env.AUTH_LIMITER) {
    const ip = request.headers.get('cf-connecting-ip') ?? 'local';
    const r = await env.AUTH_LIMITER.limit({ key: await sha256(ip) });
    if (!r.success) fail(429, 'rate_limited', 'Too many API requests.');
  }
  // The GUI is same-origin; CLI/token clients may omit Origin. Reject foreign
  // API origins before authentication and data access regardless of edge CORS.
  const origin = request.headers.get('origin');
  if (isAPI && origin !== null && origin !== env.ADMIN_ORIGIN) {
    fail(403, 'cross_origin', 'Cross-origin API requests are not allowed.');
  }
  // Local-only shell permits entering the generated development key. Production
  // assets, deep routes, and APIs all pass through Access verification.
  if (localMode(request, env) && !isAPI && !isHealth && ['GET', 'HEAD'].includes(request.method)) {
    if (!env.ASSETS) fail(503, 'assets_missing', 'Build the Web GUI first.');
    const response = await env.ASSETS.fetch(request); const headers = new Headers(response.headers); headers.set('Cache-Control', 'no-store');
    return new Response(response.body, { status: response.status, headers });
  }
  const principal = await authenticate(request, env);
  if (isHealth) {
    if (!['GET', 'HEAD'].includes(request.method)) fail(405, 'method_not_allowed', 'Only GET/HEAD may check health.');
    return json({ status: 'ok', version: VERSION });
  }
  if (isAPI) {
    if (!path.startsWith('/Linro/v1/')) fail(404, 'api_not_found', 'Unknown API version.');
    checkCSRF(request, principal, env);
    if (!['GET', 'HEAD'].includes(request.method)) {
      if (!env.WRITE_LIMITER && env.ENVIRONMENT === 'production') fail(503, 'rate_limit_not_configured', 'Write rate limiting is not configured.');
      if (env.WRITE_LIMITER && !(await env.WRITE_LIMITER.limit({ key: `${principal.user.id}:${principal.token_id ?? 'browser'}` })).success) fail(429, 'rate_limited', 'Write rate limit exceeded.');
    }
    return api(request, env, principal, requestId, ctx);
  }
  if (!['GET', 'HEAD'].includes(request.method)) fail(405, 'method_not_allowed', 'Only GET/HEAD may fetch the GUI.');
  if (!env.ASSETS) fail(503, 'assets_missing', 'Static assets are not configured.');
  const response = await env.ASSETS.fetch(request); const headers = new Headers(response.headers);
  // Access/RBAC revocation must apply to a new navigation, including HTML.
  headers.set('Cache-Control', 'no-store');
  return new Response(response.body, { status: response.status, headers });
}
export default {
  async fetch(request: Request, env: Env, ctx?: Context): Promise<Response> {
    const id = crypto.randomUUID(); let response: Response;
    try { response = await handle(request, env, id, ctx); } catch (error) { response = errorResponse(error, id); }
    response = secure(addSourceLink(response, env.SOURCE_URL), id, request);
    return request.method === 'HEAD' ? new Response(null, { status: response.status, headers: response.headers }) : response;
  },
  async scheduled(_event: unknown, env: Env, ctx: Context): Promise<void> {
    ctx.waitUntil(rollup(env).catch(() => { console.error(JSON.stringify({ event: 'analytics_rollup_failed' })); throw new Error('analytics_rollup_failed'); }));
  },
};
