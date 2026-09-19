/** Narrow structural bindings used by this project; no Node APIs in either Worker. */
export interface D1Result<T = Record<string, unknown>> {
  results: T[]; success: boolean;
  meta: { changes: number; last_row_id?: number; rows_read?: number; rows_written?: number };
}
export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}
export interface Database {
  prepare(sql: string): D1Statement;
  batch<T = Record<string, unknown>>(statements: D1Statement[]): Promise<D1Result<T>[]>;
}
export interface AnalyticsBinding {
  writeDataPoint(point: { indexes?: string[]; blobs?: string[]; doubles?: number[] }): void;
}
export interface Limiter { limit(options: { key: string }): Promise<{ success: boolean }> }
export interface Context { waitUntil(promise: Promise<unknown>): void }
export interface KVBinding {
  get(key: string, options?: { type?: 'text'; cacheTtl?: number }): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}
export interface Env {
  DB: Database;
  SOURCE_URL?: string;
  ASSETS?: { fetch(request: Request): Promise<Response> };
  ANALYTICS?: AnalyticsBinding;
  WRITE_LIMITER?: Limiter;
  AUTH_LIMITER?: Limiter;
  REDIRECT_LIMITER?: Limiter;
  PASSWORD_LIMITER?: Limiter;
  REDIRECT_CACHE?: KVBinding;
  REDIRECT_CACHE_TTL?: string;
  LINK_PASSWORD_SECRET?: string;
  BROWSER_CHECK_SECRET?: string;
  BROWSER_TIMEZONE_ENABLED?: string;
  QUERY_FORWARD_ALLOWLIST?: string;
  PRIVATE_TARGET_ALLOWLIST?: string;
  EXPIRED_LINK_STATUS?: string;
  ENVIRONMENT: string;
  ADMIN_ORIGIN: string;
  ACCESS_ISSUER: string;
  ACCESS_AUD: string;
  BOOTSTRAP_OWNER_EMAIL: string;
  LOCAL_DEV_TOKEN?: string;
  ANALYTICS_ENABLED?: string;
  CLOUDFLARE_DEVICE_TYPE_ENABLED?: string;
  ANALYTICS_DATASET?: string;
  ANALYTICS_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
}
export interface Domain {
  id: string; hostname: string; name: string; enabled: number;
  default_redirect_code: number; created_at: number; updated_at: number; version: number;
}
export interface Link {
  id: string; domain_id: string; slug: string; target_url: string; title: string;
  description: string; redirect_code: number; query_mode: 'discard' | 'replace' | 'merge';
  enabled: number; expires_at: number | null; cache_ttl: number;
  created_by: string | null; created_at: number; updated_at: number; version: number;
  response_mode: 'redirect' | 'text'; text_content: string; block_vpn: number;
  geo_rules: string; password_hash: string | null;
  max_redirects: number | null; redirect_count: number; rule_revision: number;
  hostname?: string; domain_enabled?: number;
}
export type Role = 'owner' | 'admin' | 'editor' | 'viewer';
export interface User {
  id: string; email: string; display_name: string; role: Role;
  enabled: number; access_sub: string | null; created_at: number; updated_at: number; version: number;
}
export interface Principal { user: User; kind: 'access' | 'token' | 'local'; scopes: string[]; token_id?: string }
export const VERSION = '1.0.1';
