import React from 'react';
import { UI } from '../i18n-dict';
import { errorMessage } from '../error-message';
import type { AppState, JsonRecord } from '../models';
import { api } from '../client';
import { Field, Icon } from '../components';
import { stamp } from '../view-format';

interface Props {
  state: Pick<
    AppState,
    'locale' | 'session' | 'settings' | 'mutationPending' | 'exporting' | 'domains'
  >;
  onSave: (name: string) => void;
  onExport: (format: 'csv' | 'json') => void;
  onImport: () => void;
}

export function SettingsPage({ state: s, onSave, onExport, onImport }: Props) {
  const ui = UI[s.locale];
  const [healthResult, setHealthResult] = React.useState<JsonRecord | null>(null);
  const [healthError, setHealthError] = React.useState<unknown>(null);
  const [checkingHealth, setCheckingHealth] = React.useState(false);
  const healthRequest = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => healthRequest.current?.abort(), []);

  async function checkHealth() {
    if (healthRequest.current) return;
    const request = (healthRequest.current = new AbortController());
    setCheckingHealth(true);
    setHealthError(null);
    setHealthResult(null);
    try {
      const result = await api<JsonRecord>('/system/health', 'GET', undefined, request.signal);
      if (!request.signal.aborted) setHealthResult(result);
    } catch (error) {
      if (!request.signal.aborted) setHealthError(error);
    } finally {
      healthRequest.current = null;
      if (!request.signal.aborted) setCheckingHealth(false);
    }
  }
  return (
    <div className="settings-grid">
      <section className="panel padded">
        <h2>{ui.settings.workspaceSettings}</h2>
        <p>
          {s.locale === 'zh-CN' ? '跳转缓存模式：' : 'Redirect cache: '}
          {s.session?.features?.redirect_cache
            ? 'Optional KV + live D1 guard / fallback'
            : 'D1-only'}
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const name = String(new FormData(event.currentTarget).get('site_name') ?? '');
            onSave(name);
          }}
        >
          <Field label={ui.settings.workspaceName}>
            <input name="site_name" defaultValue={s.session?.site_name} maxLength={80} required />
          </Field>
          <button className="primary" disabled={s.mutationPending}>
            {ui.common.save}
          </button>
        </form>
        <hr />
        <h3>{ui.settings.runStatus}</h3>
        <p>{ui.settings.runStatusDetail}</p>
        <button disabled={checkingHealth} onClick={() => void checkHealth()}>
          {checkingHealth ? ui.common.loading : ui.settings.healthCheck}
        </button>
        {healthResult && <pre role="status">{JSON.stringify(healthResult, null, 2)}</pre>}
        {!!healthError && <p role="alert">{errorMessage(healthError, s.locale)}</p>}
        <p className="muted">
          {ui.settings.lastArchive}:{' '}
          {stamp(
            s.settings.find((row) => row.key === 'analytics_rollup_last_success')?.value,
            s.locale,
          )}
        </p>
      </section>
      <section className="panel padded">
        <h2>{ui.settings.exportBackup}</h2>
        <p>{ui.settings.exportBackupDetail}</p>
        <div className="button-row">
          <button disabled={s.exporting} onClick={() => onExport('json')}>
            <Icon name="download" size={16} />
            {ui.common.exportJson}
          </button>
          <button disabled={s.exporting} onClick={() => onExport('csv')}>
            {ui.common.exportCsv}
          </button>
        </div>
        <div className="info-box">
          <strong>{ui.settings.fullRestore}</strong>
          <p>{ui.settings.exportNote}</p>
          <code>npm run backup</code>
        </div>
        <h3>{ui.settings.importTitle}</h3>
        <p>{ui.settings.importDetail}</p>
        <button disabled={s.mutationPending || !s.domains.length} onClick={onImport}>
          {ui.links.importButton}
        </button>
      </section>
    </div>
  );
}
