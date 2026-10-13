import type Database from "better-sqlite3";

/**
 * Read side of the audit log. Users see their own entries; IT officers see everyone's.
 * Filters are allow-listed and bound as parameters.
 */
type Conn = Database.Database;

export class AuditQueryError extends Error {}

export interface AuditQuery {
  /** Restrict to this user (always set for non-IT users). */
  userId: number | null;
  action: string | null;
  status: string | null;
  entityType: string | null;
  from: string | null;
  to: string | null;
  limit: number;
  offset: number;
}

export interface AuditRow {
  id: number;
  ts: string;
  userId: number | null;
  email: string | null;
  role: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  details: Record<string, unknown> | null;
  ip: string | null;
  aiProvider: string | null;
  aiModel: string | null;
  aiVersion: string | null;
  promptHash: string | null;
  status: string;
  hash: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseAuditQuery(sp: URLSearchParams, forcedUserId: number | null): AuditQuery {
  const str = (k: string) => {
    const v = sp.get(k)?.trim();
    if (!v) return null;
    if (v.length > 60 || !/^[\w.:-]+$/.test(v)) throw new AuditQueryError(`Bad value for "${k}".`);
    return v;
  };
  const date = (k: string) => {
    const v = sp.get(k)?.trim();
    if (!v) return null;
    if (!DATE.test(v)) throw new AuditQueryError(`"${k}" must be a date like 2024-01-31.`);
    return v;
  };
  const int = (k: string, def: number, max: number) => {
    const v = sp.get(k);
    if (v === null || v === "") return def;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > max) throw new AuditQueryError(`"${k}" must be a whole number up to ${max}.`);
    return n;
  };
  const user = sp.get("user");
  let userId = forcedUserId;
  if (forcedUserId === null && user) {
    userId = Number(user);
    if (!Number.isInteger(userId) || userId <= 0) throw new AuditQueryError("user must be a user id.");
  }
  return {
    userId, action: str("action"), status: str("status"), entityType: str("entityType"),
    from: date("from"), to: date("to"), limit: Math.max(1, int("limit", 50, 500)), offset: int("offset", 0, 10_000_000),
  };
}

function where(q: AuditQuery) {
  const parts: string[] = [];
  const params: (string | number)[] = [];
  if (q.userId !== null) { parts.push("a.user_id = ?"); params.push(q.userId); }
  if (q.action) { parts.push("a.action = ?"); params.push(q.action); }
  if (q.status) { parts.push("a.status = ?"); params.push(q.status); }
  if (q.entityType) { parts.push("a.entity_type = ?"); params.push(q.entityType); }
  if (q.from) { parts.push("a.ts >= ?"); params.push(`${q.from}T00:00:00`); }
  if (q.to) { parts.push("a.ts < date(?, '+1 day')"); params.push(q.to); }
  return { sql: parts.length ? parts.join(" AND ") : "1=1", params };
}

const SELECT = `SELECT a.id, a.ts, a.user_id AS userId, u.email, a.role, a.action, a.entity_type AS entityType, a.entity_id AS entityId,
  a.details, a.ip, a.ai_provider AS aiProvider, a.ai_model AS aiModel, a.ai_version AS aiVersion, a.prompt_hash AS promptHash, a.status, a.hash
  FROM audit_log a LEFT JOIN users u ON u.id = a.user_id`;

function parseDetails(s: string | null): Record<string, unknown> | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return { raw: s.slice(0, 500) };
  }
}

export function listAudit(conn: Conn, q: AuditQuery) {
  const w = where(q);
  const total = conn.prepare(`SELECT COUNT(*) FROM audit_log a WHERE ${w.sql}`).pluck().get(...w.params) as number;
  const rows = conn.prepare(`${SELECT} WHERE ${w.sql} ORDER BY a.id DESC LIMIT ? OFFSET ?`).all(...w.params, q.limit, q.offset) as (Omit<AuditRow, "details"> & { details: string | null })[];
  const scope = q.userId === null ? "" : "WHERE user_id = ?";
  const facets = (col: string) =>
    (conn.prepare(`SELECT ${col} AS v, COUNT(*) AS n FROM audit_log ${scope} GROUP BY ${col} ORDER BY n DESC`).all(...(q.userId === null ? [] : [q.userId])) as { v: string | null; n: number }[])
      .filter((r) => r.v !== null) as { v: string; n: number }[];
  return {
    total, limit: q.limit, offset: q.offset,
    entries: rows.map((r) => ({ ...r, details: parseDetails(r.details) })),
    actions: facets("action"),
    statuses: facets("status"),
  };
}

/** Every matching entry as CSV, oldest first. Cells that a spreadsheet would run as formulas are quoted with a leading apostrophe. */
export function* auditCsv(conn: Conn, q: AuditQuery): Generator<string> {
  const w = where(q);
  const cols = ["id", "ts", "userId", "email", "role", "action", "entityType", "entityId", "status", "ip", "aiProvider", "aiModel", "aiVersion", "promptHash", "details", "hash"] as const;
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  yield `${cols.join(",")}\r\n`;
  for (const r of conn.prepare(`${SELECT} WHERE ${w.sql} ORDER BY a.id`).iterate(...w.params) as IterableIterator<Record<string, unknown>>) {
    yield `${cols.map((c) => cell(r[c])).join(",")}\r\n`;
  }
}
