/** Display formatting shared by charts, tiles and tables. Locale en-PH, times in Asia/Manila. */
export const num = (x: number | null | undefined) => (x === null || x === undefined ? "–" : x.toLocaleString("en-PH"));

export const pct = (x: number | null | undefined, digits = 1) =>
  x === null || x === undefined ? "–" : `${(x * 100).toFixed(digits).replace(/\.0$/, "")}%`;

/** 1,284 · 12.9K · 1.2M */
export const compact = (x: number | null | undefined) =>
  x === null || x === undefined ? "–" : Intl.NumberFormat("en-PH", { notation: "compact", maximumFractionDigits: 1 }).format(x);

export const manila = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }) : "–";

export const day = (iso: string | null | undefined) =>
  iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-PH", { timeZone: "UTC", dateStyle: "medium" }) : "–";

/** "2024-03" → "Mar 2024" */
export const month = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return y && m ? new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-PH", { timeZone: "UTC", month: "short", year: "numeric" }) : ym;
};

/** Last day of a "YYYY-MM" month, as YYYY-MM-DD. */
export const monthEnd = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);
};

export const duration = (ms: number | null | undefined) => {
  if (ms === null || ms === undefined) return "–";
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))} s`;
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
};
