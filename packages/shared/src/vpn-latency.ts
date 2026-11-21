import { base64UrlDecode, base64UrlEncode, encodeUTF8, makePurposeMac } from './encoding.js';

export const LATENCY_PATH = '/__Linro_rtt';
export const MAX_RECEIPT_CHARS = 128;
const MAX_DIFFERENCE_MS = 50;
const IV_BYTES = 12;

function duration(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function edgeRtt(request: Request): number | null {
  const cf = (
    request as Request & {
      cf?: { clientTcpRtt?: unknown; clientQuicRtt?: unknown; httpProtocol?: string };
    }
  ).cf;
  // With an explicit transport, only its metadata applies. Older/dev inputs
  // can omit the protocol and still supply a single trusted transport field.
  const rtt =
    cf?.httpProtocol === 'HTTP/3'
      ? cf.clientQuicRtt
      : cf?.httpProtocol
        ? cf.clientTcpRtt
        : (cf?.clientTcpRtt ?? cf?.clientQuicRtt);
  return duration(rtt) ? rtt : null;
}

async function receiptKey(secret: string): Promise<CryptoKey> {
  const material = await makePurposeMac(secret, 'browser-rtt-single-v2', '');
  return crypto.subtle.importKey('raw', material, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

// Seal only this request's trusted edge RTT. Binding the challenge as AAD keeps
// receipts opaque and unusable with a different challenge or the old protocol.
export async function createLatencyReceipt(
  request: Request,
  secret: string,
  challenge: string,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encodeUTF8(challenge) },
    await receiptKey(secret),
    encodeUTF8(JSON.stringify(edgeRtt(request))),
  );
  return base64UrlEncode(new Uint8Array([...iv, ...new Uint8Array(encrypted)]));
}

export async function latencyResult(
  secret: string,
  challenge: string,
  evidence: string,
): Promise<'match' | 'latency_mismatch' | 'latency_unavailable'> {
  try {
    const report: { receipt?: unknown; elapsed?: unknown } | null = JSON.parse(evidence);
    if (
      !duration(report?.elapsed) ||
      typeof report?.receipt !== 'string' ||
      report.receipt.length > MAX_RECEIPT_CHARS
    )
      return 'latency_unavailable';
    const bytes = base64UrlDecode(report.receipt, true);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.subarray(0, IV_BYTES), additionalData: encodeUTF8(challenge) },
      await receiptKey(secret),
      bytes.subarray(IV_BYTES),
    );
    const rtt: unknown = JSON.parse(new TextDecoder().decode(plain));
    if (!duration(rtt)) return 'latency_unavailable';
    return Math.abs(report.elapsed - rtt) > MAX_DIFFERENCE_MS ? 'latency_mismatch' : 'match';
  } catch {
    return 'latency_unavailable';
  }
}
