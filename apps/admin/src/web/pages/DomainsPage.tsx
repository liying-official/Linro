import React from 'react';
import type { AppState, DomainRow } from '../models';
import { UI } from '../i18n-dict';
import { Empty, Icon } from '../components';
import { formatNumber } from '../view-format';

interface Props {
  state: Pick<AppState, 'domainDetails' | 'locale' | 'mutationPending'>;
  canWrite: boolean;
  onEdit: (domain?: DomainRow) => void;
  onDelete: (domain: DomainRow) => void;
}

export function DomainsPage({ state: s, canWrite, onEdit, onDelete }: Props) {
  const ui = UI[s.locale];
  return (
    <>
      <div className="info-note">
        <Icon name="globe" />
        {ui.domains.note}
      </div>
      <div className="domain-grid">
        {s.domainDetails.map((domain) => (
          <section className="panel domain-card" key={domain.id}>
            <div className="domain-card-top">
              <span className="domain-icon">
                <Icon name="globe" size={25} />
              </span>
              <span className={'badge ' + (domain.enabled ? 'green-badge' : 'muted-badge')}>
                <i />
                {domain.enabled ? ui.domains.ruleEnabled : ui.domains.ruleDisabled}
              </span>
            </div>
            <h2>{domain.hostname}</h2>
            <p>{domain.name || ui.domains.defaultName}</p>
            <div className="domain-numbers">
              <span>
                <strong>{formatNumber(domain.link_count, s.locale)}</strong>
                {ui.domains.linkCount}
              </span>
              <span>
                <strong>{domain.default_redirect_code}</strong>
                {ui.domains.defaultCode}
              </span>
            </div>
            {canWrite && (
              <div className="domain-actions">
                <button disabled={s.mutationPending} onClick={() => onEdit(domain)}>
                  {ui.domains.edit}
                </button>
                <button
                  className="text-button danger-text"
                  disabled={s.mutationPending}
                  onClick={() => {
                    if (confirm(ui.domains.deleteConfirm(domain.hostname))) onDelete(domain);
                  }}
                >
                  {ui.common.delete}
                </button>
              </div>
            )}
          </section>
        ))}
        {!s.domainDetails.length && (
          <div className="panel">
            <Empty
              title={ui.domains.emptyTitle}
              detail={ui.domains.emptyDetail}
              action={
                canWrite ? (
                  <button className="primary" onClick={() => onEdit()}>
                    {ui.domains.add}
                  </button>
                ) : undefined
              }
            />
          </div>
        )}
      </div>
    </>
  );
}
