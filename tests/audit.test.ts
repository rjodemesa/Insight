import { describe, expect, it } from "vitest";
import { openDb } from "@/lib/db";
import { appendAudit, verifyAuditChain } from "@/lib/audit";

describe("audit chain", () => {
  it("verifies an intact chain", () => {
    const conn = openDb(":memory:");
    for (let i = 0; i < 5; i++) appendAudit(conn, { action: "test", details: { i } });
    expect(verifyAuditChain(conn)).toEqual({ ok: true, brokenAt: null, checked: 5 });
  });

  it("blocks UPDATE and DELETE through triggers", () => {
    const conn = openDb(":memory:");
    appendAudit(conn, { action: "test" });
    expect(() => conn.prepare("UPDATE audit_log SET action = 'x'").run()).toThrow(/append-only/);
    expect(() => conn.prepare("DELETE FROM audit_log").run()).toThrow(/append-only/);
  });

  it("detects tampering even when triggers are bypassed", () => {
    const conn = openDb(":memory:");
    for (let i = 0; i < 4; i++) appendAudit(conn, { action: "test", details: { i } });
    conn.exec("DROP TRIGGER audit_no_update");
    conn.prepare("UPDATE audit_log SET details = ? WHERE id = 3").run(JSON.stringify({ i: 99 }));
    expect(verifyAuditChain(conn)).toMatchObject({ ok: false, brokenAt: 3 });
  });
});
