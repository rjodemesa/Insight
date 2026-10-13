import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "@/lib/db";
import { appendAudit } from "@/lib/audit";
import { verifyPassword } from "@/lib/auth/password";
import { runIngest } from "@/lib/ingest/pipeline";
import { createUser, listUsers, resetPassword, updateUser, UserError } from "@/lib/admin/users";
import { PiiError, restoreTokens } from "@/lib/admin/pii";
import { listImports, purgeImport, PurgeError, purgeVault, VAULT_CONFIRM } from "@/lib/admin/purge";
import { systemHealth, vaultKeyMatches } from "@/lib/admin/health";
import { auditCsv, AuditQueryError, listAudit, parseAuditQuery } from "@/lib/auditQuery";
import { testConnection } from "@/lib/ai/connection";
import { createMockProvider } from "@/lib/ai/provider";
import { makeFixture } from "../scripts/make-fixture";

const key = crypto.randomBytes(32);
let conn: Database.Database;
let jobId: number;
let admin: number;

beforeAll(async () => {
  const fixture = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "insight-admin-")), "sample_reviews.xlsx");
  await makeFixture(fixture);
  conn = openDb(":memory:");
  admin = Number(conn.prepare("INSERT INTO users (email, password_hash, role, must_change_password) VALUES ('it@x.ph', 'h', 'it_officer', 0)").run().lastInsertRowid);
  jobId = Number(conn.prepare("INSERT INTO ingest_jobs (filename, status, started_by) VALUES ('reviews.xlsx', 'queued', ?)").run(admin).lastInsertRowid);
  await runIngest(conn, { jobId, path: fixture, kind: "xlsx", vaultKey: key, userId: admin, role: "it_officer" });
});

describe("users", () => {
  it("creates accounts with a one-time password that must be changed", async () => {
    const u = await createUser(conn, { email: " Ana@Example.PH ", displayName: "Ana", role: "user" });
    expect(u.email).toBe("ana@example.ph");
    const row = conn.prepare("SELECT password_hash, must_change_password FROM users WHERE id = ?").get(u.id) as { password_hash: string; must_change_password: number };
    expect(row.must_change_password).toBe(1);
    expect(await verifyPassword(u.temporaryPassword, row.password_hash)).toBe(true);
    await expect(createUser(conn, { email: "ana@example.ph", displayName: "", role: "user" })).rejects.toThrow(/already exists/);
    await expect(createUser(conn, { email: "not-an-email", displayName: "", role: "user" })).rejects.toBeInstanceOf(UserError);
    await expect(createUser(conn, { email: "b@x.ph", displayName: "", role: "root" })).rejects.toThrow(/Role/);
  });

  it("never locks out the last IT officer or the acting officer", async () => {
    const other = await createUser(conn, { email: "it2@x.ph", displayName: "", role: "it_officer" });
    expect(() => updateUser(conn, admin, admin, { disabled: true })).toThrow(/your own account/);
    expect(() => updateUser(conn, admin, admin, { role: "user" })).toThrow(/your own role/);
    conn.prepare("INSERT INTO sessions (id_hash, user_id, csrf_token, expires_at) VALUES ('s1', ?, 'c', '2999-01-01')").run(other.id);
    const r = updateUser(conn, admin, other.id, { role: "user" });
    expect(r.changes.role).toEqual({ from: "it_officer", to: "user" });
    expect(conn.prepare("SELECT COUNT(*) FROM sessions WHERE user_id = ?").pluck().get(other.id)).toBe(0);
    // Now `admin` is the only active officer, so another officer cannot demote them either.
    updateUser(conn, admin, other.id, { role: "it_officer" });
    updateUser(conn, admin, other.id, { disabled: true });
    expect(() => updateUser(conn, other.id, admin, { role: "user" })).toThrow(/at least one active IT officer/);
    expect(listUsers(conn).find((u) => u.id === other.id)?.disabled).toBe(true);
  });

  it("resets another user's password and ends their sessions", async () => {
    const id = conn.prepare("SELECT id FROM users WHERE email = 'ana@example.ph'").pluck().get() as number;
    conn.prepare("UPDATE users SET must_change_password = 0 WHERE id = ?").run(id);
    conn.prepare("INSERT INTO sessions (id_hash, user_id, csrf_token, expires_at) VALUES ('s2', ?, 'c', '2999-01-01')").run(id);
    const r = await resetPassword(conn, admin, id);
    expect(r.temporaryPassword).toMatch(/[a-z]/i);
    expect(conn.prepare("SELECT must_change_password FROM users WHERE id = ?").pluck().get(id)).toBe(1);
    expect(conn.prepare("SELECT COUNT(*) FROM sessions WHERE user_id = ?").pluck().get(id)).toBe(0);
    await expect(resetPassword(conn, admin, admin)).rejects.toThrow(/Change password/);
  });
});

describe("PII restore", () => {
  it("puts chosen originals back, deletes them from the vault and re-tags the review", () => {
    const row = conn.prepare("SELECT v.review_id AS id, v.token FROM pii_vault v WHERE v.kind = 'PHONE' LIMIT 1").get() as { id: number; token: string };
    const before = conn.prepare("SELECT review_text, redaction_count FROM reviews WHERE id = ?").get(row.id) as { review_text: string; redaction_count: number };
    expect(before.review_text).toContain(row.token);
    const r = restoreTokens(conn, key, row.id, [row.token]);
    expect(r.restored).toEqual([{ token: row.token, kind: "PHONE", field: "reviewText" }]);
    const after = conn.prepare("SELECT review_text, redaction_count, nlp_version FROM reviews WHERE id = ?").get(row.id) as { review_text: string; redaction_count: number; nlp_version: string };
    expect(after.review_text).toContain("0917 123 4567");
    expect(after.review_text).not.toContain(row.token);
    expect(after.redaction_count).toBe(before.redaction_count - 1);
    expect(conn.prepare("SELECT COUNT(*) FROM pii_vault WHERE review_id = ? AND token = ?").pluck().get(row.id, row.token)).toBe(0);
    expect(() => restoreTokens(conn, key, row.id, [row.token])).toThrow(PiiError);
  });

  it("refuses image links, unknown tokens and the wrong key", () => {
    const img = conn.prepare("SELECT review_id AS id, token FROM pii_vault WHERE kind = 'IMAGE' LIMIT 1").get() as { id: number; token: string } | undefined;
    if (img) expect(() => restoreTokens(conn, key, img.id, [img.token])).toThrow(/title or text/);
    const any = conn.prepare("SELECT review_id AS id, token FROM pii_vault WHERE kind <> 'IMAGE' LIMIT 1").get() as { id: number; token: string };
    expect(() => restoreTokens(conn, key, any.id, ["[PHONE_999]"])).toThrow(/not in this review/);
    expect(() => restoreTokens(conn, key, any.id, ["DROP TABLE"])).toThrow(/at least one token/);
    expect(() => restoreTokens(conn, crypto.randomBytes(32), any.id, [any.token])).toThrow();
    expect(conn.prepare("SELECT COUNT(*) FROM pii_vault WHERE review_id = ? AND token = ?").pluck().get(any.id, any.token)).toBe(1);
  });
});

describe("health", () => {
  it("checks the vault key against the vault and the audit chain", () => {
    expect(vaultKeyMatches(conn, key)).toBe(true);
    expect(vaultKeyMatches(conn, crypto.randomBytes(32))).toBe(false);
    const h = systemHealth(conn, { dbPath: ":memory:", vaultKey: crypto.randomBytes(32), vaultKeyError: null, ai: { label: "Mock", configured: true } });
    expect(h.checks.find((c) => c.name === "PII vault key")?.level).toBe("fail");
    expect(h.checks.find((c) => c.name === "Audit chain")?.level).toBe("ok");
    expect(h.checks.find((c) => c.name === "Database schema")?.level).toBe("ok");
    expect(h.stats.reviews).toBe(200);
  });

  it("tests the AI connection without review data", async () => {
    const r = await testConnection(createMockProvider());
    expect(r.ok).toBe(true);
  });
});

describe("audit queries", () => {
  it("scopes users to their own entries and filters by action", () => {
    const user = conn.prepare("SELECT id FROM users WHERE email = 'ana@example.ph'").pluck().get() as number;
    appendAudit(conn, { userId: user, role: "user", action: "export", details: { kind: "reviews" } });
    appendAudit(conn, { userId: admin, role: "it_officer", action: "export", details: { kind: "=HYPERLINK(\"x\")" } });
    const own = listAudit(conn, parseAuditQuery(new URLSearchParams("user=" + admin), user));
    expect(own.entries.every((e) => e.userId === user)).toBe(true);
    expect(own.actions.map((a) => a.v)).toEqual(["export"]);
    const all = listAudit(conn, parseAuditQuery(new URLSearchParams("action=export"), null));
    expect(all.total).toBe(2);
    expect(listAudit(conn, parseAuditQuery(new URLSearchParams(`user=${user}`), null)).total).toBe(1);
    expect(() => parseAuditQuery(new URLSearchParams("action=x' OR 1=1"), null)).toThrow(AuditQueryError);
    expect(() => parseAuditQuery(new URLSearchParams("from=yesterday"), null)).toThrow(AuditQueryError);
  });

  it("exports CSV that a spreadsheet will not run as formulas", () => {
    const csv = [...auditCsv(conn, parseAuditQuery(new URLSearchParams("action=export"), null))].join("");
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toMatch(/^id,ts,userId,email/);
    expect(lines).toHaveLength(3);
    expect(csv).not.toMatch(/,=HYPERLINK/);
    expect(csv).toContain('"{""kind"":""=HYPERLINK');
  });
});

describe("purge", () => {
  it("purges vault image links, then everything, only with the confirmation text", () => {
    expect(() => purgeVault(conn, "images", "yes")).toThrow(PurgeError);
    expect(() => purgeVault(conn, "some", VAULT_CONFIRM)).toThrow(/Scope/);
    const images = conn.prepare("SELECT COUNT(*) FROM pii_vault WHERE kind = 'IMAGE'").pluck().get() as number;
    expect(purgeVault(conn, "images", VAULT_CONFIRM).deleted).toBe(images);
    expect(conn.prepare("SELECT COUNT(*) FROM pii_vault WHERE kind = 'IMAGE'").pluck().get()).toBe(0);
    expect(conn.prepare("SELECT COUNT(*) FROM pii_vault").pluck().get()).toBeGreaterThan(0);
  });

  it("deletes an import with everything derived from it", () => {
    expect(listImports(conn)[0]).toMatchObject({ filename: "reviews.xlsx", reviews: 200 });
    expect(() => purgeImport(conn, jobId, "wrong.xlsx")).toThrow(/Type the file name/);
    const r = purgeImport(conn, jobId, "reviews.xlsx");
    expect(r.reviews).toBe(200);
    expect(r.products).toBe(6);
    for (const t of ["reviews", "review_themes", "pii_vault", "products", "product_aliases", "ingest_jobs"]) {
      expect(conn.prepare(`SELECT COUNT(*) FROM ${t}`).pluck().get()).toBe(0);
    }
    expect(conn.prepare("SELECT COUNT(*) FROM audit_log").pluck().get()).toBeGreaterThan(0);
    expect(() => purgeImport(conn, jobId, "reviews.xlsx")).toThrow(/not found/);
  });
});
