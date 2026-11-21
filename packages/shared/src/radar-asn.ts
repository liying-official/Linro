import type { RedirectEnv } from './platform.js';
import { sha256 } from './crypto.js';

const CLASSIFIED_TTL = 86400;
const UNCLASSIFIED_TTL = 300;
const FETCH_TIMEOUT_MS = 3000;
const FLIGHT_LIFETIME_MS = 4500;
const FAILURE_COOLDOWN_MS = 5000;
const MAX_COOLDOWN_MS = 300_000;
const MAX_KEYS = 256;
const classifications = ['ACCESS_ISP', 'HOSTING_CLOUD_CONTENT', 'ORGANIZATION'] as const;
type Classification = (typeof classifications)[number] | 'UNCLASSIFIED';
type Slot = { until: number; work?: Promise<Classification | null> };
const slots = new Map<string, Slot>();

export function requestASN(request: Request): number | null {
  const asn = (request as Request & { cf?: { asn?: unknown } }).cf?.asn;
  return typeof asn === 'number' && Number.isInteger(asn) && asn > 0 && asn <= 0xffffffff
    ? asn
    : null;
}

function classified(value: unknown): value is (typeof classifications)[number] {
  return classifications.some((category) => category === value);
}

function retryDelay(header: string | null): number {
  if (!header) return FAILURE_COOLDOWN_MS;
  const value = header.trim();
  const delay = /^\d+$/.test(value)
    ? Number(value) * 1000
    : /^[A-Z][a-z]{2}, /.test(value)
      ? Date.parse(value) - Date.now()
      : NaN;
  return Number.isNaN(delay)
    ? FAILURE_COOLDOWN_MS
    : Math.max(1000, Math.min(MAX_COOLDOWN_MS, delay));
}

async function fetchCategory(
  asn: number,
  token: string,
): Promise<{ category: Classification | null; cooldown: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let cooldown = FAILURE_COOLDOWN_MS;
  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/radar/entities/asns/${asn}`,
      {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        redirect: 'manual',
        signal: controller.signal,
      },
    );
    if (response.status === 429 || response.status === 503)
      cooldown = retryDelay(response.headers.get('retry-after'));
    if (!response.ok) return { category: null, cooldown };
    const data = await response.json();
    const entity = data?.result?.asn;
    if (data?.success !== true || entity?.asn !== asn) return { category: null, cooldown };
    if (entity.category === null) return { category: 'UNCLASSIFIED', cooldown: 0 };
    return classified(entity.category)
      ? { category: entity.category, cooldown: 0 }
      : { category: null, cooldown };
  } catch {
    return { category: null, cooldown };
  } finally {
    clearTimeout(timeout);
  }
}

// Each waiter owns its deadline. Only a settled scalar crosses request contexts,
// never an upstream Response, stream or Cache handle. If the owner disconnects,
// waiting invocations can still finish and a later visit can replace its slot.
async function waitForSlot(slot: Slot): Promise<Classification | null> {
  if (!slot.work) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      slot.work,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), Math.max(0, slot.until - Date.now()));
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function readEdge(key: string): Promise<{ cache?: Cache; category: Classification | null }> {
  let cache: Cache | undefined;
  try {
    cache = await caches.open('linro-radar-asns-v2');
    const hit = await cache.match(key);
    const value = hit && (await hit.text());
    if (classified(value) || value === 'UNCLASSIFIED') return { cache, category: value };
  } catch {
    // A cache failure falls through to a current Radar lookup.
  }
  return { cache, category: null };
}

async function resolveSlot(
  key: string,
  slot: Slot,
  asn: number,
  token: string,
): Promise<Classification | null> {
  const live = () => slots.get(key) === slot && Date.now() < slot.until;
  const edge = await readEdge(key);
  if (!live()) return null;
  if (edge.category !== null) {
    slots.delete(key);
    return edge.category;
  }
  const { category, cooldown } = await fetchCategory(asn, token);
  if (!live()) return null;
  if (category === null) {
    slots.set(key, { until: Date.now() + cooldown });
    return null;
  }
  try {
    await edge.cache?.put(
      key,
      new Response(category, {
        headers: {
          'Cache-Control': `public, max-age=${category === 'UNCLASSIFIED' ? UNCLASSIFIED_TTL : CLASSIFIED_TTL}`,
        },
      }),
    );
  } catch {
    // The current response still has a fresh, validated classification.
  }
  if (!live()) return null;
  slots.delete(key);
  return category;
}

export async function radarClassification(
  request: Request,
  env: RedirectEnv,
): Promise<Classification | null> {
  const asn = requestASN(request);
  const token = env.RADAR_API_TOKEN?.trim();
  if (asn === null || !token) return null;
  const scope = await sha256(JSON.stringify([env.ADMIN_ORIGIN, env.CLOUDFLARE_ACCOUNT_ID, token]));
  const key = new URL(`/__Linro_radar_asn/v2/${scope}/${asn}`, new URL(request.url).origin).href;
  const now = Date.now();
  const existing = slots.get(key);
  if (existing && existing.until > now) return waitForSlot(existing);
  if (slots.size >= MAX_KEYS) {
    for (const [name, slot] of slots) if (slot.until <= now) slots.delete(name);
    if (slots.size >= MAX_KEYS) return (await readEdge(key)).category;
  }
  // Reserve synchronously before the first cache access. A slow cache miss in
  // one visitor cannot launch a second fetch after another visitor fills it.
  const slot: Slot = { until: now + FLIGHT_LIFETIME_MS };
  slots.set(key, slot);
  slot.work = resolveSlot(key, slot, asn, token);
  return waitForSlot(slot);
}
