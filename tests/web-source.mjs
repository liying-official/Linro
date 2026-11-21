import { readdirSync, readFileSync } from 'node:fs';

/** Follow the web module split so source-wiring assertions cover every page. */
export function readWebSource() {
  const readTree = directory =>
    readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))
      .flatMap(entry => {
        const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
        if (entry.isDirectory()) return readTree(path);
        return /\.tsx?$/.test(entry.name) ? [readFileSync(path, 'utf8')] : [];
      });
  return readTree(new URL('../apps/admin/src/web/', import.meta.url)).join('\n');
}
