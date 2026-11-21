import type { Locale } from './i18n';

export type Page =
  'dashboard' | 'links' | 'domains' | 'analytics' | 'tokens' | 'users' | 'audit' | 'settings';

const pages: Page[] = [
  'dashboard',
  'links',
  'domains',
  'analytics',
  'tokens',
  'users',
  'audit',
  'settings',
];

export const isPage = (value: string): value is Page => pages.includes(value as Page);

export type JsonRecord = Record<string, unknown>;

export interface GeoRule {
  kind: 'country' | 'continent';
  code: string;
  target_url: string;
}

export interface DomainOption {
  id: string;
  hostname: string;
  enabled: boolean | number;
  default_redirect_code: number;
}

export interface DomainRow extends DomainOption {
  name: string;
  link_count: number;
  version: number;
}

export interface LinkRow {
  id: string;
  domain_id: string;
  hostname: string;
  slug: string;
  short_url: string;
  target_url: string;
  title: string;
  description: string;
  response_mode: 'redirect' | 'text';
  text_content: string;
  redirect_code: number;
  query_mode: string;
  enabled: boolean | number;
  domain_enabled: boolean | number;
  expires_at: number | null;
  cache_ttl: number;
  kv_cache_ttl: number | null;
  geo_rules: GeoRule[];
  password_protected: boolean;
  max_redirects: number | null;
  redirect_count: number;
  block_vpn: boolean | number;
  created_at: number;
  created_by: string | null;
  version: number;
}

export interface UserRow {
  id: string;
  email: string;
  display_name: string;
  role: string;
  enabled: boolean | number;
  created_at: number;
  version: number;
}

export interface TokenRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string;
  expires_at: number;
  revoked_at: number | null;
}

export interface AuditRow {
  id: string;
  created_at: number;
  actor_email: string;
  action: string;
  resource_type: string;
  resource_id: string;
  details: string;
  request_id: string;
}

export interface SettingRow {
  key: string;
  value: unknown;
}

export interface ImportRow extends JsonRecord {
  hostname?: unknown;
  slug?: unknown;
  keyword?: unknown;
  target_url?: unknown;
  url?: unknown;
  title?: unknown;
  description?: unknown;
  response_mode?: unknown;
  text_content?: unknown;
  redirect_code?: unknown;
  query_mode?: unknown;
  enabled?: unknown;
  expires_at?: unknown;
  cache_ttl?: unknown;
  kv_cache_ttl?: unknown;
  geo_rules?: unknown;
  password_protected?: unknown;
  password?: unknown;
  max_redirects?: unknown;
  block_vpn?: unknown;
}

export interface RankingRow {
  hostname?: string;
  slug?: string;
  country?: string;
  timezone?: string;
  device?: string;
  referrer?: string;
  clicks?: number;
}

export interface TimelineRow {
  date?: unknown;
  clicks?: unknown;
}

export type AnalyticsData = JsonRecord & {
  available: boolean;
  reason?: string;
  clicks?: number;
  timeline?: TimelineRow[];
  top?: RankingRow[];
  countries?: RankingRow[];
  referrers?: RankingRow[];
  timezones?: RankingRow[];
  ip_timezones?: RankingRow[];
  devices?: RankingRow[];
};

export interface SessionData {
  scopes: string[];
  link_write_scope: string;
  site_name: string;
  source_url?: string;
  auth_kind: string;
  user: {
    id: string;
    email: string;
    role: string;
  };
  features: {
    passwords_configured?: boolean;
    browser_checks_configured?: boolean;
    redirect_cache?: boolean;
    redirect_cache_default_ttl?: number;
  };
}

export interface SummaryData {
  links?: number;
  active?: number;
  expired?: number;
  domains?: number;
}

export type FormModal =
  | { type: 'link'; row?: LinkRow }
  | { type: 'domain'; row?: DomainRow }
  | { type: 'user'; row?: UserRow }
  | { type: 'token' }
  | { type: 'import' };

export type ModalState = FormModal | { type: 'secret'; token: string };

export interface CursorPage<T> {
  items: T[];
  next_cursor: string | null;
  total?: number;
}

export interface AppState {
  responseMode: 'redirect' | 'text';
  plainTextDraft: string;
  analyticsIds: string[] | null;
  session: SessionData | null;
  loginError: unknown;
  loading: boolean;
  pageLoading: boolean;
  mutationPending: boolean;
  exporting: boolean;
  page: Page;
  error: string;
  notice: string;
  summary: SummaryData;
  domains: DomainOption[];
  directoryLoaded: boolean;
  domainDetails: DomainRow[];
  links: LinkRow[];
  linkCursors: string[];
  nextLinkCursor: string | null;
  q: string;
  searchQuery: string;
  filterDomain: string;
  filterStatus: string;
  selected: string[];
  analytics: AnalyticsData | null;
  days: number;
  users: UserRow[];
  tokens: TokenRow[];
  audit: AuditRow[];
  auditCursors: string[];
  nextAuditCursor: string | null;
  settings: SettingRow[];
  modal: ModalState | null;
  modalError: string;
  importRows: ImportRow[];
  importName: string;
  importDone: number;
  importStatus: 'new' | 'retrying' | 'waiting' | 'resume' | 'review';
  importRetryAt: number;
  locale: Locale;
}
