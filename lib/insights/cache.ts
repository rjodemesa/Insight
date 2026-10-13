/**
 * Short-lived cache for aggregate responses, keyed by route and query string.
 * Aggregates over 75k reviews take 0.1–0.9 s each and the dashboard asks for several at
 * once on one SQLite connection, so repeat views are served from memory.
 *
 * Anything that changes reviews or products in this process calls bumpDataVersion(),
 * which empties the cache. Changes made by another process (`npm run reprocess`) show up
 * once entries expire after TTL_MS.
 */
export const TTL_MS = 5 * 60_000;
const MAX_ENTRIES = 300;

let version = 0;
const entries = new Map<string, { at: number; version: number; value: unknown }>();

export function bumpDataVersion(): void {
  version++;
  entries.clear();
}

export function cached<T>(key: string, compute: () => T, now = Date.now()): T {
  const hit = entries.get(key);
  if (hit && hit.version === version && now - hit.at < TTL_MS) return hit.value as T;
  const value = compute();
  if (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value as string);
  entries.set(key, { at: now, version, value });
  return value;
}

/** Cache key that ignores parameter order. */
export function cacheKey(path: string, sp: URLSearchParams): string {
  const pairs = [...sp.entries()].sort(([a, x], [b, y]) => a.localeCompare(b) || x.localeCompare(y));
  return `${path}?${new URLSearchParams(pairs).toString()}`;
}

/** Changes whenever reviews or products change in this process. Part of longer-lived cache keys. */
export function dataVersion(): number {
  return version;
}
