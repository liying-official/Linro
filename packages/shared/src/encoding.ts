const encoder = new TextEncoder();

export const encodeUTF8 = (value: string): Uint8Array => encoder.encode(value);

export function base64UrlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function base64UrlDecode(value: string, canonical = false): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid encoding.');
  const bytes = Uint8Array.from(
    atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4)),
    (character) => character.charCodeAt(0),
  );
  if (canonical && base64UrlEncode(bytes) !== value) throw new Error('Noncanonical encoding.');
  return bytes;
}

export function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.length ^ right.length;
  for (let index = 0; index < left.length; index++) {
    difference |= left[index]! ^ (right[index] ?? 0);
  }
  return difference === 0;
}

export function validPurposeSecret(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43,128}$/.test(value);
}

export async function makePurposeMac(
  secret: string,
  purpose: string,
  value: string,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    encodeUTF8(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const input = encodeUTF8(`cf-links:${purpose}\0${value}`);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, input));
}
