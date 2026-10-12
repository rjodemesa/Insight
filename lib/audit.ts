import crypto from "node:crypto";
import type Database from "better-sqlite3";

export const GENESIS_HASH = "0".repeat(64);

export interface AuditEntry {
  userId?: number | null;
  role?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  /** JSON-serialisable. Never put raw PII here. */
  details?: Record<string, unknown> | null;
  ip?: string | null;
  userAgent?: string | null;
  aiProvider?: string | null;
  aiModel?: string | null;
  aiVersion?: string | null;
  promptHash?: string | null;
  status?: string;
}

const FIELDS = ["ts", "user_id", "role", "action", "entity_type", "entity_id", "details", "ip",
  "user_agent", "ai_provider", "ai_model", "ai_version", "prompt_hash", "status"] as const;
type Field = (typeof FIELDS)[number];
type HashedFields = Record<Field, string | number | null>;
type Row = HashedFields & { id: number; prev_hash: string; hash: string };

function computeHash(prev: string, r: HashedFields): string {
  const payload = JSON.stringify(FIELDS.map((f) => r[f] ?? null));
  return crypto.createHash("sha256").update(prev).update(payload).digest("hex");
}

/** Appends one entry. Its hash covers every field plus the previous entry's hash. */
export function appendAudit(conn: Database.Database, e: AuditEntry): number {
  const run = conn.transaction(() => {
    const last = conn.prepare("SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1").get() as
      | { hash: string }
      | undefined;
    const prev = last?.hash ?? GENESIS_HASH;
    const row: HashedFields = {
      ts: new Date().toISOString(),
      user_id: e.userId ?? null,
      role: e.role ?? null,
      action: e.action,
      entity_type: e.entityType ?? null,
      entity_id: e.entityId ?? null,
      details: e.details ? JSON.stringify(e.details) : null,
      ip: e.ip ?? null,
      user_agent: e.userAgent ?? null,
      ai_provider: e.aiProvider ?? null,
      ai_model: e.aiModel ?? null,
      ai_version: e.aiVersion ?? null,
      prompt_hash: e.promptHash ?? null,
      status: e.status ?? "ok",
    };
    const hash = computeHash(prev, row);
    const info = conn
      .prepare(
        `INSERT INTO audit_log (${FIELDS.join(",")}, prev_hash, hash)
         VALUES (${FIELDS.map((f) => "@" + f).join(",")}, @prev_hash, @hash)`,
      )
      .run({ ...row, prev_hash: prev, hash });
    return Number(info.lastInsertRowid);
  });
  return run.immediate();
}

/** Walks the chain from the start. Returns the id of the first broken entry, if any. */
export function verifyAuditChain(conn: Database.Database): { ok: boolean; brokenAt: number | null; checked: number } {
  let prev = GENESIS_HASH;
  let checked = 0;
  for (const r of conn.prepare("SELECT * FROM audit_log ORDER BY id").iterate() as IterableIterator<Row>) {
    if (r.prev_hash !== prev || computeHash(prev, r) !== r.hash) return { ok: false, brokenAt: r.id, checked };
    prev = r.hash;
    checked++;
  }
  return { ok: true, brokenAt: null, checked };
}
