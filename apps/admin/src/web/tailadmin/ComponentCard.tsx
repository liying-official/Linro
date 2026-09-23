// SPDX-License-Identifier: MIT
// Adapted from TailAdmin ComponentCard and EcommerceMetrics (copyright (c) 2023 TailAdmin).
import React from 'react';

export function ComponentCard({ title, desc, action, children, className = '' }: {
  title: string; desc?: string; action?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return <section className={`panel rounded-2xl border border-sky-line bg-white ${className}`}><div className="panel-heading px-6 py-5"><div><h2 className="text-base font-semibold text-ink">{title}</h2>{desc && <p className="mt-1 text-sm text-ink">{desc}</p>}</div>{action}</div>{children}</section>;
}

export function MetricCard({ label, hint, value, icon }: {label: string; hint: string; value: string; icon: React.ReactNode}) {
  return <div className="metric rounded-2xl border border-sky-line bg-white p-5 md:p-6"><div className="metric-icon flex h-12 w-12 items-center justify-center rounded-xl bg-sky-soft text-ink">{icon}</div><div className="mt-5"><span className="metric-label text-sm text-ink">{label}</span><strong className="mt-2 block text-3xl font-semibold text-ink">{value}</strong><small className="mt-2 block text-ink">{hint}</small></div></div>;
}
