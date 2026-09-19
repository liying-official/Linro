export class APIError extends Error {
  constructor(message: string, public status: number, public code: string, public requestId?: string) { super(message); }
}
export async function api<T = any>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', 'X-Linro-CSRF': '1' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
    const dev = sessionStorage.getItem('cf-links-dev-token'); if (dev) headers['X-Linro-Dev'] = dev;
  }
  const response = await fetch(`/Linro/v1${path}`, { method, headers, credentials: 'same-origin', redirect: 'manual', body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  if (response.type === 'opaqueredirect' || !response.headers.get('Content-Type')?.includes('application/json')) throw new APIError('登录状态失效，请重新打开管理页面完成 Cloudflare Access 登录。', 401, 'access_required');
  const result = await response.json();
  if (!response.ok || !result.ok) throw new APIError(result.error?.message ?? '请求失败', response.status, result.error?.code ?? 'request_failed', result.error?.request_id);
  return result.data as T;
}
export function download(name: string, content: string, type: string): void {
  const blob = new Blob([content], { type }); const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a'); anchor.href = href; anchor.download = name;
  document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(href), 5000);
}
