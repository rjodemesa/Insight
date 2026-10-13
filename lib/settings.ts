import type Database from "better-sqlite3";

/**
 * Editable assumptions behind ESTIMATED figures, stored in the `settings` table.
 * Each has a default, an allowed range and a plain-language description for the UI.
 */
export const ESTIMATE_SETTINGS = {
  minutesPerRecord: {
    key: "estimate.minutes_per_record",
    default: 1.5,
    min: 0.1,
    max: 60,
    label: "Minutes an analyst spends reading and tagging one review by hand",
  },
} as const;

export type EstimateKey = keyof typeof ESTIMATE_SETTINGS;
export type Estimates = Record<EstimateKey, number>;

export function getEstimates(conn: Database.Database): Estimates {
  const out = {} as Estimates;
  for (const [name, s] of Object.entries(ESTIMATE_SETTINGS) as [EstimateKey, (typeof ESTIMATE_SETTINGS)[EstimateKey]][]) {
    const v = conn.prepare("SELECT value FROM settings WHERE key = ?").pluck().get(s.key) as string | undefined;
    const n = Number(v);
    out[name] = v !== undefined && Number.isFinite(n) && n >= s.min && n <= s.max ? n : s.default;
  }
  return out;
}

/** Validates and saves the given values. Returns an error message, or null when saved. */
export function setEstimates(conn: Database.Database, values: Record<string, unknown>): string | null {
  const updates: [string, number][] = [];
  for (const [name, raw] of Object.entries(values)) {
    const s = ESTIMATE_SETTINGS[name as EstimateKey];
    if (!s) return `Unknown setting "${name.slice(0, 40)}".`;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < s.min || n > s.max) return `${s.label} must be between ${s.min} and ${s.max}.`;
    updates.push([s.key, n]);
  }
  const upsert = conn.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  conn.transaction(() => updates.forEach(([k, v]) => upsert.run(k, String(v))))();
  return null;
}
