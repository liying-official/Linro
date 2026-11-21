import { base64UrlDecode, base64UrlEncode, encodeUTF8, makePurposeMac } from './encoding.js';

export const LATENCY_PATH = '/__Linro_rtt';
export const MAX_RECEIPT_CHARS = 128;
export const RTT_PROTOCOL = 'linro-rtt-v3';
export const RTT_ROUNDS = 5;
export const RTT_GAP_MS = 400;
export const RTT_TIMEOUT_MS = 30_000;
export type LatencyResult = 'match' | 'latency_mismatch' | 'latency_unavailable';

const IV_BYTES = 12;

function duration(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function edgeRtt(request: Request): number | null {
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
  const material = await makePurposeMac(secret, 'browser-rtt-websocket-v3', '');
  return crypto.subtle.importKey('raw', material, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

// The browser carries only the authenticated server verdict to the form POST.
export async function createLatencyReceipt(
  secret: string,
  challenge: string,
  result: LatencyResult,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encodeUTF8(challenge) },
    await receiptKey(secret),
    encodeUTF8(result),
  );
  return base64UrlEncode(new Uint8Array([...iv, ...new Uint8Array(encrypted)]));
}

export async function latencyResult(
  secret: string,
  challenge: string,
  receipt: string,
): Promise<LatencyResult> {
  try {
    if (!receipt || receipt.length > MAX_RECEIPT_CHARS) return 'latency_unavailable';
    const bytes = base64UrlDecode(receipt, true);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.subarray(0, IV_BYTES), additionalData: encodeUTF8(challenge) },
      await receiptKey(secret),
      bytes.subarray(IV_BYTES),
    );
    const result = new TextDecoder().decode(plain);
    return result === 'match' || result === 'latency_mismatch' ? result : 'latency_unavailable';
  } catch {
    return 'latency_unavailable';
  }
}
