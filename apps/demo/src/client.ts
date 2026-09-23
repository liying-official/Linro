export { APIError, api } from './store.mjs';

export function download(name: string, content: string, type: string): void {
  const href = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = 'DEMO-' + name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(href), 5000);
}
