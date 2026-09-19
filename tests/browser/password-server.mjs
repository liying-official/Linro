// Test-only Node HTTP bridge to the real compiled Redirect Worker and SQLite.
// Not workerd, not production HTTPS/Access, and never included in Worker entrypoints.
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const root = resolve(process.argv[2] ?? fileURLToPath(new URL('../..', import.meta.url)));
const { setup, createLink } = await import(pathToFileURL(resolve(root, 'tests/harness.mjs')));
const { default: worker } = await import(pathToFileURL(resolve(root, '.build/apps/redirect/src/index.js')));
const { env, domain } = await setup({
  LINK_PASSWORD_SECRET: 'browser-test-only-pepper-never-deploy-0123456789ABCDE',
  PASSWORD_LIMITER: { limit: async () => ({ success: true }) },
});
const link = await createLink(env, domain, { password: 'browser-fixture-password', max_redirects: 2, target_url: 'https://browser-target.example.org/done' });
env.DB.sqlite.prepare('UPDATE domains SET hostname=? WHERE id=?').run('127.0.0.1', domain.id);
const events = [];
const count = () => env.DB.sqlite.prepare('SELECT redirect_count FROM links WHERE id=?').get(link.id).redirect_count;
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/__test/events') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ events, count: count() })); return; }
    if (req.url === '/__test/revoke' && req.method === 'POST') { env.DB.sqlite.prepare('UPDATE links SET title=? WHERE id=?').run('revoke-browser-fixture', link.id); res.writeHead(204); res.end(); return; }
    let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 9000) throw new Error('bounded fixture'); }
    const request = new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers, ...(body ? { body } : {}) });
    const r = await worker.fetch(request, env);
    events.push({ method: req.method, path: new URL(request.url).pathname, origin: req.headers.origin ?? null, site: req.headers['sec-fetch-site'] ?? null, mode: req.headers['sec-fetch-mode'] ?? null, status: r.status, location: r.headers.get('location'), referrer_policy: r.headers.get('referrer-policy'), count: count() });
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
  } catch { res.writeHead(500); res.end('Fixture failed'); }
});
server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ port: server.address().port })));
process.on('SIGTERM', () => server.close(() => { env.DB.close(); process.exit(0); }));
