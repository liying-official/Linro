import { isPage, type Page, type AppState } from './models';

export function requestedPage(hash: string): Page | null {
  const name = hash.slice(1);
  return isPage(name) ? name : null;
}
const pageScope: Partial<Record<Page, string>> = {
  users: 'users:write',
  settings: 'settings:write',
  audit: 'audit:read',
};
export function permittedPage(target: Page, scopes: readonly string[]): Page {
  const scope = pageScope[target];
  return scope && !scopes.includes(scope) ? 'dashboard' : target;
}
export function observeHash(navigate: (page: Page) => void): () => void {
  const changed = () => {
    const page = requestedPage(location.hash);
    if (page) navigate(page);
  };
  window.addEventListener('hashchange', changed);
  return () => window.removeEventListener('hashchange', changed);
}

export function pageTransition(
  target: Page,
  scopes: readonly string[],
  analytics: AppState['analytics'],
  setHash: boolean,
) {
  const page = permittedPage(target, scopes);
  if (setHash) history.replaceState(null, '', '#' + page);
  return {
    page,
    error: '',
    notice: '',
    selected: [] as string[],
    pageLoading: true,
    analytics: page === 'analytics' || page === 'dashboard' ? null : analytics,
  };
}
export function cursorHistory(
  previous: readonly string[],
  next: string | null,
  forward: boolean,
): string[] | null {
  if (forward) return next ? [...previous, next] : null;
  return previous.length ? previous.slice(0, -1) : null;
}
