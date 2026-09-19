import React from 'react';
import { api } from './client';
import { Pagination } from './components';
import type { Locale } from './i18n';

export interface StatsLink { id: string; hostname: string; slug: string }
interface Props { locale: Locale; ids: string[] | null; disabled: boolean; onApply: (ids: string[] | null) => void }
export const selectionLabels = {
  'zh-CN': { title: '统计链接范围', all: '全部链接', chosen: '自选链接（单条或多条）', search: '搜索', placeholder: '搜索短码、标题或目标地址', apply: '应用筛选', clear: '清空选择', loading: '正在加载链接…', failed: '链接列表加载失败，请重试。', limit: '最多选择 50 条；跨页选择保留。', activeAll: '当前查看：全部链接', active: '当前查看的链接数', pending: '待应用的选择数', remove: '移除', empty: '没有匹配的链接。' },
  en: { title: 'Analytics link scope', all: 'All links', chosen: 'Choose links (single or multiple)', search: 'Search', placeholder: 'Search slug, title or target URL', apply: 'Apply filters', clear: 'Clear selection', loading: 'Loading links…', failed: 'Could not load links. Please retry.', limit: 'Select up to 50 links. Selections persist across pages.', activeAll: 'Viewing: all links', active: 'Links currently viewed', pending: 'Pending selection', remove: 'Remove', empty: 'No matching links.' },
} as const;

export function AnalyticsSelection({ locale, ids, disabled, onApply }: Props) {
  const t = selectionLabels[locale];
  const [mode, setMode] = React.useState<'all' | 'chosen'>(ids ? 'chosen' : 'all');
  const [selected, setSelected] = React.useState<string[]>(ids ?? []);
  const [known, setKnown] = React.useState<Record<string, StatsLink>>({});
  const [draft, setDraft] = React.useState('');
  const [query, setQuery] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [rows, setRows] = React.useState<StatsLink[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [retry, setRetry] = React.useState(0);
  React.useEffect(() => { setMode(ids ? 'chosen' : 'all'); setSelected(ids ?? []); }, [ids]);
  React.useEffect(() => {
    if (mode !== 'chosen') return;
    let stale = false;
    setLoading(true); setFailed(false);
    const params = new URLSearchParams({ q: query, page: String(page), limit: '25' });
    void api('/links?' + params).then(data => {
      if (stale) return;
      setRows(data.items); setTotal(data.total);
      setKnown(current => ({ ...current, ...Object.fromEntries(data.items.map((row: StatsLink) => [row.id, row])) }));
    }).catch(() => { if (!stale) setFailed(true); }).finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [query, page, mode, retry]);
  const toggle = (id: string, checked: boolean) => setSelected(current => checked ? current.includes(id) || current.length >= 50 ? current : [...current, id] : current.filter(value => value !== id));
  return <section className="panel analytics-selection" aria-label={t.title}>
    <h2>{t.title}</h2>
    <p role="status">{ids === null ? t.activeAll : `${t.active}: ${ids.length}`}</p>
    <div className="button-row">
      <label><input type="radio" name="stats-scope" checked={mode === 'all'} onChange={() => setMode('all')}/>{t.all}</label>
      <label><input type="radio" name="stats-scope" checked={mode === 'chosen'} onChange={() => setMode('chosen')}/>{t.chosen}</label>
    </div>
    {mode === 'chosen' && <>
      <form className="search-form" onSubmit={event => { event.preventDefault(); setQuery(draft); setPage(1); setRetry(n => n + 1); }}>
        <input aria-label={t.placeholder} placeholder={t.placeholder} value={draft} maxLength={120} onChange={event => setDraft(event.target.value)}/>
        <button type="submit" disabled={loading}>{t.search}</button>
      </form>
      <p>{t.limit} {t.pending}: {selected.length}</p>
      <div className="selected-links">{selected.map(id => <button key={id} type="button" aria-label={`${t.remove} ${known[id] ? known[id].hostname + '/' + known[id].slug : id}`} onClick={() => toggle(id, false)}>{known[id] ? `${known[id].hostname}/${known[id].slug}` : id} ×</button>)}</div>
      {loading ? <p role="status">{t.loading}</p> : failed ? <p role="alert">{t.failed}</p> : <div className="link-picker">
        {!rows.length && <p>{t.empty}</p>}
        {rows.map(row => <label key={row.id}><input type="checkbox" checked={selected.includes(row.id)} disabled={!selected.includes(row.id) && selected.length >= 50} onChange={event => toggle(row.id, event.target.checked)}/><span>{row.hostname}/{row.slug}</span></label>)}
      </div>}
      <Pagination page={page} total={total} limit={25} locale={locale} onChange={setPage}/>
    </>}
    <div className="button-row">
      <button type="button" className="primary" disabled={disabled || (mode === 'chosen' && !selected.length)} onClick={() => onApply(mode === 'all' ? null : [...selected])}>{t.apply}</button>
      {mode === 'chosen' && <button type="button" onClick={() => setSelected([])}>{t.clear}</button>}
    </div>
  </section>;
}
