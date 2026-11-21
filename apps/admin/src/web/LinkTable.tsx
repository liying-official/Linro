import React from 'react';
import type { LinkRow } from './models';
import type { Locale } from './i18n';
import { UI } from './i18n-dict';
import { Empty, Icon } from './components';
import { responseLabels } from './response-ui';
import { vpnLabels } from './VPNStats';
import { stamp } from './view-format';

interface Props {
  rows: LinkRow[];
  locale: Locale;
  compact?: boolean;
  selected: string[];
  pending: boolean;
  hasDomains: boolean;
  canWrite: boolean;
  canManage: (row: LinkRow, scope?: string) => boolean;
  onSelect: (ids: string[]) => void;
  onEdit: (row: LinkRow) => void;
  onDelete: (row: LinkRow) => void;
  onCopy: (shortURL: string) => void;
  onStats?: (id: string) => void;
  onAddDomain?: () => void;
}
export function LinkTable({
  rows,
  locale,
  compact = false,
  selected,
  pending,
  hasDomains,
  canWrite,
  canManage,
  onSelect,
  onEdit,
  onDelete,
  onCopy,
  onStats,
  onAddDomain,
}: Props) {
  const writable = rows.filter((link) => canManage(link));
  const ui = UI[locale];
  if (!rows.length)
    return (
      <Empty
        title={ui.links.emptyTitle}
        detail={hasDomains ? ui.links.emptyDetail : ui.links.emptyNeedDomain}
        action={
          !hasDomains && onAddDomain ? (
            <button className="primary" onClick={onAddDomain}>
              {ui.links.addDomain} <Icon name="arrow" />
            </button>
          ) : undefined
        }
      />
    );
  return (
    <div className="table-scroll">
      <table className="links-table">
        <thead>
          <tr>
            {!compact && canWrite && (
              <th className="check-cell">
                <input
                  aria-label={ui.links.selectPage}
                  type="checkbox"
                  disabled={!writable.length}
                  checked={
                    writable.length > 0 && writable.every((link) => selected.includes(link.id))
                  }
                  onChange={(event) =>
                    onSelect(event.target.checked ? writable.map((link) => link.id) : [])
                  }
                />
              </th>
            )}
            <th>{ui.links.shortLinkTarget}</th>
            <th>{ui.links.redirectType}</th>
            <th>{ui.common.status}</th>
            {!compact && <th>{ui.links.createdAt}</th>}
            <th className="right">{ui.common.actions}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((link) => {
            const expired = link.expires_at && link.expires_at <= Date.now() / 1000;
            const disabled = !link.enabled || link.domain_enabled === 0;
            const exhausted =
              link.max_redirects !== null &&
              link.max_redirects !== undefined &&
              link.redirect_count >= link.max_redirects;
            return (
              <tr key={link.id}>
                {!compact && canWrite && (
                  <td className="check-cell">
                    <input
                      aria-label={`${ui.links.selectOne} ${link.slug}`}
                      disabled={!canManage(link)}
                      type="checkbox"
                      checked={selected.includes(link.id)}
                      onChange={(event) =>
                        onSelect(
                          event.target.checked
                            ? [...selected, link.id]
                            : selected.filter((id) => id !== link.id),
                        )
                      }
                    />
                  </td>
                )}
                <td>
                  <div className="link-primary">
                    <span className="link-cell-icon">
                      <Icon name="link" size={16} />
                    </span>
                    <a href={link.short_url} target="_blank" rel="noreferrer">
                      {link.hostname}/<strong>{link.slug}</strong>
                    </a>
                  </div>
                  <div
                    className="target-text"
                    title={
                      link.response_mode === 'text' ? responseLabels[locale].text : link.target_url
                    }
                  >
                    {link.title ? link.title + ' · ' : ''}
                    {link.response_mode === 'text' ? responseLabels[locale].text : link.target_url}
                  </div>
                </td>
                <td>
                  <span className="code-badge">
                    {link.response_mode === 'text' ? 200 : link.redirect_code}
                  </span>
                  <small className="cell-small">
                    {link.response_mode === 'text'
                      ? responseLabels[locale].text
                      : [301, 308].includes(link.redirect_code)
                        ? ui.links.permanent
                        : ui.links.temporary}
                  </small>
                </td>
                <td>
                  <span
                    className={
                      'badge ' +
                      (disabled ? 'muted-badge' : expired ? 'warning-badge' : 'green-badge')
                    }
                  >
                    <i />
                    {!disabled && !expired && exhausted
                      ? locale === 'zh-CN'
                        ? '次数已用尽'
                        : 'Limit reached'
                      : disabled
                        ? ui.common.disabled
                        : expired
                          ? ui.common.expired
                          : ui.common.active}
                  </span>
                  <div className="control-badges">
                    {!!link.block_vpn && <span>{vpnLabels[locale].badge}</span>}
                    {link.password_protected && (
                      <span>{locale === 'zh-CN' ? '密码保护' : 'Password'}</span>
                    )}
                    {link.geo_rules?.length > 0 && (
                      <span>{locale === 'zh-CN' ? '地理分流' : 'Geo routing'}</span>
                    )}
                    {link.max_redirects != null && (
                      <span>
                        {link.redirect_count} / {link.max_redirects}
                      </span>
                    )}
                  </div>
                </td>
                {!compact && <td className="date-cell">{stamp(link.created_at, locale)}</td>}
                <td>
                  <div className="row-actions">
                    {onStats && (
                      <button
                        className="icon-button"
                        title={responseLabels[locale].stats}
                        aria-label={`${responseLabels[locale].stats} ${link.slug}`}
                        onClick={() => onStats(link.id)}
                      >
                        <Icon name="chart" size={16} />
                      </button>
                    )}
                    <button
                      className="icon-button"
                      aria-label={`${ui.links.copyShortLink} ${link.slug}`}
                      title={ui.links.copyShortLink}
                      onClick={() => onCopy(link.short_url)}
                    >
                      <Icon name="copy" size={16} />
                    </button>
                    {canManage(link) && (
                      <button
                        className="text-button"
                        disabled={pending}
                        onClick={() => onEdit(link)}
                      >
                        {ui.common.edit}
                      </button>
                    )}
                    {!compact && canManage(link, 'links:delete') && (
                      <button
                        className="text-button danger-text"
                        disabled={pending}
                        onClick={() => {
                          if (window.confirm(ui.links.deleteConfirm(link.slug))) onDelete(link);
                        }}
                      >
                        {ui.common.delete}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
