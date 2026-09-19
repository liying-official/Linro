export type Locale = 'zh-CN' | 'en';

export const localeLabels: Record<Locale, string> = {
  'zh-CN': '简体中文',
  en: 'English',
};

export function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem('cf-links-locale');
    if (saved === 'zh-CN' || saved === 'en') return saved;
  } catch {}
  const language = typeof navigator !== 'undefined' ? navigator.language.toLowerCase() : 'zh-cn';
  return language.startsWith('zh') ? 'zh-CN' : 'en';
}

export function applyLocale(locale: Locale) {
  try { localStorage.setItem('cf-links-locale', locale); } catch {}
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
}
