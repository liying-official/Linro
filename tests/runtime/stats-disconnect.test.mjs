import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { configs } from '../../scripts/config-lib.mjs';
import { loadRuntimeToolchain } from '../../scripts/runtime-toolchain.mjs';

const publicConfig = configs({
  account_id: 'a'.repeat(32),
  database_id: '11111111-1111-4111-8111-111111111111',
  admin_host: 'admin.example.com',
  redirect_hosts: ['go.example.com'],
  access_issuer: 'https://test.cloudflareaccess.com',
  access_aud: 'a'.repeat(64),
  owner_email: 'owner@example.com',
}).admin;
const listen = (server) =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
async function until(predicate, description) {
  const end = Date.now() + 4500;
  while (Date.now() < end) {
    if (await predicate()) return;
    await delay(15);
  }
  throw Error(description);
}
async function settings() {
  // The two overrides let WSL exercise the very same bundle with a Linux binary.
  // CI uses the project's pinned, locally installed compiler and workerd.
  if (process.env.LINRO_TEST_WORKERD && process.env.LINRO_TEST_STATS_BUNDLE)
    return {
      binary: process.env.LINRO_TEST_WORKERD,
      script: await readFile(process.env.LINRO_TEST_STATS_BUNDLE, 'utf8'),
    };
  const { build } = loadRuntimeToolchain();
  const compiled = await build({
    entryPoints: [fileURLToPath(new URL('./stats-disconnect-worker.ts', import.meta.url))],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    write: false,
  });
  const require = createRequire(import.meta.url);
  const binary = createRequire(require.resolve('wrangler'))('workerd').default;
  return { binary, script: compiled.outputFiles[0].text };
}

test(
  'a real HTTP disconnect aborts the active Analytics pair and prevents the next SQL pair',
  { timeout: 30000 },
  async (t) => {
    const { binary, script } = await settings();
    for (const [label, enabled, disconnect] of [
      ['previous Admin date without the flag', false, true],
      ['configured Admin with a connected client', true, false],
      ['configured Admin after a client disconnect', true, true],
    ])
      await t.test(label, async (t) => {
        const calls = [];
        const events = [];
        const held = [];
        let released = false;
        let closed = 0;
        const origin = http.createServer(async (req, res) => {
          if (req.url.startsWith('/client/v4/accounts/')) {
            const chunks = [];
            for await (const piece of req) chunks.push(piece);
            calls.push(Buffer.concat(chunks).toString('utf8'));
            res.on('close', () => {
              if (!res.writableEnded) closed++;
            });
            if (!released) {
              held.push(res);
              return;
            }
            res.end('{"data":[]}');
          } else {
            events.push(req.url);
            res.end('ok');
          }
        });
        const upstream = await listen(origin);
        const dir = await mkdtemp(join(tmpdir(), 'linro-disconnect-'));
        t.after(async () => {
          origin.closeAllConnections();
          await new Promise((r) => origin.close(r));
          await rm(dir, { recursive: true, force: true });
        });
        const flags = enabled ? publicConfig.compatibility_flags : [];
        await writeFile(join(dir, 'worker.mjs'), script);
        await writeFile(
          join(dir, 'test.capnp'),
          `using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (services = [
  (name="app", worker=(compatibilityDate="${publicConfig.compatibility_date}", compatibilityFlags=${JSON.stringify(flags)}, modules=[(name="worker", esModule=embed "worker.mjs")],globalOutbound="upstream",
    bindings=[(name="ANALYTICS_ENABLED",text="true"),(name="ANALYTICS_DATASET",text="test_clicks"),(name="CLOUDFLARE_ACCOUNT_ID",text="${'a'.repeat(32)}"),(name="ANALYTICS_API_TOKEN",text="local-fixture")])),
  (name="upstream", external=(address="127.0.0.1:${upstream}",http=()))],
  sockets=[(name="http",address="127.0.0.1:0",http=(),service="app")]);`,
        );
        const child = spawn(binary, ['serve', '--control-fd=3', 'test.capnp'], {
          cwd: dir,
          stdio: ['ignore', 'ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });
        let diagnostics = '',
          control = '';
        let failed;
        child.once('error', (error) => {
          failed = error;
        });
        child.stderr.on('data', (chunk) => {
          diagnostics = (diagnostics + chunk).slice(-2000);
        });
        child.stdio[3].on('data', (chunk) => {
          control += chunk;
        });
        const exited = new Promise((resolve) => child.once('close', resolve));
        try {
          await until(() => {
            if (failed) throw failed;
            if (child.exitCode !== null) throw Error(diagnostics);
            return control.includes('\n');
          }, 'workerd did not report its listening port');
          const port = JSON.parse(control.trim().split('\n')[0]).port;
          const client = net.createConnection({ host: '127.0.0.1', port });
          let wireResponse = '';
          client.on('data', (chunk) => {
            wireResponse += chunk;
          });
          client.on('error', () => {});
          try {
            await new Promise((resolve, reject) => {
              client.once('connect', resolve);
              client.once('error', reject);
            });
            client.write('GET /Linro/v1/stats HTTP/1.1\r\nHost: admin.example.com\r\n\r\n');
            await until(() => calls.length === 2, 'The first Analytics query pair did not start.');
            if (disconnect) client.resetAndDestroy();
            if (enabled && disconnect) {
              await until(
                () => events.includes('/signal') && events.includes('/result/408') && closed === 2,
                'Incoming abort did not cancel both in-flight HTTP queries.',
              );
              assert.equal(calls.length, 2);
            } else {
              await delay(200);
              released = true;
              for (const res of held) res.end('{"data":[]}');
              await until(
                () => events.includes('/result/200'),
                'The control did not complete all eight queries.',
              );
              assert.equal(calls.length, 8);
              assert.equal(closed, 0);
              assert.ok(!events.includes('/signal'));
              if (!disconnect)
                await until(
                  () => wireResponse.startsWith('HTTP/1.1 200'),
                  'Connected client did not receive HTTP 200.',
                );
            }
            t.diagnostic(
              JSON.stringify({
                enabled,
                disconnect,
                queries: calls.length,
                abortedUpstreamConnections: closed,
                events,
              }),
            );
          } finally {
            client.destroy();
          }
        } finally {
          child.kill();
          await exited;
        }
      });
  },
);
