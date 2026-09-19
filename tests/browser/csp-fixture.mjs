/** Local HTTP fixture: actual compiled Worker and real SQLite; platform cf/rate
 * bindings are controlled inputs, NOT real Cloudflare geolocation or workerd. */
import http from 'node:http';
import { setup, createLink, call, redirect } from '../harness.mjs';
import { BROWSER_JS } from '../../.build/apps/redirect/src/browser-page.js';
import { randomBytes } from 'node:crypto';

const listen = server => new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address().port)); });
const close = server => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
export const TEST_PASSWORD = 'fixture-password-not-for-production';
export async function cspFixture({ legacyScript = false, block = true, password = false, code = 302, text = false, tor = false, global = false } = {}) {
  const visits = [], targetVisits = [], events = [];
  const target = http.createServer((req, res) => {
    if (!/^localhost:\d+$/.test(req.headers.host ?? '')) { res.writeHead(421).end(); return; }
    targetVisits.push({ path: req.url, method: req.method });
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); res.end('CF-LINKS TEST TARGET');
  });
  let env, bridge;
  try {
    const targetPort = await listen(target); const targetOrigin = 'http://localhost:' + targetPort;
    ({ env } = await setup({ BROWSER_TIMEZONE_ENABLED: String(global), BROWSER_CHECK_SECRET: randomBytes(32).toString('base64url'),
      LINK_PASSWORD_SECRET: randomBytes(32).toString('base64url'), PRIVATE_TARGET_ALLOWLIST: '["localhost"]',
      PASSWORD_LIMITER: { limit: async () => ({ success: true }) }, ANALYTICS_ENABLED: 'true', ANALYTICS: { writeDataPoint: event => events.push(event) } }));
    const domain = (await call(env, '/domains', 'POST', { hostname: '127.0.0.1' })).data;
    const link = await createLink(env, domain, { slug: 'csp-check', target_url: targetOrigin + '/done', redirect_code: code,
      block_vpn: block, max_redirects: 10, ...(password ? { password: TEST_PASSWORD } : {}),
      ...(text ? { response_mode: 'text', target_url: '', text_content: '<script>not executed</script>\nCF-LINKS TEXT RESULT' } : {}) });
    let shortOrigin;
    bridge = http.createServer(async (req, res) => {
      try {
        if (req.headers.host !== new URL(shortOrigin).host) { res.writeHead(421).end(); return; }
        const chunks = []; let length = 0;
        for await (const chunk of req) { length += chunk.length; if (length > 8192) { res.writeHead(413).end(); return; } chunks.push(chunk); }
        const headers = new Headers();
        for (const [name, value] of Object.entries(req.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(',') : value);
        headers.set('cf-connecting-ip', '203.0.113.31');
        const request = new Request(shortOrigin + req.url, { method: req.method, headers,
          ...(!['GET', 'HEAD'].includes(req.method) ? { body: Buffer.concat(chunks) } : {}) });
        Object.defineProperty(request, 'cf', { value: { country: tor ? 'T1' : 'JP', timezone: 'Asia/Tokyo', continent: 'AS' } });
        let response = await redirect.fetch(request, env);
        if (legacyScript && new URL(request.url).pathname === '/__Linro_assets/browser.js') {
          // Negative control reproduces the original navigation mechanism while
          // keeping the same production CSP and all server-side verification.
          const old = "const f=document.getElementById('browser-check');f.elements.namedItem('timezone').value=Intl.DateTimeFormat().resolvedOptions().timeZone;f.requestSubmit();";
          response = new Response(old, { status: 200, headers: response.headers });
        }
        visits.push({ method: req.method, path: req.url, status: response.status, accept: req.headers.accept ?? null,
          origin: req.headers.origin ?? null, site: req.headers['sec-fetch-site'] ?? null,
          csp: response.headers.get('content-security-policy') }); // no password, challenge or cookie values
        res.statusCode = response.status;
        for (const [name, value] of response.headers) if (name !== 'set-cookie') res.setHeader(name, value);
        const cookies = response.headers.getSetCookie(); if (cookies.length) res.setHeader('set-cookie', cookies);
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch { res.writeHead(500).end('Test fixture error'); }
    });
    const port = await listen(bridge); shortOrigin = 'http://127.0.0.1:' + port;
    return { shortOrigin, targetOrigin, link, visits, targetVisits, events, actualBrowserJS: BROWSER_JS,
      count: () => env.DB.sqlite.prepare('SELECT redirect_count FROM links WHERE id=?').get(link.id).redirect_count,
      async close() { await close(bridge); await close(target); env.DB.close(); } };
  } catch (error) { if (bridge) await close(bridge); await close(target); if (env) env.DB.close(); throw error; }
}
