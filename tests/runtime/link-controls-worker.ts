// TEST ENTRY ONLY. No production config, route or import references this file.
import { visitorDimensions } from '../../packages/shared/src/visitor-dimensions.js';
import redirect from '../../apps/redirect/src/index.js';
import admin from '../../apps/admin/src/worker/index.js';
import { hashLinkPassword, verifyLinkPassword } from '../../packages/shared/src/link-password.js';
import type { Env } from '../../packages/shared/src/platform.js';
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Linro F1/F2: invoke the real Admin handler; no auth or data gate is mocked.
    if (new URL(request.url).hostname === 'admin.example.com') return admin.fetch(request, { ...env, AUTH_LIMITER: { limit: async () => ({ success: true }) } });
    if (new URL(request.url).pathname === '/__test__/dimensions') return Response.json(visitorDimensions(request, { ...env, CLOUDFLARE_DEVICE_TYPE_ENABLED: 'true' }));
    if (new URL(request.url).pathname === '/__test__/password') {
      const { password } = await request.json() as { password: string };
      const hash = await hashLinkPassword(password, env);
      return Response.json({ hash, valid: await verifyLinkPassword(password, hash, env), invalid: await verifyLinkPassword('wrong test password', hash, env) });
    }
    // Only the per-location rate bindings are controlled test doubles here.
    // Crypto, Request/Response, D1 SQL, KV and redirect code run inside workerd.
    // Without a Context, the production cache helper awaits its write, making
    // this fixture deterministic without relying on sleeps or network mocks.
    return redirect.fetch(request, { ...env, REDIRECT_LIMITER: { limit: async () => ({ success: true }) }, PASSWORD_LIMITER: { limit: async () => ({ success: true }) } });
  },
};
