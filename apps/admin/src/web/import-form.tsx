import React from 'react';
import { UI } from './i18n-dict';
import type { Locale } from './i18n';
import { Field } from './components';
import type { AppState, DomainOption } from './models';
interface Props {
  locale: Locale;
  domains: DomainOption[];
  pending: boolean;
  progress: Pick<
    AppState,
    'importRows' | 'importName' | 'importDone' | 'importStatus' | 'importRetryAt'
  >;
  onFile: (file?: File) => void;
  onSubmit: React.FormEventHandler<HTMLFormElement>;
  onClose: () => void;
}
export function ImportForm({
  locale,
  domains,
  pending,
  progress,
  onFile,
  onSubmit,
  onClose,
}: Props) {
  const ui = UI[locale];
  return (
    <form onSubmit={onSubmit}>
      <Field label={ui.modals.file} hint={ui.modals.fileHint}>
        <input
          type="file"
          accept=".csv,.json"
          disabled={pending || ['waiting', 'retrying'].includes(progress.importStatus)}
          onChange={(event) => void onFile(event.target.files?.[0])}
        />
      </Field>
      <Field label={ui.modals.fallbackDomain} hint={ui.modals.fallbackDomainHint}>
        <select
          name="domain_id"
          disabled={pending || progress.importStatus !== 'new'}
          required
          defaultValue={domains[0]?.id}
        >
          {domains.map((domain) => (
            <option value={domain.id} key={domain.id}>
              {domain.hostname}
            </option>
          ))}
        </select>
      </Field>
      {progress.importRows.length > 0 && (
        <div className="import-preview">
          <h3>
            {progress.importName} · {progress.importRows.length.toLocaleString(locale)}
          </h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{ui.modals.previewCode}</th>
                  <th>{ui.modals.previewTarget}</th>
                </tr>
              </thead>
              <tbody>
                {progress.importRows.slice(0, 5).map((row, index) => (
                  <tr key={index}>
                    <td>{String(row.slug ?? row.keyword ?? ui.links.autoGenerate)}</td>
                    <td>{String(row.target_url ?? row.url ?? '')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="warning-note">
        {ui.modals.importWarning}
        <br />
        {locale === 'zh-CN'
          ? '密码保护导出必须提供新 password 才能导入；计数从 0 开始。完整恢复请使用私有 SQL 备份。'
          : 'Protected exports require a new password for import; counters start at 0. Use a private SQL backup for a full restore.'}
      </div>
      {progress.importStatus === 'retrying' && (
        <p role="status">
          {ui.links.importRetrying(new Date(progress.importRetryAt).toLocaleTimeString(locale))}
        </p>
      )}
      {progress.importStatus === 'waiting' && (
        <p role="status">
          {ui.links.importWaiting(new Date(progress.importRetryAt).toLocaleTimeString(locale))}
        </p>
      )}
      {progress.importDone > 0 && (
        <p role="status">
          {ui.links.importedProgress(progress.importDone, progress.importRows.length)}
        </p>
      )}
      <div className="modal-footer">
        <button type="button" disabled={pending} onClick={onClose}>
          {ui.common.cancel}
        </button>
        <button
          type="submit"
          className="primary"
          disabled={
            pending ||
            !progress.importRows.length ||
            ['waiting', 'retrying', 'review'].includes(progress.importStatus)
          }
        >
          {pending
            ? ui.modals.importing
            : progress.importStatus === 'resume'
              ? ui.modals.resumeImport
              : ui.modals.confirmImport}
        </button>
      </div>
    </form>
  );
}
