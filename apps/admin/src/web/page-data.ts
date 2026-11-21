import { api } from './client';
import { linkPagePath } from './link-list';
import { errorMessage } from './error-message';
import type {
  AnalyticsData,
  AppState,
  AuditRow,
  CursorPage,
  DomainOption,
  DomainRow,
  LinkRow,
  Page,
  SettingRow,
  TokenRow,
  UserRow,
} from './models';

export type ChangedResource = 'links' | 'domains' | 'users' | 'tokens' | 'settings';
const affectedPages: Record<ChangedResource, readonly Page[]> = {
  links: ['links', 'dashboard', 'domains', 'analytics', 'audit'],
  domains: ['domains', 'dashboard', 'links', 'analytics', 'settings', 'audit'],
  users: ['users', 'audit'],
  tokens: ['tokens', 'audit'],
  settings: ['settings', 'audit'],
};

export function needsRefresh(page: Page, resource: ChangedResource) {
  return affectedPages[resource].includes(page);
}

type PageInput = Pick<
  AppState,
  | 'page'
  | 'days'
  | 'auditCursors'
  | 'directoryLoaded'
  | 'analytics'
  | 'analyticsIds'
  | 'locale'
  | 'searchQuery'
  | 'filterDomain'
  | 'filterStatus'
  | 'linkCursors'
  | 'pageLoading'
  | 'settings'
>;
type PageData = Pick<
  AppState,
  | 'domains'
  | 'domainDetails'
  | 'directoryLoaded'
  | 'summary'
  | 'links'
  | 'nextLinkCursor'
  | 'analytics'
  | 'users'
  | 'tokens'
  | 'audit'
  | 'nextAuditCursor'
  | 'settings'
>;

export async function readPage(
  state: PageInput,
  signal: AbortSignal,
  changed?: ChangedResource,
): Promise<Partial<PageData>> {
  const read = <T>(path: string) => {
    signal.throwIfAborted();
    return api<T>(path, 'GET', undefined, signal);
  };
  const update: Partial<PageData> = {};
  const { page, days } = state;
  if (['dashboard', 'links', 'settings'].includes(page) && !state.directoryLoaded) {
    update.domains = await read<DomainOption[]>('/domains?view=directory');
    update.directoryLoaded = true;
  }
  switch (page) {
    case 'dashboard':
      update.summary = await read<AppState['summary']>('/summary');
      update.links = (
        await read<CursorPage<LinkRow>>(linkPagePath(new URLSearchParams({ limit: '5' })))
      ).items;
      if (!changed || !state.analytics) {
        try {
          update.analytics = await read<AnalyticsData>('/stats?days=7&view=dashboard');
        } catch (error) {
          signal.throwIfAborted();
          update.analytics = { available: false, reason: errorMessage(error, state.locale) };
        }
      }
      break;
    case 'links': {
      const params = new URLSearchParams({
        q: state.searchQuery,
        domain_id: state.filterDomain,
        status: state.filterStatus,
        limit: '25',
      });
      const data = await read<CursorPage<LinkRow>>(linkPagePath(params, state.linkCursors.at(-1)));
      update.links = data.items;
      update.nextLinkCursor = data.next_cursor;
      break;
    }
    case 'domains':
      update.domainDetails = await read<DomainRow[]>('/domains');
      update.domains = update.domainDetails;
      update.directoryLoaded = true;
      break;
    case 'analytics': {
      const params = new URLSearchParams({ days: String(days) });
      if (state.analyticsIds !== null) {
        if (!state.analyticsIds.length)
          throw new Error(
            state.locale === 'zh-CN' ? '请选择至少一条短链。' : 'Select at least one link.',
          );
        params.set('link_ids', state.analyticsIds.join(','));
      }
      update.analytics = await read<AnalyticsData>('/stats?' + params);
      break;
    }
    case 'users':
      update.users = await read<UserRow[]>('/users');
      break;
    case 'tokens':
      update.tokens = await read<TokenRow[]>('/tokens');
      break;
    case 'audit': {
      const params = new URLSearchParams({ pagination: 'cursor', limit: '25' });
      const cursor = state.auditCursors.at(-1);
      if (cursor) params.set('cursor', cursor);
      const data = await read<CursorPage<AuditRow>>('/audit?' + params);
      update.audit = data.items;
      update.nextAuditCursor = data.next_cursor;
      break;
    }
    case 'settings':
      if (changed !== 'domains' || state.pageLoading || !state.settings.length)
        update.settings = await read<SettingRow[]>('/settings');
      break;
  }
  return update;
}
