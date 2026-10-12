/**
 * In-memory sliding-window limiter for login attempts.
 * Single-process only, like the job runner. Swap for a shared store if the app is scaled out.
 */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

const attempts = new Map<string, number[]>();

function recent(key: string, now: number): number[] {
  const list = (attempts.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  attempts.set(key, list);
  return list;
}

/** Returns seconds until the next attempt is allowed, or 0 when allowed. */
export function loginRetryAfter(key: string, now = Date.now()): number {
  const list = recent(key, now);
  if (list.length < MAX_ATTEMPTS) return 0;
  return Math.ceil((WINDOW_MS - (now - list[0]!)) / 1000);
}

export function recordFailedLogin(key: string, now = Date.now()): void {
  recent(key, now).push(now);
}

export function clearLoginAttempts(key: string): void {
  attempts.delete(key);
}
