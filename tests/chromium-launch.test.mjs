import test from 'node:test';
import assert from 'node:assert/strict';
import { debugEndpoint } from './browser/chromium-cdp.mjs';
import { createServer } from 'node:http';
import { listenOnLoopback, startLocalRuntime } from './loopback-port.mjs';

test('a private Chromium profile can advertise its loopback debugger on stderr before DevToolsActivePort is complete', () => {
  const url = 'ws://127.0.0.1:45678/devtools/browser/a12b-12ab';
  const output = 'startup\nDevTools listening on ' + url + '\r\n';
  for (const file of ['', '45678\n', '45678\r\n/devtools/browser/a12b-12ab\r\n'])
    assert.equal(debugEndpoint(file, output), url);
  assert.equal(debugEndpoint('45678\r\n/devtools/browser/a12b-12ab\r\n', ''), url);
  assert.equal(
    debugEndpoint('', 'DevTools listening on ws://other.example:42/devtools/browser/a'),
    undefined,
  );
  assert.equal(debugEndpoint('65536\n/devtools/browser/test', ''), undefined);
  assert.equal(debugEndpoint('9222\n/devtools/page/test', ''), undefined);
});
test('browser fixtures bind a usable dynamic loopback port and recover from a port collision', async (t) => {
  const server = createServer((_, res) => res.end('ready'));
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  const listen = server.listen;
  let attempts = 0;
  t.mock.method(server, 'listen', function (port, host) {
    assert.equal(host, '127.0.0.1');
    assert.ok(port >= 49152 && port <= 65535);
    if (++attempts === 1) {
      queueMicrotask(() =>
        server.emit('error', Object.assign(new Error('fixture collision'), { code: 'EADDRINUSE' })),
      );
      return server;
    }
    return listen.call(server, port, host);
  });
  const port = await listenOnLoopback(server);
  assert.ok(attempts >= 2);
  assert.equal(await (await fetch('http://127.0.0.1:' + port)).text(), 'ready');
});
test('an unrelated native Worker startup error is reported on its first attempt', async () => {
  let attempts = 0;
  let disposed = 0;
  const error = new Error('invalid fixture configuration');
  await assert.rejects(
    startLocalRuntime((port) => {
      attempts++;
      assert.ok(port >= 49152 && port <= 65535);
      return {
        ready: Promise.reject(error),
        dispose: async () => {
          disposed++;
        },
      };
    }),
    (e) => e === error,
  );
  assert.equal(attempts, 1);
  assert.equal(disposed, 1);
});
