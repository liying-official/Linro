import type { Locale } from './i18n';
import { UI } from './i18n-dict';

export const stamp = (value: unknown, locale: Locale) =>
  value
    ? new Date(Number(value) * 1000).toLocaleString(locale, { hour12: false })
    : UI[locale].common.notAvailable;

export const localDateTime = (unix: unknown) => {
  if (!unix) return '';
  const date = new Date(Number(unix) * 1000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

export const formatNumber = (value: unknown, locale: Locale) =>
  Math.round(Number(value) || 0).toLocaleString(locale);
