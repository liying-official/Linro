const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHTML(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ENTITIES[character]!);
}
