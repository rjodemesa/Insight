import { dataVersion } from "@/lib/insights/cache";

/**
 * Remembers AI answers for the same input so reopening the dashboard does not pay for
 * a new Gemini call. Entries expire after an hour and whenever data changes in this process.
 */
const TTL_MS = 60 * 60_000;
const MAX = 200;
const entries = new Map<string, { at: number; version: number; value: unknown }>();

export function recall<T>(key: string, now = Date.now()): T | undefined {
  const hit = entries.get(key);
  return hit && hit.version === dataVersion() && now - hit.at < TTL_MS ? (hit.value as T) : undefined;
}

export function remember(key: string, value: unknown, now = Date.now()): void {
  if (entries.size >= MAX) entries.delete(entries.keys().next().value as string);
  entries.set(key, { at: now, version: dataVersion(), value });
}

/** Per-user cap on AI requests (single process, like the login limiter), to bound cost. */
const PER_WINDOW = 30;
const WINDOW_MS = 10 * 60_000;
const calls = new Map<number, number[]>();

/** Seconds until this user may make another AI request, or 0. Records the call when allowed. */
export function aiRetryAfter(userId: number, now = Date.now()): number {
  const list = (calls.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  calls.set(userId, list);
  if (list.length >= PER_WINDOW) return Math.ceil((WINDOW_MS - (now - list[0]!)) / 1000);
  list.push(now);
  return 0;
}
