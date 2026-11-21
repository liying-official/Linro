// Local socket fixture. The production router and stats handler run normally.
// The launcher directs every outbound request, including observations, to loopback.
import { api } from '../../apps/admin/src/worker/api.js';
import { errorResponse } from '../../packages/shared/src/http.js';
import type { AdminEnv, Context, Principal } from '../../packages/shared/src/platform.js';

const principal: Principal = {
  kind: 'access',
  scopes: ['analytics:read'],
  user: {
    id: 'test',
    email: 'reader@example.com',
    display_name: 'Reader',
    role: 'viewer',
    enabled: 1,
    access_sub: null,
    version: 1,
    created_at: 1,
    updated_at: 1,
  },
};
const observe = (event: string) =>
  fetch('http://observer.local/' + event, { method: 'POST' }).then((r) => r.text());
export default {
  fetch(request: Request, env: AdminEnv, ctx: Context) {
    if (new URL(request.url).pathname === '/ready') return new Response('ready');
    request.signal.addEventListener('abort', () => ctx.waitUntil(observe('signal')), {
      once: true,
    });
    const response = api(request, env, principal, 'disconnect-test', ctx).catch((e) =>
      errorResponse(e, 'disconnect-test'),
    );
    // Keep the negative control observable even after its socket has gone away.
    ctx.waitUntil(response.then((r) => observe('result/' + r.status)));
    return response;
  },
};
