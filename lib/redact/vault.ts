import crypto from "node:crypto";
import type Database from "better-sqlite3";
import type { RedactedItem } from "./redact";
import { restoreTokens } from "./redact";

/**
 * AES-256-GCM vault for redacted originals. The associated data binds each ciphertext
 * to its review, field and token, so rows cannot be swapped between records.
 */
const aad = (reviewId: number, field: string, token: string) => Buffer.from(`${reviewId}|${field}|${token}`);

export function encryptValue(key: Buffer, reviewId: number, item: Pick<RedactedItem, "field" | "token" | "value">) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(reviewId, item.field, item.token));
  const ciphertext = Buffer.concat([cipher.update(item.value, "utf8"), cipher.final()]);
  return { iv, ciphertext, authTag: cipher.getAuthTag() };
}

export function decryptValue(
  key: Buffer, reviewId: number, field: string, token: string,
  enc: { iv: Buffer; ciphertext: Buffer; authTag: Buffer },
): string {
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, enc.iv);
  decipher.setAAD(aad(reviewId, field, token));
  decipher.setAuthTag(enc.authTag);
  return Buffer.concat([decipher.update(enc.ciphertext), decipher.final()]).toString("utf8");
}

export function prepareVaultInsert(conn: Database.Database) {
  const stmt = conn.prepare(
    "INSERT INTO pii_vault (review_id, field, token, kind, ciphertext, iv, auth_tag) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  return (key: Buffer, reviewId: number, items: RedactedItem[]) => {
    for (const it of items) {
      const e = encryptValue(key, reviewId, it);
      stmt.run(reviewId, it.field, it.token, it.kind, e.ciphertext, e.iv, e.authTag);
    }
  };
}

export interface RevealedRecord {
  reviewId: number;
  reviewTitle: string | null;
  reviewText: string | null;
  customerImages: string[];
  tokens: { token: string; kind: string; field: string }[];
}

/** Decrypts one review's originals. Callers must check the role and write the audit entry. */
export function revealRecord(conn: Database.Database, key: Buffer, reviewId: number): RevealedRecord | null {
  const review = conn.prepare("SELECT review_title, review_text FROM reviews WHERE id = ?").get(reviewId) as
    | { review_title: string | null; review_text: string | null }
    | undefined;
  if (!review) return null;
  const rows = conn
    .prepare("SELECT field, token, kind, ciphertext, iv, auth_tag FROM pii_vault WHERE review_id = ? ORDER BY id")
    .all(reviewId) as { field: string; token: string; kind: string; ciphertext: Buffer; iv: Buffer; auth_tag: Buffer }[];
  const values = new Map<string, string>();
  const images: string[] = [];
  for (const r of rows) {
    const v = decryptValue(key, reviewId, r.field, r.token, { iv: r.iv, ciphertext: r.ciphertext, authTag: r.auth_tag });
    if (r.kind === "IMAGE") images.push(v);
    else values.set(r.token, v);
  }
  return {
    reviewId,
    reviewTitle: restoreTokens(review.review_title, values),
    reviewText: restoreTokens(review.review_text, values),
    customerImages: images,
    tokens: rows.map((r) => ({ token: r.token, kind: r.kind, field: r.field })),
  };
}
