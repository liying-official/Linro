import { OBJECT_URL_REVOKE_DELAY_MS } from '../../../../packages/shared/src/limits';
import { isLocalHost, readLocalToken } from './admin-session';

export class APIError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
    public requestId?: string,
    public retryAfterMs?: number,
  ) {
    super(message);
  }
}
function retryDelay(value: string | null): number | undefined {
  if (value === null) return undefined;
  const delay = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(delay) ? Math.max(0, delay) : undefined;
}

export async function api<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', 'X-Linro-CSRF': '1' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (isLocalHost(location.hostname)) {
    const dev = readLocalToken();
    if (dev) headers['X-Linro-Dev'] = dev;
  }
  const timeout = AbortSignal.timeout(20000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const response = await fetch(`/Linro/v1${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      redirect: 'manual',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: requestSignal,
    });
    if (
      response.type === 'opaqueredirect' ||
      !response.headers.get('Content-Type')?.includes('application/json')
    )
      throw new APIError('Cloudflare Access sign-in required.', 401, 'access_required');
    const result = await response.json();
    if (!response.ok || !result.ok)
      throw new APIError(
        result.error?.message ?? 'Request failed.',
        response.status,
        result.error?.code ?? 'request_failed',
        result.error?.request_id,
        retryDelay(response.headers.get('Retry-After')),
      );
    return result.data as T;
  } catch (error) {
    if (signal?.aborted || error instanceof APIError) throw error;
    if (timeout.aborted) throw new APIError('Request timed out.', 0, 'request_timeout');
    if (error instanceof SyntaxError)
      throw new APIError('Invalid server response.', 0, 'invalid_response');
    throw new APIError('Network connection failed.', 0, 'network_error');
  }
}
export function download(name: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(href), OBJECT_URL_REVOKE_DELAY_MS);
}
