import React from 'react';
import type { AppState } from '../models';
import { UI } from '../i18n-dict';
import { Empty, Icon } from '../components';
import { stamp } from '../view-format';

interface Props {
  state: Pick<AppState, 'tokens' | 'locale' | 'mutationPending'>;
  onRevoke: (id: string) => void;
}

export function TokensPage({ state: s, onRevoke }: Props) {
  const ui = UI[s.locale];
  return (
    <>
      <div className="info-note">
        <Icon name="key" />
        {ui.tokens.note}
      </div>
      <section className="panel">
        {!s.tokens.length ? (
          <Empty title={ui.tokens.emptyTitle} detail={ui.tokens.emptyDetail} />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{ui.tokens.name}</th>
                  <th>{ui.tokens.prefix}</th>
                  <th>{ui.tokens.expiresAt}</th>
                  <th>{ui.common.status}</th>
                  <th>{ui.common.actions}</th>
                </tr>
              </thead>
              <tbody>
                {s.tokens.map((token) => (
                  <tr key={token.id}>
                    <td>
                      <strong>{token.name}</strong>
                    </td>
                    <td>
                      <code>{token.prefix}…</code>
                      <small className="cell-small">{JSON.parse(token.scopes).join(', ')}</small>
                    </td>
                    <td>{stamp(token.expires_at, s.locale)}</td>
                    <td>
                      {token.revoked_at
                        ? ui.tokens.revoked
                        : token.expires_at < Date.now() / 1000
                          ? ui.common.expired
                          : ui.tokens.valid}
                    </td>
                    <td>
                      {!token.revoked_at && (
                        <button
                          className="text-button danger-text"
                          disabled={s.mutationPending}
                          onClick={() => {
                            if (confirm(ui.tokens.revokeConfirm)) onRevoke(token.id);
                          }}
                        >
                          {ui.tokens.revoke}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
