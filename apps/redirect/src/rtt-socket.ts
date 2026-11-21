import { validateBrowserChallenge } from '../../../packages/shared/src/browser-check.js';
import { base64UrlEncode } from '../../../packages/shared/src/encoding.js';
import { MAX_BROWSER_TOKEN_CHARS } from '../../../packages/shared/src/limits.js';
import type { RedirectEnv } from '../../../packages/shared/src/platform.js';
import {
  RTT_GAP_MS,
  RTT_PROTOCOL,
  RTT_ROUNDS,
  RTT_TIMEOUT_MS,
  createLatencyReceipt,
  edgeRtt,
} from '../../../packages/shared/src/vpn-latency.js';
import { isSameOriginUnlock } from './unlock-origin.js';

const RTT_TOLERANCE_MS = 55;

interface WorkerSocket extends WebSocket {
  accept(): void;
}
declare const WebSocketPair: new () => { 0: WorkerSocket; 1: WorkerSocket };

// Each accepted upgrade owns its challenges, timing and timers. Nothing is shared
// between sockets or written to D1/KV. "ready" keeps the handshake out of round one.
export function measureSocket(
  socket: WebSocket,
  reference: number | null,
  secret: string,
  challenge: string,
  expiresAt: number,
): void {
  const deadline = Math.min(Date.now() + RTT_TIMEOUT_MS, expiresAt);
  let ready = false;
  let closed = false;
  let expected: string | null = null;
  let sentAt = 0;
  let rounds = 0;
  let matched = false;
  let next: ReturnType<typeof setTimeout> | undefined;
  const timeout = setTimeout(() => close(1008), Math.max(0, deadline - Date.now()));

  function close(code: number) {
    if (closed) return;
    closed = true;
    clearTimeout(next);
    clearTimeout(timeout);
    expected = null;
    try {
      socket.close(code);
    } catch {
      /* Peer already disconnected. */
    }
  }
  function sendRound() {
    if (closed || Date.now() >= deadline) return close(1008);
    expected = base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)));
    sentAt = performance.now();
    try {
      socket.send(expected);
    } catch {
      close(1011);
    }
  }
  socket.addEventListener('close', () => close(1000));
  socket.addEventListener('error', () => close(1011));
  socket.addEventListener('message', async ({ data }) => {
    const receivedAt = performance.now();
    if (closed || Date.now() >= deadline) return close(1008);
    if (!ready) {
      if (data !== 'ready') return close(1008);
      ready = true;
      return sendRound();
    }
    if (expected === null || data !== expected) return close(1008);
    expected = null;
    const elapsed = receivedAt - sentAt;
    if (!Number.isFinite(elapsed) || elapsed < 0) return close(1011);
    if (reference !== null && Math.abs(elapsed - reference) < RTT_TOLERANCE_MS) matched = true;
    if (++rounds < RTT_ROUNDS) {
      next = setTimeout(sendRound, RTT_GAP_MS);
      return;
    }
    try {
      const result =
        reference === null ? 'latency_unavailable' : matched ? 'match' : 'latency_mismatch';
      const receipt = await createLatencyReceipt(secret, challenge, result);
      if (closed || Date.now() >= deadline) return close(1008);
      socket.send('receipt.' + receipt);
      close(1000);
    } catch {
      close(1011);
    }
  });
}

export async function latencyUpgrade(request: Request, env: RedirectEnv): Promise<Response> {
  const headers = { 'Cache-Control': 'no-store' };
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket')
    return new Response('WebSocket upgrade required.', {
      status: 426,
      headers: { ...headers, Upgrade: 'websocket' },
    });
  const url = new URL(request.url);
  const deny = () => new Response('Forbidden', { status: 403, headers });
  if (
    (url.protocol !== 'https:' && env.ENVIRONMENT !== 'development') ||
    request.headers.get('origin') !== url.origin ||
    !isSameOriginUnlock(request)
  )
    return deny();
  const protocols = request.headers.get('sec-websocket-protocol') ?? '';
  if (protocols.length > RTT_PROTOCOL.length + MAX_BROWSER_TOKEN_CHARS + 2) return deny();
  const [protocol, challenge, extra] = protocols.split(',').map((s) => s.trim());
  if (protocol !== RTT_PROTOCOL || !challenge || extra !== undefined) return deny();
  const claims = await validateBrowserChallenge(challenge, request, undefined, env);
  if (!claims) return deny();

  const { 0: client, 1: server } = new WebSocketPair();
  server.accept();
  measureSocket(server, edgeRtt(request), env.BROWSER_CHECK_SECRET!, challenge, claims.exp * 1000);
  const init = {
    status: 101,
    webSocket: client,
    headers: { ...headers, 'Sec-WebSocket-Protocol': RTT_PROTOCOL },
  };
  return new Response(null, init);
}
