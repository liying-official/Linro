// SPDX-License-Identifier: AGPL-3.0-only
import React from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Locale } from './i18n';

export function TrafficChart({ rows, locale }: { rows: { date?: unknown; clicks?: unknown }[]; locale: Locale }) {
  const zh = locale === 'zh-CN';
  const data = rows.map(row => ({ date: String(row.date ?? ''), clicks: Math.max(0, Number(row.clicks) || 0) }));
  const number = (value: number) => value.toLocaleString(locale, { maximumFractionDigits: 20 });
  if (!data.length) return <div className="empty"><h3>{zh ? '暂无点击数据' : 'No click data yet'}</h3><p>{zh ? '成功访问产生统计数据后会在此显示。' : 'Analytics will appear after successful visits are recorded.'}</p></div>;
  return <figure className="traffic-figure" aria-label={zh ? '每日点击趋势' : 'Daily click trend'}>
    <div className="chart ta-traffic-chart"><ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={50}>
      <AreaChart data={data} margin={{ top: 20, right: 20, bottom: 4, left: 4 }} accessibilityLayer>
        <defs><linearGradient id="linroTrafficFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#87CEEB" stopOpacity={0.65}/><stop offset="100%" stopColor="#87CEEB" stopOpacity={0.04}/></linearGradient></defs>
        <CartesianGrid stroke="#D8EDF5" vertical={false}/>
        <XAxis dataKey="date" axisLine={false} tickLine={false} minTickGap={36} tick={{ fill: '#0D394A', fontSize: 12 }} tickFormatter={value => String(value).slice(5)}/>
        <YAxis axisLine={false} tickLine={false} width={52} tick={{ fill: '#0D394A', fontSize: 12 }} tickFormatter={number}/>
        <Tooltip cursor={{ stroke: '#87CEEB', strokeWidth: 1 }} content={({ active, payload, label }) => active && payload?.length ? <div className="chart-tooltip"><strong>{String(label)}</strong><span>{zh ? '访问次数' : 'Visits'}<b>{number(Number(payload[0]?.value) || 0)}</b></span></div> : null}/>
        <Area name={zh ? '访问次数' : 'Visits'} type="monotone" dataKey="clicks" stroke="#0D394A" strokeWidth={2.5} fill="url(#linroTrafficFill)" isAnimationActive={false} activeDot={{ r: 5, fill: '#87CEEB', stroke: '#0D394A', strokeWidth: 2 }}/>
      </AreaChart>
    </ResponsiveContainer></div>
    <details className="chart-data"><summary>{zh ? '查看图表数据' : 'View chart data'}</summary><div className="table-scroll"><table><thead><tr><th>{zh ? '日期（UTC）' : 'Date (UTC)'}</th><th>{zh ? '访问次数' : 'Visits'}</th></tr></thead><tbody>{data.map((row,index)=><tr key={`${row.date}-${index}`}><td>{row.date}</td><td>{number(row.clicks)}</td></tr>)}</tbody></table></div></details>
  </figure>;
}
