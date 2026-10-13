/**
 * Change detection for trends (DERIVED). A change between two periods is "significant"
 * when a two-proportion z-test gives |z| ≥ 1.96 (about 95% confidence) and both periods
 * have at least MIN_N reviews. Small samples are reported but never flagged.
 */
export const MIN_N = 30;
export const Z_CRITICAL = 1.96;

export interface ProportionChange {
  current: number | null;
  previous: number | null;
  /** current − previous, in percentage points. */
  diffPts: number | null;
  z: number | null;
  significant: boolean;
  direction: "up" | "down" | "flat";
}

export function compareProportions(x1: number, n1: number, x0: number, n0: number): ProportionChange {
  const p1 = n1 ? x1 / n1 : null;
  const p0 = n0 ? x0 / n0 : null;
  let z: number | null = null;
  if (p1 !== null && p0 !== null) {
    const pooled = (x1 + x0) / (n1 + n0);
    const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n0));
    z = se === 0 ? 0 : (p1 - p0) / se;
  }
  const significant = z !== null && n1 >= MIN_N && n0 >= MIN_N && Math.abs(z) >= Z_CRITICAL;
  const diff = p1 !== null && p0 !== null ? p1 - p0 : null;
  const r = (x: number | null, d = 1000) => (x === null ? null : Math.round(x * d) / d);
  return {
    current: r(p1),
    previous: r(p0),
    diffPts: diff === null ? null : Math.round(diff * 1000) / 10,
    z: r(z, 100),
    significant,
    direction: !significant || diff === null || diff === 0 ? "flat" : diff > 0 ? "up" : "down",
  };
}

/** ISO date string (YYYY-MM-DD) `days` days before `iso`. */
export function daysBefore(iso: string, days: number): string {
  return new Date(Date.parse(iso.slice(0, 10) + "T00:00:00Z") - days * 86_400_000).toISOString().slice(0, 10);
}
