import { randomInt } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:net';

/** Some hosts allocate port 0 in a range containing Fetch-blocked service ports.
 * Bind the fixture itself in the dynamic range, without releasing a reserved port. */
export async function listenOnLoopback(server) {
  let lastError;
  for (let attempt = 0; attempt < 32; attempt++) {
    const port = randomInt(49152, 65536);
    const ready = once(server, 'listening');
    server.listen(port, '127.0.0.1');
    try {
      await ready;
      return port;
    } catch (error) {
      if (error.code !== 'EADDRINUSE' && error.code !== 'EACCES') throw error;
      lastError = error;
    }
  }
  throw new Error('Could not bind a browser fixture on a dynamic loopback port.', {
    cause: lastError,
  });
}

async function canBind(port) {
  const check = createServer();
  const ready = once(check, 'listening');
  check.listen(port, '127.0.0.1');
  try {
    await ready;
  } catch (error) {
    if (error.code === 'EADDRINUSE' || error.code === 'EACCES') return false;
    throw error;
  }
  await new Promise((resolve) => check.close(resolve));
  return true;
}
/** Miniflare owns the socket. Retry only a bind collision during the short handoff. */
export async function startLocalRuntime(create) {
  for (let attempt = 0; ; attempt++) {
    const reservation = createServer();
    const port = await listenOnLoopback(reservation);
    await new Promise((resolve) => reservation.close(resolve));
    const runtime = create(port);
    try {
      await runtime.ready;
      return runtime;
    } catch (error) {
      try {
        await runtime.dispose();
      } catch {
        /* Preserve the startup error. */
      }
      if (attempt >= 4 || (await canBind(port))) throw error;
    }
  }
}
