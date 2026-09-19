// TEST ENTRY ONLY: never imported by either production Worker or its config.
// Miniflare intercepts the outbound network below workerd, not the JS fetch API.
import { verifyAccess } from '../../packages/shared/src/access.js';
import { queryAnalytics } from '../../apps/admin/src/worker/analytics.js';
import { errorResponse, json } from '../../packages/shared/src/http.js';
import type { Env } from '../../packages/shared/src/platform.js';
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      if (new URL(request.url).pathname === '/jwks') {
        const body = await request.json() as { token: string };
        const claims = await verifyAccess(body.token, env.ACCESS_ISSUER, env.ACCESS_AUD);
        return json({ sub: claims.sub, email: claims.email });
      }
      if (new URL(request.url).pathname === '/analytics') return json(await queryAnalytics(env, 'SELECT 1 FORMAT JSON'));
      return new Response('Not Found', { status: 404 });
    } catch (error) { return errorResponse(error, 'native-runtime-test'); }
  },
};
