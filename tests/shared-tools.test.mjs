import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readBoundedBody } from '../.build/packages/shared/src/body.js';
import { HttpError } from '../.build/packages/shared/src/http.js';
import {
  base64UrlDecode,
  base64UrlEncode,
  constantTimeEqual,
  makePurposeMac,
  validPurposeSecret,
} from '../.build/packages/shared/src/encoding.js';
import { escapeHTML } from '../.build/packages/shared/src/html.js';

test('shared base64url preserves binary values and the existing canonical/relaxed distinction', () => {
  const binary = Uint8Array.from([0, 1, 127, 128, 254, 255]);
  const expected = Buffer.from(binary).toString('base64url');
  assert.equal(base64UrlEncode(binary), expected);
  assert.deepEqual(base64UrlDecode(expected, true), binary);
  assert.deepEqual(base64UrlDecode('_x'), Uint8Array.of(255));
  assert.throws(() => base64UrlDecode('_x', true), /Noncanonical/);
  for (const value of ['', 'a', 'AA=', 'AA+', 'AA/', ' AA']) {
    assert.throws(() => base64UrlDecode(value, true));
  }
});

test('shared comparison rejects differing bytes, lengths and zero-padded extensions', () => {
  const left = Uint8Array.of(1, 2, 3);
  assert.equal(constantTimeEqual(left, left.slice()), true);
  for (const right of [Uint8Array.of(9, 2, 3), Uint8Array.of(1, 2, 9), Uint8Array.of(1, 2), Uint8Array.of(1, 2, 3, 0)]) {
    assert.equal(constantTimeEqual(left, right), false);
  }
});

test('purpose MACs retain legacy signing bytes and do not cross password/browser purposes', async () => {
  const secret = 'A'.repeat(43);
  const value = 'fixture-token';
  const purposes = ['password-pepper-v1', 'unlock-cookie-v1', 'browser-challenge-v1', 'browser-proof-v1'];
  const signatures = [];
  for (const purpose of purposes) {
    const expected = createHmac('sha256', secret).update(`cf-links:${purpose}\0${value}`).digest();
    const actual = await makePurposeMac(secret, purpose, value);
    assert.deepEqual(Buffer.from(actual), expected);
    signatures.push(base64UrlEncode(actual));
  }
  assert.equal(new Set(signatures).size, purposes.length);
});

test('purpose-secret validation keeps the original alphabet and 43–128 character bounds', () => {
  for (const length of [43, 128]) assert.equal(validPurposeSecret('A'.repeat(length)), true);
  for (const value of [null, 43, 'A'.repeat(42), 'A'.repeat(129), 'A'.repeat(42) + '=', 'A'.repeat(42) + '\n']) {
    assert.equal(validPurposeSecret(value), false);
  }
});

test('shared HTML escaping covers all attribute/text delimiters and preserves Unicode', () => {
  assert.equal(escapeHTML(`&<>"' 中文`), '&amp;&lt;&gt;&quot;&#39; 中文');
  assert.equal(escapeHTML('safe/path?name=Linro'), 'safe/path?name=Linro');
});

const options = { maxBytes: 4, emptyCode: 'fixture_empty', emptyMessage: 'Body required.' };
const rejected = (status, code) => error => error instanceof HttpError && error.status === status && error.code === code;

test('bounded reader returns complete multi-chunk data at the exact byte limit', async () => {
  const stream = new ReadableStream({ start(controller) {
    controller.enqueue(Uint8Array.of(1, 2));
    controller.enqueue(Uint8Array.of(3, 4));
    controller.close();
  } });
  const request = new Request('https://fixture.invalid/', { method: 'POST', body: stream, duplex: 'half' });
  assert.deepEqual(await readBoundedBody(request, options), Uint8Array.of(1, 2, 3, 4));
  assert.equal(stream.locked, false);
});

for (const declaredLength of [undefined, '1']) {
  test(`bounded reader cancels oversized streamed data even with Content-Length=${declaredLength}`, async () => {
    let cancelled = false;
    const stream = new ReadableStream({ start(controller) {
      controller.enqueue(Uint8Array.of(1, 2));
      controller.enqueue(Uint8Array.of(3, 4, 5));
    }, cancel() { cancelled = true; } });
    const request = new Request('https://fixture.invalid/', {
      method: 'POST', body: stream, duplex: 'half',
      headers: declaredLength === undefined ? {} : { 'content-length': declaredLength },
    });
    await assert.rejects(readBoundedBody(request, options), rejected(413, 'body_too_large'));
    assert.equal(cancelled, true);
    assert.equal(stream.locked, false);
  });
}

test('bounded reader rejects declared oversize before acquiring the stream', async () => {
  const request = new Request('https://fixture.invalid/', { method: 'POST', body: 'a', headers: { 'content-length': '5' } });
  await assert.rejects(readBoundedBody(request, options), rejected(413, 'body_too_large'));
  assert.equal(request.bodyUsed, false);
});

test('bounded reader preserves caller-specific missing-body errors', async () => {
  await assert.rejects(readBoundedBody(new Request('https://fixture.invalid/'), options), rejected(400, 'fixture_empty'));
});
