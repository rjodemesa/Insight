/**
 * Structured server log (one JSON object per line). Never pass review text, names,
 * emails or other personal data in `fields`.
 */
export function log(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields });
  if (level === "error") console.error(line);
  else console.log(line);
}
