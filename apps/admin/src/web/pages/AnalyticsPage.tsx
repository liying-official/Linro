import React from 'react';
import type { AppState } from '../models';
import { UI } from '../i18n-dict';
import { AnalyticsSelection } from '../AnalyticsSelection';
import { Empty, TrafficChart } from '../components';
import { responseLabels } from '../response-ui';
import { VPNStats } from '../VPNStats';
import { formatNumber } from '../view-format';

interface Props {
  state: Pick<AppState, 'analyticsIds' | 'pageLoading' | 'locale' | 'days' | 'analytics'>;
  onApply: (ids: string[] | null) => void;
  onDays: (days: number) => void;
}

export function AnalyticsPage({ state: s, onApply, onDays }: Props) {
  const ui = UI[s.locale];
  return (
    <>
      <AnalyticsSelection
        locale={s.locale}
        ids={s.analyticsIds}
        disabled={s.pageLoading}
        onApply={onApply}
      />
      <div className="analytics-controls">
        <span>{ui.analytics.window}</span>
        <select
          aria-label={ui.analytics.window}
          value={s.days}
          onChange={(event) => onDays(Number(event.target.value))}
        >
          {[1, 7, 30, 90].map((days) => (
            <option key={days} value={days}>
              {ui.analytics.recentDays(days)}
            </option>
          ))}
        </select>
        <small>{ui.analytics.hint}</small>
      </div>
      <p className="analytics-provenance">{responseLabels[s.locale].provenance}</p>
      {s.pageLoading ? (
        <p role="status">{ui.common.loading}</p>
      ) : !s.analytics?.available ? (
        <section className="panel">
          <Empty
            title={ui.analytics.unavailableTitle}
            detail={s.analytics?.reason ?? ui.analytics.unavailableDetail}
          />
        </section>
      ) : (
        <>
          <VPNStats locale={s.locale} data={s.analytics} />
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>{ui.dashboard.chartTitle}</h2>
                <p>{ui.analytics.trendSubtitle(s.days)}</p>
              </div>
              <strong className="stat-total">
                {formatNumber(s.analytics.clicks, s.locale)}{' '}
                <small>{ui.analytics.estimatedRequests}</small>
              </strong>
            </div>
            <TrafficChart rows={s.analytics.timeline ?? []} locale={s.locale} />
          </section>
          <div className="analytics-grid">
            {(
              [
                [ui.analytics.topLinks, 'top'],
                [ui.analytics.countries, 'countries'],
                [ui.analytics.referrers, 'referrers'],
                [responseLabels[s.locale].timezones, 'timezones'],
                [responseLabels[s.locale].ipTimezones, 'ip_timezones'],
                [responseLabels[s.locale].devices, 'devices'],
              ] as const
            ).map(([title, key]) => {
              const rows = s.analytics?.[key] ?? [];
              return (
                <section className="panel" key={key}>
                  <div className="panel-heading">
                    <h2>{title}</h2>
                  </div>
                  <div className="ranking">
                    {rows.length ? (
                      rows.map((row, index) => (
                        <div className="rank-row" key={index}>
                          <span className="rank-no">{String(index + 1).padStart(2, '0')}</span>
                          <span title={row.hostname ?? ''}>
                            {key === 'top'
                              ? `${row.hostname}/${row.slug}`
                              : key === 'countries'
                                ? row.country || ui.analytics.unknownCountry
                                : key === 'timezones' || key === 'ip_timezones'
                                  ? row.timezone && row.timezone !== 'none'
                                    ? row.timezone
                                    : responseLabels[s.locale].none
                                  : key === 'devices'
                                    ? row.device === 'mobile'
                                      ? responseLabels[s.locale].mobile
                                      : row.device === 'pc'
                                        ? responseLabels[s.locale].pc
                                        : responseLabels[s.locale].none
                                    : row.referrer || ui.analytics.direct}
                          </span>
                          <strong>{formatNumber(row.clicks, s.locale)}</strong>
                        </div>
                      ))
                    ) : (
                      <p className="muted">{ui.analytics.noData}</p>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
