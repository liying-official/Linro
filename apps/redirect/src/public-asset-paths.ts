// The release tests verify each suffix against the first 16 hex digits of the
// served content's SHA-256. Legacy paths always re-fetch the current protocol.
export const PUBLIC_ASSETS = {
  'password.css': '/__Linro_assets/password.ef45998a28c756cb.css',
  'password.js': '/__Linro_assets/password.73913afb9f8bb5d3.js',
  'browser.js': '/__Linro_assets/browser.7d0f159cb3118ab5.js',
} as const;
