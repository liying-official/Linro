import React from 'react';
import type { AppState } from '../models';
import { UI } from '../i18n-dict';
import { Icon, CursorPagination } from '../components';

interface Props {
  state: Pick<
    AppState,
    | 'q'
    | 'linkCursors'
    | 'nextLinkCursor'
    | 'pageLoading'
    | 'filterDomain'
    | 'filterStatus'
    | 'domains'
    | 'selected'
    | 'locale'
    | 'mutationPending'
    | 'exporting'
  >;
  canWrite: boolean;
  canDelete: boolean;
  onSearch: (q: string) => void;
  onFilter: (
    filter: Partial<Pick<AppState, 'filterDomain' | 'filterStatus' | 'searchQuery'>>,
  ) => void;
  onImport: () => void;
  onExport: () => void;
  onBulk: (action: string) => void;
  onPage: (forward: boolean) => void;
  children: React.ReactNode;
}

export function LinksPage({
  state: s,
  canWrite,
  canDelete,
  onSearch,
  onFilter,
  onImport,
  onExport,
  onBulk,
  onPage,
  children,
}: Props) {
  const ui = UI[s.locale];
  return (
    <section className="panel">
      <div className="filters">
        <form
          className="search-form"
          onSubmit={(event) => {
            event.preventDefault();
            onFilter({ searchQuery: s.q });
          }}
        >
          <span>
            <Icon name="search" size={18} />
          </span>
          <input
            aria-label={ui.links.searchAria}
            placeholder={ui.links.searchPlaceholder}
            maxLength={120}
            value={s.q}
            onChange={(event) => onSearch(event.target.value)}
          />
          <button type="submit">{ui.links.search}</button>
        </form>
        <select
          aria-label={ui.links.allDomains}
          value={s.filterDomain}
          onChange={(event) => onFilter({ filterDomain: event.target.value, searchQuery: s.q })}
        >
          <option value="">{ui.links.allDomains}</option>
          {s.domains.map((domain) => (
            <option key={domain.id} value={domain.id}>
              {domain.hostname}
            </option>
          ))}
        </select>
        <select
          aria-label={ui.links.allStatuses}
          value={s.filterStatus}
          onChange={(event) => onFilter({ filterStatus: event.target.value, searchQuery: s.q })}
        >
          <option value="all">{ui.links.allStatuses}</option>
          <option value="active">{ui.common.active}</option>
          <option value="disabled">{ui.common.disabled}</option>
          <option value="expired">{ui.common.expired}</option>
          <option value="exhausted">{s.locale === 'zh-CN' ? '次数已用尽' : 'Limit reached'}</option>
        </select>
        <div className="filter-actions">
          {canWrite && (
            <button disabled={!s.domains.length || s.mutationPending} onClick={onImport}>
              {ui.common.import}
            </button>
          )}
          <button disabled={s.exporting} onClick={onExport}>
            <Icon name="download" size={16} />
            {ui.common.exportCsv}
          </button>
        </div>
      </div>
      {s.selected.length > 0 && (
        <div className="bulk-bar">
          {ui.links.bulkSelected(s.selected.length)}
          <button disabled={s.mutationPending} onClick={() => onBulk('enable')}>
            {ui.common.enable}
          </button>
          <button disabled={s.mutationPending} onClick={() => onBulk('disable')}>
            {ui.common.disable}
          </button>
          {canDelete && (
            <button
              className="danger-text"
              disabled={s.mutationPending}
              onClick={() => onBulk('delete')}
            >
              {ui.common.delete}
            </button>
          )}
        </div>
      )}
      {children}
      <CursorPagination
        page={s.linkCursors.length + 1}
        hasNext={!!s.nextLinkCursor}
        disabled={s.pageLoading}
        locale={s.locale}
        onChange={onPage}
      />
    </section>
  );
}
