export interface StatsLink {
  id: string;
  hostname: string;
  slug: string;
}

// Enforce the picker projection at the client boundary too.
export function pickerRows(rows: StatsLink[]): StatsLink[] {
  return rows.map(({ id, hostname, slug }) => ({ id, hostname, slug }));
}

export function selectedRows(ids: string[], current: StatsLink[], page: StatsLink[]) {
  const labels = new Map([...current, ...page].map((row) => [row.id, row]));
  return [...new Set(ids)]
    .slice(0, 50)
    .map((id) => labels.get(id) ?? { id, hostname: '', slug: '' });
}

export function toggleRow(current: StatsLink[], row: StatsLink, checked: boolean) {
  if (!checked) return current.filter((item) => item.id !== row.id);
  if (current.length >= 50 || current.some((item) => item.id === row.id)) return current;
  return [...current, row];
}

export function linkPagePath(params: URLSearchParams, cursor?: string) {
  params.set('pagination', 'cursor');
  if (cursor) params.set('cursor', cursor);
  return '/links?' + params;
}
