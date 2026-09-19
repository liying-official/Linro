// Independent policy matrix shared by Node-handler and native-workerd tests.
// Missing values are absent headers, NOT the strings 'undefined' or 'null'.
export const acceptedOrigins = [
  ['real origin, no metadata (legacy client)', { origin: 'https://go.example.com' }],
  ['real origin, same-origin metadata', { origin: 'https://go.example.com', 'sec-fetch-site': 'same-origin' }],
  ['opaque origin, same-origin form navigation', { origin: 'null', 'sec-fetch-site': 'same-origin' }],
  ['absent origin, same-origin metadata', { 'sec-fetch-site': 'same-origin' }],
];
export const deniedOrigins = [
  ['foreign origin, cross-site', { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }],
  ['foreign origin, missing metadata', { origin: 'https://evil.example' }],
  ['foreign origin with contradictory same-origin metadata', { origin: 'https://evil.example', 'sec-fetch-site': 'same-origin' }],
  ['opaque origin, cross-site sandbox', { origin: 'null', 'sec-fetch-site': 'cross-site' }],
  ['opaque origin, same-site sibling', { origin: 'null', 'sec-fetch-site': 'same-site' }],
  ['opaque origin, no metadata', { origin: 'null' }],
  ['both headers absent', {}],
  ['absent origin, cross-site', { 'sec-fetch-site': 'cross-site' }],
  ['absent origin, same-site', { 'sec-fetch-site': 'same-site' }],
  ['real origin, contradictory cross-site metadata', { origin: 'https://go.example.com', 'sec-fetch-site': 'cross-site' }],
  ['real origin, contradictory same-site metadata', { origin: 'https://go.example.com', 'sec-fetch-site': 'same-site' }],
  ['real origin, none metadata', { origin: 'https://go.example.com', 'sec-fetch-site': 'none' }],
  ['real origin, malformed metadata', { origin: 'https://go.example.com', 'sec-fetch-site': 'same-origin, cross-site' }],
  ['nonliteral NULL origin', { origin: 'NULL', 'sec-fetch-site': 'same-origin' }],
  ['multiple origin values', { origin: 'https://go.example.com, https://evil.example', 'sec-fetch-site': 'same-origin' }],
  ['wrong scheme', { origin: 'http://go.example.com', 'sec-fetch-site': 'same-origin' }],
  ['wrong port', { origin: 'https://go.example.com:444', 'sec-fetch-site': 'same-origin' }],
];

// D3: Node Request preserves a present-but-empty header. The deployed native
// HTTP transport observed in the report drops empty/whitespace-only values.
// Keep these policy cases explicit rather than silently filtering native tests.
// tests/runtime/api-canary.test.mjs checks that transport behavior for drift.
export const deniedOriginsNodeOnly = [
  ['empty origin is not absent', { origin: '', 'sec-fetch-site': 'same-origin' }],
  ['whitespace-only origin normalizes to a present empty header', { origin: ' ', 'sec-fetch-site': 'same-origin' }],
];
