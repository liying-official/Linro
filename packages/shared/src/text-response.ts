import { fail, text } from './http.js';
/** Plain text is data only. Never interpolate it into headers, HTML or logs. */
export function responseMode(value: unknown): 'redirect' | 'text' {
  if (value === 'redirect' || value === 'text') return value;
  return fail(400, 'invalid_response_mode', 'response_mode must be redirect or text.');
}
export function plainText(value: unknown): string {
  let body: string;
  try { body = text(value, 'text_content', 16384); }
  catch { return fail(400, 'invalid_text_content', 'Invalid plain text content.'); }
  const bytes = new TextEncoder().encode(body);
  if (!body.length || bytes.length > 32768 || new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes) !== body)
    fail(400, 'invalid_text_content', 'text_content must contain 1–16384 characters, at most 32768 UTF-8 bytes.');
  return body;
}
