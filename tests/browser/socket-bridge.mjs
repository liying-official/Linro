import { createRequire } from 'node:module';
import { redirect } from '../harness.mjs';

// Use Wrangler's pinned Miniflare WebSocketPair/101 Response in the Node HTTP fixture.
const require = createRequire(import.meta.url);
const wrangler = createRequire(require.resolve('wrangler/package.json'));
const miniflare = createRequire(wrangler.resolve('miniflare/package.json'));
const { Response: WorkerResponse, WebSocketPair } = wrangler('miniflare');
const { WebSocketServer } = miniflare('ws');

export function installSocketRuntime() {
  const response = globalThis.Response;
  const pair = Object.getOwnPropertyDescriptor(globalThis, 'WebSocketPair');
  globalThis.Response = WorkerResponse;
  globalThis.WebSocketPair = WebSocketPair;
  return () => {
    globalThis.Response = response;
    if (pair) Object.defineProperty(globalThis, 'WebSocketPair', pair);
    else delete globalThis.WebSocketPair;
  };
}

export function attachSocketBridge(server, origin, env, cf, visits, delay) {
  const restore = installSocketRuntime();
  const upgrades = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  server.on('upgrade', async (req, stream, head) => {
    stream.on('error', () => stream.destroy());
    try {
      const url = new URL(req.url, origin);
      if (url.origin !== origin || req.headers.host !== url.host || url.pathname !== '/__Linro_rtt')
        return stream.destroy();
      const headers = new Headers(req.headers);
      headers.set('cf-connecting-ip', '203.0.113.31');
      const request = new Request(url, { headers });
      Object.defineProperty(request, 'cf', { value: cf });
      const response = await redirect.fetch(request, env);
      const visit = { method: 'GET', path: req.url, status: response.status, echoes: 0 };
      visits.push(visit);
      if (response.status !== 101) {
        stream.end('HTTP/1.1 ' + response.status + ' Rejected\r\nConnection: close\r\n\r\n');
        return;
      }
      upgrades.handleUpgrade(req, stream, head, (peer) => {
        const worker = response.webSocket;
        worker.accept();
        let timer;
        peer.on('message', (bytes, binary) => {
          const data = binary ? bytes : bytes.toString();
          if (data === 'ready') worker.send(data);
          else {
            visit.echoes++;
            if (delay) timer = setTimeout(() => worker.send(data), delay);
            else worker.send(data);
          }
        });
        worker.addEventListener('message', ({ data }) => peer.send(data));
        worker.addEventListener('close', () => peer.close());
        peer.on('error', () => peer.terminate());
        peer.on('close', () => {
          clearTimeout(timer);
          worker.close();
        });
      });
    } catch {
      stream.destroy();
    }
  });
  return () => {
    for (const peer of upgrades.clients) peer.terminate();
    upgrades.close();
    restore();
  };
}
