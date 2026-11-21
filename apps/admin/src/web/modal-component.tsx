import React from 'react';
import { UI } from './i18n-dict';
import type { Locale } from './i18n';
import { Field, Icon } from './components';
import { focusDialog, handleDialogKey } from './dialog-focus';
import type { DomainRow, UserRow } from './models';
interface FrameProps {
  title: string;
  locale: Locale;
  pending: boolean;
  error: string;
  onClose: () => void;
  children: React.ReactNode;
}
export function AdminModal({ title, locale, pending, error, onClose, children }: FrameProps) {
  const ui = UI[locale];
  const panel = React.useRef<HTMLElement>(null);
  React.useLayoutEffect(() => {
    focusDialog(panel.current);
  }, [title]);
  return (
    <div className="modal-overlay" onKeyDown={(event) => handleDialogKey(event, onClose)}>
      <section
        ref={panel}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="modal-header">
          <div>
            <div className="eyebrow">LINRO</div>
            <h2 id="modal-title">{title}</h2>
          </div>
          <button
            className="icon-button"
            disabled={pending}
            aria-label={ui.modals.closeDialog}
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </div>
        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}
        {children}
      </section>
    </div>
  );
}
export function ModalFooter({
  locale,
  pending,
  onClose,
}: Pick<FrameProps, 'locale' | 'pending' | 'onClose'>) {
  const ui = UI[locale];
  return (
    <div className="modal-footer">
      <button type="button" disabled={pending} onClick={onClose}>
        {ui.common.cancel}
      </button>
      <button className="primary" type="submit" disabled={pending}>
        {pending ? ui.common.saving : ui.common.save}
      </button>
    </div>
  );
}
interface FormProps {
  locale: Locale;
  footer: React.ReactNode;
  onSubmit: React.FormEventHandler<HTMLFormElement>;
}
export function DomainForm({ locale, footer, onSubmit, row }: FormProps & { row?: DomainRow }) {
  const ui = UI[locale];
  return (
    <form onSubmit={onSubmit}>
      <div className="form-grid">
        <Field label={ui.modals.fieldHostname} hint={ui.modals.fieldHostnameHint} wide>
          <input
            name="hostname"
            defaultValue={row?.hostname ?? ''}
            disabled={!!row}
            required
            maxLength={253}
            placeholder="go.example.com"
            autoFocus
          />
        </Field>
        <Field label={ui.modals.fieldName}>
          <input name="name" defaultValue={row?.name ?? ''} maxLength={100} />
        </Field>
        <Field label={ui.modals.fieldCode}>
          <select name="default_redirect_code" defaultValue={row?.default_redirect_code ?? 301}>
            {[301, 302, 307, 308].map((code) => (
              <option key={code}>{code}</option>
            ))}
          </select>
        </Field>
        <label className="checkbox-field">
          <input type="checkbox" name="enabled" defaultChecked={row ? !!row.enabled : true} />
          {ui.modals.fieldEnabledDomain}
        </label>
      </div>
      <div className="info-box">{ui.modals.domainInfo}</div>
      {footer}
    </form>
  );
}
export function UserForm({ locale, footer, onSubmit, row }: FormProps & { row?: UserRow }) {
  const ui = UI[locale];
  return (
    <form onSubmit={onSubmit}>
      <div className="form-grid">
        <Field label={ui.modals.fieldEmail} wide>
          <input
            type="email"
            name="email"
            required
            disabled={!!row}
            defaultValue={row?.email ?? ''}
            maxLength={254}
          />
        </Field>
        <Field label={ui.modals.fieldName}>
          <input name="display_name" defaultValue={row?.display_name ?? ''} maxLength={100} />
        </Field>
        <Field label={ui.modals.fieldRole}>
          <select name="role" defaultValue={row?.role ?? 'viewer'}>
            <option value="viewer">{ui.modals.viewer}</option>
            <option value="editor">{ui.modals.editor}</option>
            <option value="admin">{ui.modals.admin}</option>
            <option value="owner">{ui.modals.owner}</option>
          </select>
        </Field>
        {row && (
          <label className="checkbox-field">
            <input type="checkbox" name="enabled" defaultChecked={!!row.enabled} />
            {ui.modals.fieldEnabledUser}
          </label>
        )}
      </div>
      {footer}
    </form>
  );
}
export function TokenForm({
  locale,
  footer,
  onSubmit,
  scopes,
}: FormProps & { scopes: readonly string[] }) {
  const ui = UI[locale];
  return (
    <form onSubmit={onSubmit}>
      <Field label={ui.modals.fieldTokenName}>
        <input
          name="name"
          maxLength={100}
          required
          placeholder={ui.modals.fieldTokenPlaceholder}
          autoFocus
        />
      </Field>
      <Field label={ui.modals.fieldTokenDays}>
        <select name="days" defaultValue="30">
          <option value="1">{ui.modals.oneDay}</option>
          <option value="7">{ui.modals.sevenDays}</option>
          <option value="30">{ui.modals.thirtyDays}</option>
          <option value="90">{ui.modals.ninetyDays}</option>
          <option value="364">{ui.modals.yearDays}</option>
        </select>
      </Field>
      <h3>{ui.modals.scopes}</h3>
      <div className="scope-grid">
        {['links:read', 'links:write', 'links:delete', 'domains:read', 'analytics:read']
          .filter((scope) => scopes.includes(scope))
          .map((scope) => (
            <label className="checkbox-field" key={scope}>
              <input
                name="scopes"
                type="checkbox"
                value={scope}
                defaultChecked={scope === 'links:read'}
              />
              <code>{scope}</code>
            </label>
          ))}
      </div>
      {footer}
    </form>
  );
}
export function TokenSecret({
  locale,
  token,
  onCopy,
  onClose,
}: {
  locale: Locale;
  token: string;
  onCopy: (token: string) => void;
  onClose: () => void;
}) {
  const ui = UI[locale];
  return (
    <div>
      <p>{ui.modals.secretBody}</p>
      <textarea
        className="secret"
        aria-label={ui.modals.secretAria}
        readOnly
        rows={3}
        value={token}
      />
      <div className="modal-footer">
        <button onClick={() => onCopy(token)}>
          <Icon name="copy" />
          {ui.modals.copyToken}
        </button>
        <button className="primary" onClick={onClose}>
          {ui.modals.closeAfterSave}
        </button>
      </div>
    </div>
  );
}
