const LOCAL_TOKEN_KEY = 'cf-links-dev-token';
export const isLocalHost = (hostname: string) =>
  ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
export const readLocalToken = () => sessionStorage.getItem(LOCAL_TOKEN_KEY);
export const saveLocalToken = (token: string) => sessionStorage.setItem(LOCAL_TOKEN_KEY, token);
export function signOut(kind: string, override?: () => void) {
  if (override) {
    override();
    return;
  }
  sessionStorage.removeItem(LOCAL_TOKEN_KEY);
  location.assign(kind === 'local' ? '/' : '/cdn-cgi/access/logout');
}
