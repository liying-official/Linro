import React from 'react';
import { api } from './client';
import { CursorPagination } from './components';
import { errorMessage } from './error-message';
import type { CursorPage } from './models';
import { linkPagePath, pickerRows, selectedRows, toggleRow, type StatsLink } from './link-list';
import type { Locale } from './i18n';

interface Props {
  locale: Locale;
  ids: string[] | null;
  disabled: boolean;
  onApply: (ids: string[] | null) => void;
}
export const selectionLabels = {
  'zh-CN': {
    title: '统计链接范围',
    all: '全部链接',
    chosen: '自选链接（单条或多条）',
    search: '搜索',
    placeholder: '搜索短码、标题或目标地址',
    apply: '应用筛选',
    clear: '清空选择',
    loading: '正在加载链接…',
    failed: '链接列表加载失败，请重试。',
    limit: '最多选择 50 条；跨页选择保留。',
    activeAll: '当前查看：全部链接',
    active: '当前查看的链接数',
    pending: '待应用的选择数',
    remove: '移除',
    empty: '没有匹配的链接。',
  },
  en: {
    title: 'Analytics link scope',
    all: 'All links',
    chosen: 'Choose links (single or multiple)',
    search: 'Search',
    placeholder: 'Search slug, title or target URL',
    apply: 'Apply filters',
    clear: 'Clear selection',
    loading: 'Loading links…',
    failed: 'Could not load links. Please retry.',
    limit: 'Select up to 50 links. Selections persist across pages.',
    activeAll: 'Viewing: all links',
    active: 'Links currently viewed',
    pending: 'Pending selection',
    remove: 'Remove',
    empty: 'No matching links.',
  },
} as const;

export function AnalyticsSelection({ locale, ids, disabled, onApply }: Props) {
  const t = selectionLabels[locale];
  const [mode, setMode] = React.useState<'all' | 'chosen'>(ids ? 'chosen' : 'all');
  const [selected, setSelected] = React.useState<StatsLink[]>(() =>
    selectedRows(ids ?? [], [], []),
  );
  const [draft, setDraft] = React.useState('');
  const [query, setQuery] = React.useState('');
  const [cursors, setCursors] = React.useState<string[]>([]);
  const cursor = cursors.at(-1);
  const [rows, setRows] = React.useState<StatsLink[]>([]);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [failure, setFailure] = React.useState<unknown>(null);
  const [retry, setRetry] = React.useState(0);
  React.useEffect(() => {
    setMode(ids ? 'chosen' : 'all');
    setSelected((current) => selectedRows(ids ?? [], current, []));
  }, [ids]);
  React.useEffect(() => {
    if (mode !== 'chosen') return;
    const request = new AbortController();
    setLoading(true);
    setFailure(null);
    setRows([]);
    setNextCursor(null);
    const params = new URLSearchParams({ q: query, limit: '25', view: 'picker' });
    void api<CursorPage<StatsLink>>(linkPagePath(params, cursor), 'GET', undefined, request.signal)
      .then((data) => {
        if (request.signal.aborted) return;
        const page = pickerRows(data.items);
        setRows(page);
        setNextCursor(data.next_cursor);
        setSelected((current) =>
          selectedRows(
            current.map((row) => row.id),
            current,
            page,
          ),
        );
      })
      .catch((error: unknown) => {
        if (!request.signal.aborted) setFailure(error);
      })
      .finally(() => {
        if (!request.signal.aborted) setLoading(false);
      });
    return () => request.abort();
  }, [query, cursor, mode, retry]);
  return (
    <section className="panel analytics-selection" aria-label={t.title}>
      <h2>{t.title}</h2>
      <p role="status">{ids === null ? t.activeAll : `${t.active}: ${ids.length}`}</p>
      <div className="button-row">
        <label>
          <input
            type="radio"
            name="stats-scope"
            checked={mode === 'all'}
            onChange={() => setMode('all')}
          />
          {t.all}
        </label>
        <label>
          <input
            type="radio"
            name="stats-scope"
            checked={mode === 'chosen'}
            onChange={() => setMode('chosen')}
          />
          {t.chosen}
        </label>
      </div>
      {mode === 'chosen' && (
        <>
          <form
            className="search-form"
            onSubmit={(event) => {
              event.preventDefault();
              setQuery(draft);
              setCursors([]);
              setRetry((n) => n + 1);
            }}
          >
            <input
              aria-label={t.placeholder}
              placeholder={t.placeholder}
              value={draft}
              maxLength={120}
              onChange={(event) => setDraft(event.target.value)}
            />
            <button type="submit" disabled={loading}>
              {t.search}
            </button>
          </form>
          <p>
            {t.limit} {t.pending}: {selected.length}
          </p>
          <div className="selected-links">
            {selected.map((row) => (
              <button
                key={row.id}
                type="button"
                aria-label={`${t.remove} ${row.hostname ? row.hostname + '/' + row.slug : row.id}`}
                onClick={() => setSelected((current) => toggleRow(current, row, false))}
              >
                {row.hostname ? `${row.hostname}/${row.slug}` : row.id} ×
              </button>
            ))}
          </div>
          {loading ? (
            <p role="status">{t.loading}</p>
          ) : failure ? (
            <p role="alert">
              {t.failed} {errorMessage(failure, locale)}
            </p>
          ) : (
            <div className="link-picker">
              {!rows.length && <p>{t.empty}</p>}
              {rows.map((row) => (
                <label key={row.id}>
                  <input
                    type="checkbox"
                    checked={selected.some((item) => item.id === row.id)}
                    disabled={!selected.some((item) => item.id === row.id) && selected.length >= 50}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setSelected((current) => toggleRow(current, row, checked));
                    }}
                  />
                  <span>
                    {row.hostname}/{row.slug}
                  </span>
                </label>
              ))}
            </div>
          )}
          <CursorPagination
            page={cursors.length + 1}
            hasNext={!!nextCursor}
            disabled={loading}
            locale={locale}
            onChange={(forward) =>
              setCursors((current) =>
                forward && nextCursor ? [...current, nextCursor] : current.slice(0, -1),
              )
            }
          />
        </>
      )}
      <div className="button-row">
        <button
          type="button"
          className="primary"
          disabled={disabled || (mode === 'chosen' && !selected.length)}
          onClick={() => onApply(mode === 'all' ? null : selected.map((row) => row.id))}
        >
          {t.apply}
        </button>
        {mode === 'chosen' && (
          <button type="button" onClick={() => setSelected([])}>
            {t.clear}
          </button>
        )}
      </div>
    </section>
  );
}
