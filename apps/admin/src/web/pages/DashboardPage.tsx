import React from 'react';
import type { AppState } from '../models';
import { UI } from '../i18n-dict';
import { Empty, Icon, TrafficChart } from '../components';
import { ComponentCard, MetricCard } from '../tailadmin/ComponentCard';
import { formatNumber } from '../view-format';

interface Props {
  state: Pick<AppState, 'summary' | 'analytics' | 'locale'>;
  onNavigate: (page: 'analytics' | 'links') => void;
  children: React.ReactNode;
}

export function DashboardPage({ state: s, onNavigate, children }: Props) {
  const ui = UI[s.locale];
  return (
    <>
      <section className="metric-grid">
        {ui.dashboard.metrics.map(([label, hint, icon], index) => (
          <MetricCard
            key={label}
            label={label}
            hint={hint}
            icon={<Icon name={icon} size={23} />}
            value={
              [s.summary.links, s.summary.active, s.summary.expired, s.summary.domains][index] ===
              undefined
                ? ui.common.notAvailable
                : formatNumber(
                    [s.summary.links, s.summary.active, s.summary.expired, s.summary.domains][
                      index
                    ],
                    s.locale,
                  )
            }
          />
        ))}
      </section>
      <ComponentCard
        title={ui.dashboard.chartTitle}
        desc={ui.dashboard.chartSubtitle}
        action={
          <span className="quiet-pill">
            {s.analytics?.available
              ? ui.dashboard.chartReady(Number(s.analytics.clicks ?? 0))
              : ui.dashboard.chartPending}
          </span>
        }
      >
        {s.analytics?.available ? (
          <TrafficChart rows={s.analytics.timeline ?? []} locale={s.locale} />
        ) : (
          <Empty
            title={ui.dashboard.analyticsConnect}
            detail={s.analytics?.reason ?? ui.dashboard.analyticsReading}
            action={
              <button onClick={() => onNavigate('analytics')}>
                {ui.dashboard.viewAnalytics} <Icon name="arrow" size={16} />
              </button>
            }
          />
        )}
      </ComponentCard>
      <ComponentCard
        title={ui.dashboard.recentTitle}
        desc={ui.dashboard.recentSubtitle}
        action={
          <button className="text-button" onClick={() => onNavigate('links')}>
            {ui.common.viewAll} <Icon name="arrow" size={16} />
          </button>
        }
      >
        {children}
      </ComponentCard>
    </>
  );
}
