// SPDX-License-Identifier: AGPL-3.0-only
// Linro modifications: 2026-09-18; inherited attribution is in NOTICE.
import { readBoundedBody } from './body.js';
import { MAX_JSON_BODY_BYTES } from './limits.js';
import { fail, HttpError } from './errors.js';
export { fail, HttpError } from './errors.js';
export function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extra,
    },
  });
}
export function secure(
  response: Response,
  requestId: string,
  request?: Request,
  socketPath?: string,
): Response {
  const headers = new Headers(response.headers);
  const url = request && new URL(request.url);
  // Send HSTS only on HTTPS responses.
  if (url?.protocol === 'https:') {
    headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  } else {
    headers.delete('Strict-Transport-Security');
  }
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('X-Request-Id', requestId);
  const socketSource =
    url &&
    socketPath &&
    response.headers.get('content-type')?.startsWith('text/html') &&
    /^(?:[a-z0-9.-]+|\[[0-9a-f:]+\])(?::\d+)?$/i.test(url.host)
      ? ' ' + (url.protocol === 'https:' ? 'wss://' : 'ws://') + url.host + socketPath
      : '';
  headers.set(
    'Content-Security-Policy',
    `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'${socketSource}; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
  );
  return withHeaders(response, headers);
}
export function withHeaders(response: Response, headers: Headers): Response {
  // workerd needs the accepted socket on every new 101 response wrapper.
  const init = {
    status: response.status,
    statusText: response.statusText,
    headers,
    webSocket: (response as Response & { webSocket?: WebSocket }).webSocket,
  };
  return new Response(response.body, init);
}
export function errorResponse(error: unknown, requestId: string): Response {
  let e: HttpError;
  if (error instanceof HttpError) e = error;
  else {
    const message = error instanceof Error ? error.message : '';
    if (/UNIQUE constraint failed|constraint failed.*UNIQUE/i.test(message))
      e = new HttpError(409, 'conflict', 'The hostname, slug, or email already exists.');
    else if (/managed_link_destination/.test(message))
      e = new HttpError(
        400,
        'redirect_chain',
        'Managed short-link domains cannot be redirect destinations. Use the final destination.',
      );
    else if (/last_enabled_owner/.test(message))
      e = new HttpError(409, 'last_owner', 'At least one enabled owner must remain.');
    else if (/FOREIGN KEY constraint failed/.test(message))
      e = new HttpError(409, 'in_use', 'The resource is still referenced or no longer exists.');
    else {
      console.error(JSON.stringify({ event: 'request_failed', request_id: requestId }));
      e = new HttpError(
        500,
        'internal_error',
        'Request failed. Contact the administrator with the request ID.',
      );
    }
  }
  return new Response(
    JSON.stringify({
      ok: false,
      error: { code: e.code, message: e.message, request_id: requestId },
    }),
    {
      status: e.status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        ...(e.status === 429 ? { 'Retry-After': '60' } : {}),
      },
    },
  );
}
/** Enforces a byte bound even when Content-Length is absent or forged. */
export async function readJSON(
  request: Request,
  maxBytes = MAX_JSON_BODY_BYTES,
): Promise<Record<string, unknown>> {
  const type = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (type !== 'application/json') fail(415, 'content_type', 'Use application/json.');
  const bytes = await readBoundedBody(request, {
    maxBytes,
    emptyCode: 'empty_body',
    emptyMessage: 'A JSON object is required.',
  });
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value))
      fail(400, 'invalid_json', 'A JSON object is required.');
    return value as Record<string, unknown>;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    return fail(400, 'invalid_json', 'Invalid JSON.');
  }
}
export function rejectUnknown(body: Record<string, unknown>, allowed: string[]): void {
  for (const key of Object.keys(body))
    if (!allowed.includes(key)) fail(400, 'unknown_field', `Unknown field: ${key}`);
}
/** Free text may contain TAB/CR/LF for multiline notes and CSV round trips.
 * Keep it in JSON/React/quoted CSV sinks only; never reuse this validator for
 * HTTP headers, email subjects or unescaped logs. targetURL rejects controls. */
export function text(value: unknown, name: string, max: number, fallback?: string): string {
  if (value === undefined && fallback !== undefined) return fallback;
  if (
    typeof value !== 'string' ||
    value.length > max ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)
  )
    fail(400, 'invalid_field', `Invalid ${name}.`);
  return value;
}
export function integer(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
    fail(400, 'invalid_field', `Invalid ${name}.`);
  return value;
}
export function booleanInt(value: unknown, fallback = 1): number {
  if (value === undefined) return fallback;
  if (value === true || value === 1) return 1;
  if (value === false || value === 0) return 0;
  return fail(400, 'invalid_field', 'enabled must be a boolean or 0/1.');
}
export function pageParams(url: URL): { page: number; limit: number; offset: number } {
  const page = integer(Number(url.searchParams.get('page') ?? 1), 'page', 1, 100000);
  const limit = integer(Number(url.searchParams.get('limit') ?? 25), 'limit', 1, 100);
  return { page, limit, offset: (page - 1) * limit };
}
export const nowSeconds = (): number => Math.floor(Date.now() / 1000);
