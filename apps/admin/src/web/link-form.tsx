import React from 'react';
import { UI } from './i18n-dict';
import type { Locale } from './i18n';
import { Field } from './components';
import {
  DEFAULT_REDIRECT_CACHE_TTL_SECONDS,
  MAX_TARGET_URL_CHARS,
  MAX_TEXT_RESPONSE_CHARS,
} from '../../../../packages/shared/src/limits';
import { LinkOptions } from './LinkOptions';
import { responseLabels } from './response-ui';
import { localDateTime } from './view-format';
import type { DomainOption, LinkRow, SessionData } from './models';

interface Props {
  locale: Locale;
  row?: LinkRow;
  domains: DomainOption[];
  features?: SessionData['features'];
  pending: boolean;
  responseMode: 'redirect' | 'text';
  plainTextDraft: string;
  onModeChange: (mode: 'redirect' | 'text') => void;
  onTextChange: (draft: string) => void;
  onSubmit: React.FormEventHandler<HTMLFormElement>;
  footer: React.ReactNode;
}
export function LinkForm({
  locale,
  row,
  domains,
  features,
  pending,
  responseMode,
  plainTextDraft,
  onModeChange,
  onTextChange,
  onSubmit,
  footer,
}: Props) {
  const ui = UI[locale];
  return (
    <form onSubmit={onSubmit}>
      <div className="form-grid">
        <Field label={responseLabels[locale].mode} wide>
          <select
            name="response_mode"
            value={responseMode}
            disabled={pending}
            onChange={(event) => onModeChange(event.target.value === 'text' ? 'text' : 'redirect')}
          >
            <option value="redirect">{responseLabels[locale].redirect}</option>
            <option value="text">{responseLabels[locale].text}</option>
          </select>
        </Field>
        {responseMode === 'text' && (
          <Field label={responseLabels[locale].content} hint={responseLabels[locale].hint} wide>
            <textarea
              name="text_content"
              rows={8}
              maxLength={MAX_TEXT_RESPONSE_CHARS}
              required
              value={plainTextDraft}
              onChange={(event) => onTextChange(event.target.value)}
              autoFocus
            />
          </Field>
        )}
        <Field label={ui.modals.fieldDomain}>
          <select
            name="domain_id"
            defaultValue={row?.domain_id ?? domains[0]?.id}
            onChange={(event) => {
              if (!row) {
                const code = event.currentTarget.form?.elements.namedItem(
                  'redirect_code',
                ) as HTMLSelectElement | null;
                if (code)
                  code.value = String(
                    domains.find((domain) => domain.id === event.currentTarget.value)
                      ?.default_redirect_code ?? 301,
                  );
              }
            }}
            required
          >
            {domains.map((domain) => (
              <option key={domain.id} value={domain.id}>
                {domain.hostname}
                {domain.enabled ? '' : locale === 'zh-CN' ? '（已停用）' : ' (disabled)'}
              </option>
            ))}
          </select>
        </Field>
        <Field label={ui.modals.fieldSlug} hint={ui.modals.fieldSlugHint}>
          <input
            name="slug"
            defaultValue={row?.slug ?? ''}
            pattern="[A-Za-z0-9_\-]{1,64}"
            maxLength={64}
            required={!!row}
            placeholder={ui.modals.fieldSlugPlaceholder}
          />
        </Field>
        {responseMode === 'redirect' && (
          <Field label={ui.modals.fieldTarget} hint={ui.modals.fieldTargetHint} wide>
            <input
              name="target_url"
              type="url"
              required
              maxLength={MAX_TARGET_URL_CHARS}
              defaultValue={row?.target_url ?? ''}
              placeholder="https://example.com/your-page"
              autoFocus
            />
          </Field>
        )}
        <Field label={ui.modals.fieldTitle}>
          <input name="title" maxLength={200} defaultValue={row?.title ?? ''} />
        </Field>
        {responseMode === 'redirect' && (
          <Field label={ui.modals.fieldCode}>
            <select
              name="redirect_code"
              defaultValue={row?.redirect_code ?? domains[0]?.default_redirect_code ?? 301}
            >
              {[301, 302, 307, 308].map((code) => (
                <option key={code} value={code}>
                  {code} ·{' '}
                  {[301, 308].includes(code) ? ui.modals.codePermanent : ui.modals.codeTemporary}
                </option>
              ))}
            </select>
          </Field>
        )}
        {responseMode === 'redirect' && (
          <Field label={ui.modals.fieldQuery} hint={ui.modals.fieldQueryHint}>
            <select name="query_mode" defaultValue={row?.query_mode ?? 'discard'}>
              <option value="discard">{ui.modals.queryDiscard}</option>
              <option value="merge">{ui.modals.queryMerge}</option>
              <option value="replace">{ui.modals.queryReplace}</option>
            </select>
          </Field>
        )}
        <Field label={ui.modals.fieldExpires} hint={ui.modals.fieldExpiresHint}>
          <input
            type="datetime-local"
            name="expires_at"
            defaultValue={localDateTime(row?.expires_at)}
          />
        </Field>
        {responseMode === 'redirect' && (
          <Field label={ui.modals.fieldCache} hint={ui.modals.fieldCacheHint}>
            <input
              name="cache_ttl"
              type="number"
              min="0"
              max="3600"
              required
              defaultValue={row?.cache_ttl ?? 0}
            />
          </Field>
        )}
        <Field
          label={locale === 'zh-CN' ? 'KV 路由缓存（秒）' : 'KV route cache (seconds)'}
          hint={
            locale === 'zh-CN'
              ? `留空继承全局 ${features?.redirect_cache_default_ttl ?? DEFAULT_REDIRECT_CACHE_TTL_SECONDS} 秒；0 禁用，或 60–86400 秒。密码、浏览器检查、次数限制、到期、地区分流和纯文本会跳过 KV。此项不改变浏览器缓存。`
              : `Blank inherits the global ${features?.redirect_cache_default_ttl ?? DEFAULT_REDIRECT_CACHE_TTL_SECONDS} seconds; 0 disables KV, or use 60–86400. Password, browser checks, limits, expiry, geo routing, and text bypass KV. Browser caching is separate.`
          }
          wide
        >
          <input
            name="kv_cache_ttl"
            type="number"
            min="0"
            max="86400"
            step="1"
            defaultValue={row?.kv_cache_ttl ?? ''}
            placeholder={locale === 'zh-CN' ? '继承全局' : 'Inherit global'}
          />
        </Field>
        <label className="checkbox-field">
          <input type="checkbox" name="enabled" defaultChecked={row ? !!row.enabled : true} />
          {ui.modals.fieldEnabledLink}
        </label>
        <Field label={ui.modals.fieldDescription} wide>
          <textarea
            name="description"
            rows={3}
            maxLength={2000}
            defaultValue={row?.description ?? ''}
          />
        </Field>
      </div>
      <LinkOptions
        key={row?.id ?? 'new'}
        textMode={responseMode === 'text'}
        locale={locale}
        link={row}
        passwordsConfigured={!!features?.passwords_configured}
        browserChecksConfigured={!!features?.browser_checks_configured}
        disabled={pending}
      />
      <div className="warning-note">
        {responseMode === 'text' ? responseLabels[locale].warning : ui.modals.linkWarning}
      </div>
      {footer}
    </form>
  );
}
