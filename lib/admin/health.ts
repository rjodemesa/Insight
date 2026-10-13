import fs from "node:fs";
import type Database from "better-sqlite3";
import { verifyAuditChain } from "@/lib/audit";
import { MIGRATIONS } from "@/lib/schema";
import { nlpVersion } from "@/lib/nlp/analyze";
import { decryptValue } from "@/lib/redact/vault";

/**
 * System health for the Admin tab. Every check says ok, warn or fail with a plain-language
 * note, so an IT officer can see what needs doing without reading logs.
 */
type Conn = Database.Database;
export type Level = "ok" | "warn" | "fail";
export interface Check {
  name: string;
  level: Level;
  detail: string;
}

/** Decrypts the oldest vault row to prove PII_VAULT_KEY is the key the vault was written with. */
export function vaultKeyMatches(conn: Conn, key: Buffer | null): boolean | null {
  const row = conn.prepare("SELECT review_id, field, token, ciphertext, iv, auth_tag FROM pii_vault ORDER BY id LIMIT 1").get() as
    | { review_id: number; field: string; token: string; ciphertext: Buffer; iv: Buffer; auth_tag: Buffer }
    | undefined;
  if (!row) return null;
  if (!key) return false;
  try {
    decryptValue(key, row.review_id, row.field, row.token, { iv: row.iv, ciphertext: row.ciphertext, authTag: row.auth_tag });
    return true;
  } catch {
    return false;
  }
}

export function systemHealth(conn: Conn, opts: { dbPath: string; vaultKey: Buffer | null; vaultKeyError: string | null; ai: { label: string; configured: boolean } }) {
  const count = (sql: string, ...p: unknown[]) => conn.prepare(sql).pluck().get(...p) as number;
  const size = (f: string) => (fs.existsSync(f) ? fs.statSync(f).size : 0);
  const schema = conn.pragma("user_version", { simple: true }) as number;
  const chain = verifyAuditChain(conn);
  const vaultRows = count("SELECT COUNT(*) FROM pii_vault");
  const keyOk = vaultKeyMatches(conn, opts.vaultKey);
  const stale = count("SELECT COUNT(*) FROM reviews WHERE nlp_version IS NULL OR nlp_version <> ?", nlpVersion());
  const stuck = count("SELECT COUNT(*) FROM ingest_jobs WHERE status IN ('queued','running') AND started_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 hours')");
  const officers = count("SELECT COUNT(*) FROM users WHERE role = 'it_officer' AND disabled = 0");
  const pendingAlerts = count("SELECT COUNT(*) FROM alerts WHERE status = 'proposed'");
  const lastImport = conn.prepare("SELECT filename, status, finished_at AS finishedAt FROM ingest_jobs ORDER BY id DESC LIMIT 1").get() as
    | { filename: string; status: string; finishedAt: string | null }
    | undefined;

  const checks: Check[] = [
    { name: "Database schema", level: schema === MIGRATIONS.length ? "ok" : "fail", detail: `Version ${schema} of ${MIGRATIONS.length}.` },
    {
      name: "Audit chain", level: chain.ok ? "ok" : "fail",
      detail: chain.ok ? `${chain.checked.toLocaleString()} entries verified; none altered.` : `Entry ${chain.brokenAt} does not match the chain: the log was edited outside the app.`,
    },
    {
      name: "PII vault key",
      level: opts.vaultKeyError ? "fail" : keyOk === false ? "fail" : "ok",
      detail: opts.vaultKeyError
        ?? (keyOk === null ? "Configured. The vault is empty, so there is nothing to test it against."
          : keyOk ? `Configured and matches the vault (${vaultRows.toLocaleString()} entries).`
            : "Configured, but it does not decrypt the vault: it is not the key the data was imported with."),
    },
    { name: "AI provider", level: opts.ai.configured ? "ok" : "warn", detail: opts.ai.configured ? opts.ai.label : `${opts.ai.label}: GEMINI_API_KEY is empty.` },
    {
      name: "Tagging up to date", level: stale ? "warn" : "ok",
      detail: stale ? `${stale.toLocaleString()} reviews use an older taxonomy or lexicon. Stop the server and run npm run reprocess.` : `All reviews tagged with ${nlpVersion()}.`,
    },
    { name: "Imports", level: stuck ? "warn" : "ok", detail: stuck ? `${stuck} import(s) have been running for over 2 hours.` : lastImport ? `Last: ${lastImport.filename} (${lastImport.status}).` : "No imports yet." },
    { name: "IT officers", level: officers >= 2 ? "ok" : "warn", detail: officers >= 2 ? `${officers} active.` : "Only one active IT officer. Add a second so the account cannot become a single point of failure." },
  ];
  return {
    checks,
    stats: {
      reviews: count("SELECT COUNT(*) FROM reviews"),
      products: count("SELECT COUNT(*) FROM products"),
      imports: count("SELECT COUNT(*) FROM ingest_jobs"),
      vaultEntries: vaultRows,
      users: count("SELECT COUNT(*) FROM users"),
      activeSessions: count("SELECT COUNT(*) FROM sessions WHERE expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')"),
      auditEntries: chain.checked,
      pendingAlerts,
      aiTaggedReviews: count("SELECT COUNT(*) FROM reviews WHERE ai_version IS NOT NULL"),
      dbBytes: size(opts.dbPath) + size(`${opts.dbPath}-wal`),
      node: process.version,
    },
  };
}

/** AI calls in the last `days` days, from the audit log, with token totals where the provider reports them. */
export function aiUsage(conn: Conn, days = 7) {
  return conn
    .prepare(
      `SELECT action, status, COUNT(*) AS calls,
         SUM(COALESCE(json_extract(details, '$.tokens.prompt'), 0)) AS promptTokens,
         SUM(COALESCE(json_extract(details, '$.tokens.output'), 0)) AS outputTokens
       FROM audit_log WHERE ai_provider IS NOT NULL AND ts >= strftime('%Y-%m-%dT%H:%M:%fZ','now', ?)
       GROUP BY action, status ORDER BY calls DESC`,
    )
    .all(`-${days} days`) as { action: string; status: string; calls: number; promptTokens: number; outputTokens: number }[];
}
