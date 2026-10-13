import type Database from "better-sqlite3";

/**
 * Irreversible deletes for IT officers. The audit log is never purged (it is append-only),
 * so every purge stays on record. Deleting an import removes its reviews and, through
 * foreign keys, their tags, vault entries and feedback; products left with no reviews go too.
 * Purging the vault makes redaction permanent: tokens stay in the text, originals are gone.
 */
type Conn = Database.Database;

export class PurgeError extends Error {}

export function listImports(conn: Conn) {
  return conn
    .prepare(
      `SELECT j.id, j.filename, j.status, j.started_at AS startedAt, j.finished_at AS finishedAt, u.email AS startedBy,
         (SELECT COUNT(*) FROM reviews r WHERE r.ingest_id = j.id) AS reviews,
         (SELECT COUNT(*) FROM pii_vault v JOIN reviews r ON r.id = v.review_id WHERE r.ingest_id = j.id) AS vaultEntries
       FROM ingest_jobs j LEFT JOIN users u ON u.id = j.started_by ORDER BY j.id DESC`,
    )
    .all() as { id: number; filename: string; status: string; startedAt: string | null; finishedAt: string | null; startedBy: string | null; reviews: number; vaultEntries: number }[];
}

export function purgeImport(conn: Conn, jobId: number, confirm: unknown) {
  const job = conn.prepare("SELECT id, filename, status FROM ingest_jobs WHERE id = ?").get(jobId) as { id: number; filename: string; status: string } | undefined;
  if (!job) throw new PurgeError("Import not found.");
  if (job.status === "queued" || job.status === "running") throw new PurgeError("Cancel the import before purging it.");
  if (confirm !== job.filename) throw new PurgeError(`Type the file name (${job.filename}) to confirm.`);
  return conn.transaction(() => {
    const reviews = conn.prepare("SELECT COUNT(*) FROM reviews WHERE ingest_id = ?").pluck().get(jobId) as number;
    const vault = conn.prepare("SELECT COUNT(*) FROM pii_vault v JOIN reviews r ON r.id = v.review_id WHERE r.ingest_id = ?").pluck().get(jobId) as number;
    conn.prepare("DELETE FROM ingest_jobs WHERE id = ?").run(jobId);
    const products = conn.prepare("DELETE FROM products WHERE NOT EXISTS (SELECT 1 FROM reviews r WHERE r.product_id = products.id)").run().changes;
    return { jobId, filename: job.filename, reviews, vaultEntries: vault, products };
  })();
}

export const VAULT_SCOPES = ["images", "all"] as const;
export type VaultScope = (typeof VAULT_SCOPES)[number];
export const VAULT_CONFIRM = "PURGE VAULT";

export function purgeVault(conn: Conn, scope: unknown, confirm: unknown) {
  if (!(VAULT_SCOPES as readonly unknown[]).includes(scope)) throw new PurgeError("Scope must be images or all.");
  if (confirm !== VAULT_CONFIRM) throw new PurgeError(`Type ${VAULT_CONFIRM} to confirm.`);
  const deleted = conn.prepare(scope === "images" ? "DELETE FROM pii_vault WHERE kind = 'IMAGE'" : "DELETE FROM pii_vault").run().changes;
  return { scope: scope as VaultScope, deleted };
}

export function vaultCounts(conn: Conn) {
  return conn.prepare("SELECT kind, COUNT(*) AS n FROM pii_vault GROUP BY kind ORDER BY n DESC").all() as { kind: string; n: number }[];
}
