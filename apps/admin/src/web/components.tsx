import React from 'react';
import type { Locale } from './i18n';

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    link: <><path d="M10 13a5 5 0 0 0 7 .5l3-3a5 5 0 0 0-7-7l-2 2" /><path d="M14 11a5 5 0 0 0-7-.5l-3 3a5 5 0 0 0 7 7l2-2" /></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
    globe: <><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/></>,
    chart: <><path d="M4 3v17h17M8 15v-4m5 4V6m5 9V9"/></>,
    key: <><circle cx="8" cy="8" r="5"/><path d="m12 12 9 9m-3-3 3-3m-6 0 3-3"/></>,
    users: <><circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6m3 11v-3a5 5 0 0 0-2-4"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="m9 3 6 0 1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z"/></>,
    audit: <><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6m-6 5h6m-6 5h4"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5"/>,
    copy: <><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/></>,
    search: <><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    refresh: <><path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5"/></>,
    out: <><path d="M13 3h8v8m0-8L10 14M8 5H3v16h16v-5"/></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></>,
    close: <path d="m6 6 12 12M6 18 18 6"/>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.link}</svg>;
}

export function Empty({ title, detail, action }: { title: string; detail: string; action?: React.ReactNode }) {
  return <div className="empty"><span className="empty-icon"><Icon name="link" size={28}/></span><h3>{title}</h3><p>{detail}</p>{action}</div>;
}

export function Field({ label, hint, children, wide = false }: { label: string; hint?: string; children: React.ReactNode; wide?: boolean }) {
  return <label className={'field' + (wide ? ' wide' : '')}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export function Pagination({ page, total, limit, onChange, locale }: { page: number; total: number; limit: number; onChange: (n: number) => void; locale: Locale }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  const summary = locale === 'zh-CN'
    ? `共 ${total.toLocaleString(locale)} 条 · 第 ${page} / ${pages} 页`
    : `${total.toLocaleString(locale)} items · page ${page} / ${pages}`;
  return <div className="pagination"><span>{summary}</span><div><button disabled={page <= 1} onClick={() => onChange(page - 1)}>{locale === 'zh-CN' ? '上一页' : 'Previous'}</button><button disabled={page >= pages} onClick={() => onChange(page + 1)}>{locale === 'zh-CN' ? '下一页' : 'Next'}</button></div></div>;
}

const LazyTrafficChart = React.lazy(() => import('./TrafficChart').then(module => ({ default: module.TrafficChart })));
export function TrafficChart(props: { rows: any[]; locale: Locale }) {
  return <React.Suspense fallback={<p className="analytics-provenance" role="status">{props.locale === 'zh-CN' ? '正在加载图表…' : 'Loading chart…'}</p>}><LazyTrafficChart {...props}/></React.Suspense>;
}
