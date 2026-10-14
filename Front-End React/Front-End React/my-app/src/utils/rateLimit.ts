// Client-side rate limiter (per-endpoint) với xếp hàng tuần tự
const RATE_WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;
const MIN_SPACING_MS = 1_100;

type Bucket = { lastHit: number; hits: number[]; chain: Promise<any> };
const _rlBuckets: Record<string, Bucket> = {};

function endpointKey(url: string) {
  try {
    const u = new URL(url, window.location.origin);
    return u.pathname;
  } catch {
    const qIdx = url.indexOf("?");
    return qIdx >= 0 ? url.slice(0, qIdx) : url;
  }
}

export async function rateLimit(url: string) {
  const key = endpointKey(url);
  if (!_rlBuckets[key]) _rlBuckets[key] = { lastHit: 0, hits: [], chain: Promise.resolve() };
  const b = _rlBuckets[key];

  b.chain = b.chain.then(async () => {
    const now = Date.now();
    const elapsed = now - b.lastHit;
    if (elapsed < MIN_SPACING_MS) {
      await new Promise((r) => setTimeout(r, MIN_SPACING_MS - elapsed));
    }

    const now2 = Date.now();
    b.hits = b.hits.filter((t) => now2 - t < RATE_WINDOW_MS);
    if (b.hits.length >= MAX_PER_WINDOW) {
      const wait = RATE_WINDOW_MS - (now2 - b.hits[0]);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      const now3 = Date.now();
      b.hits = b.hits.filter((t) => now3 - t < RATE_WINDOW_MS);
    }

    b.lastHit = Date.now();
    b.hits.push(b.lastHit);
  });

  await b.chain;
}