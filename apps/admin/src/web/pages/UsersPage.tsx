import React from 'react';
import type { AppState, UserRow } from '../models';
import { UI } from '../i18n-dict';
import { Icon } from '../components';
import { stamp } from '../view-format';

interface Props {
  state: Pick<AppState, 'users' | 'locale' | 'mutationPending'>;
  roleName: (role: string) => string;
  onEdit: (user: UserRow) => void;
}

export function UsersPage({ state: s, roleName, onEdit }: Props) {
  const ui = UI[s.locale];
  return (
    <>
      <div className="info-note">
        <Icon name="users" />
        {ui.users.note}
      </div>
      <section className="panel">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{ui.users.user}</th>
                <th>{ui.users.role}</th>
                <th>{ui.common.status}</th>
                <th>{ui.users.createdAt}</th>
                <th>{ui.common.actions}</th>
              </tr>
            </thead>
            <tbody>
              {s.users.map((user) => (
                <tr key={user.id}>
                  <td>
                    <strong>{user.display_name || user.email}</strong>
                    <small className="cell-small">{user.email}</small>
                  </td>
                  <td>
                    <span className="quiet-pill">{roleName(user.role)}</span>
                  </td>
                  <td>
                    <span className={'badge ' + (user.enabled ? 'green-badge' : 'muted-badge')}>
                      <i />
                      {user.enabled ? ui.common.enabled : ui.common.disabled}
                    </span>
                  </td>
                  <td>{stamp(user.created_at, s.locale)}</td>
                  <td>
                    <button
                      className="text-button"
                      disabled={s.mutationPending}
                      onClick={() => onEdit(user)}
                    >
                      {ui.common.edit}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
