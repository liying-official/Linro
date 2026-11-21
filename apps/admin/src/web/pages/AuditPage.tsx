import React from 'react';
import type { AppState } from '../models';
import { UI } from '../i18n-dict';
import { CursorPagination } from '../components';
import { stamp } from '../view-format';

interface Props {
  state: Pick<AppState, 'locale' | 'audit' | 'auditCursors' | 'nextAuditCursor' | 'pageLoading'>;
  onPage: (forward: boolean) => void;
}

export function AuditPage({ state: s, onPage }: Props) {
  const ui = UI[s.locale];
  return (
    <section className="panel">
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{ui.audit.time}</th>
              <th>{ui.audit.actor}</th>
              <th>{ui.audit.action}</th>
              <th>{ui.audit.resource}</th>
            </tr>
          </thead>
          <tbody>
            {s.audit.map((row) => (
              <tr key={row.id}>
                <td className="nowrap">{stamp(row.created_at, s.locale)}</td>
                <td>{row.actor_email}</td>
                <td>
                  <span className="code-badge">{row.action}</span>
                </td>
                <td>
                  {row.resource_type} <code>{row.resource_id}</code>
                  <details>
                    <summary>{ui.common.details}</summary>
                    <pre>{JSON.stringify(JSON.parse(row.details), null, 2)}</pre>
                    <small>
                      {ui.audit.requestId}: {row.request_id}
                    </small>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <CursorPagination
        page={s.auditCursors.length + 1}
        hasNext={s.nextAuditCursor !== null}
        disabled={s.pageLoading}
        locale={s.locale}
        onChange={onPage}
      />
    </section>
  );
}
