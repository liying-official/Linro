import React from 'react';
import { UI } from './i18n-dict';
import { Field, Icon } from './components';
import { localeLabels, type Locale } from './i18n';

interface LanguageProps {
  locale: Locale;
  onLocaleChange: (value: Locale) => void;
}
export function LanguageSwitch({
  locale: current,
  onLocaleChange,
  compact = false,
}: LanguageProps & { compact?: boolean }) {
  const ui = UI[current];
  return (
    <div
      className={'lang-switch' + (compact ? ' compact' : '')}
      aria-label={ui.common.language}
      role="group"
    >
      {(['zh-CN', 'en'] as Locale[]).map((locale) => (
        <button
          key={locale}
          type="button"
          className={current === locale ? 'active' : ''}
          aria-pressed={current === locale}
          onClick={() => onLocaleChange(locale)}
        >
          {localeLabels[locale]}
        </button>
      ))}
    </div>
  );
}

interface LoginProps extends LanguageProps {
  local: boolean;
  loading: boolean;
  error: string;
  onLogin: (token: string) => void;
  onRecheck: () => void;
}
export function Login({
  locale,
  onLocaleChange,
  local,
  loading,
  error,
  onLogin,
  onRecheck,
}: LoginProps) {
  const ui = UI[locale];
  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-toolbar">
          <LanguageSwitch locale={locale} onLocaleChange={onLocaleChange} compact />
        </div>
        <span className="brand-mark">
          <Icon name="link" size={30} />
        </span>
        <div className="eyebrow">YOUR LINKS. YOUR CONTROL.</div>
        <h1>{ui.login.title}</h1>
        <p>{ui.login.subtitle}</p>
        {loading ? (
          <p className="muted">{ui.login.verifying}</p>
        ) : (
          <>
            {error && (
              <div className="alert error" role="alert">
                {error}
              </div>
            )}
            {local ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const value = new FormData(event.currentTarget).get('dev_token');
                  onLogin(String(value));
                }}
              >
                <Field label={ui.login.localToken} hint={ui.login.localTokenHint}>
                  <input name="dev_token" type="password" required autoComplete="off" />
                </Field>
                <button className="primary full" type="submit">
                  {ui.login.enterLocal} <Icon name="arrow" />
                </button>
              </form>
            ) : (
              <>
                <p>{ui.login.remoteHint}</p>
                <button className="primary" onClick={onRecheck}>
                  {ui.login.recheck}
                </button>
              </>
            )}
          </>
        )}
        <small>{ui.login.runtime}</small>
      </div>
    </div>
  );
}
