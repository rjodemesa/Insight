import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { openDb } from "@/lib/db";
import { findPii } from "@/lib/redact/rules";
import { RecordRedactor } from "@/lib/redact/redact";
import { decryptValue, encryptValue, prepareVaultInsert, revealRecord } from "@/lib/redact/vault";

const kinds = (t: string, stop: string[] = []) => findPii(t, stop).map((s) => [s.kind, t.slice(s.start, s.end)]);

describe("PII detection", () => {
  it("finds PH phone numbers in common formats", () => {
    expect(kinds("text 0917 123 4567 or +63 917-123-4567 or 09171234567")).toEqual([
      ["PHONE", "0917 123 4567"], ["PHONE", "+63 917-123-4567"], ["PHONE", "09171234567"],
    ]);
    expect(kinds("landline (02) 8123 4567")).toEqual([["PHONE", "(02) 8123 4567"]]);
  });

  it("finds emails, handles, links and order numbers", () => {
    expect(kinds("mail juan.dc@example.com, IG @shopper_ph")).toEqual([
      ["EMAIL", "juan.dc@example.com"], ["HANDLE", "@shopper_ph"],
    ]);
    expect(kinds("see https://facebook.com/someone.")).toEqual([["HANDLE", "https://facebook.com/someone"]]);
    expect(kinds("Order no: 123456789012345 late")).toEqual([["ORDER", "123456789012345"]]);
    expect(kinds("tracking # PH12345678 pls")).toEqual([["ORDER", "PH12345678"]]);
  });

  it("finds cue-introduced names and addresses (English and Filipino)", () => {
    expect(kinds("Ako si Maria Santos, salamat")).toEqual([["NAME", "Maria Santos"]]);
    expect(kinds("ako po si juan")).toEqual([["NAME", "juan"]]);
    expect(kinds("Hi, this is Carlo, from Cebu")).toEqual([["NAME", "Carlo"]]);
    expect(kinds("Great product - Ana")).toEqual([["NAME", "Ana"]]);
    expect(kinds("Brgy. San Isidro kami")).toEqual([["ADDRESS", "Brgy. San Isidro"]]);
    expect(kinds("Blk 5 Lot 12 dito")).toEqual([["ADDRESS", "Blk 5 Lot 12"]]);
  });

  it("does not flag ordinary review language, sizes or prices", () => {
    expect(findPii("This is Great! Sobrang bango, 2.4L for P299, 5 stars")).toEqual([]);
    expect(findPii("This is Ariel", ["Ariel"])).toEqual([]);
    expect(findPii("a lot better than before, block stains")).toEqual([]);
    // Cue words inside longer words are not cues.
    expect(findPii("high expectation lang ako sigurado na legit")).toEqual([]);
    expect(findPii("nagorder uli ako sinabihan ko sila")).toEqual([]);
    expect(kinds("Name: Pedro")).toEqual([["NAME", "Pedro"]]);
  });
});

describe("redaction tokens", () => {
  it("gives the same value the same token across fields", () => {
    const r = new RecordRedactor();
    expect(r.redact("reviewTitle", "Call 09171234567")).toBe("Call [PHONE_001]");
    expect(r.redact("reviewText", "again 0917-123-4567 or 09981112222")).toBe("again [PHONE_001] or [PHONE_002]");
    expect(r.items.map((i) => i.token)).toEqual(["[PHONE_001]", "[PHONE_002]"]);
  });

  it("counts customer images and vaults the links", () => {
    const r = new RecordRedactor();
    expect(r.images("https://a.example/1.jpg, https://a.example/2.jpg")).toBe(2);
    expect(r.items.filter((i) => i.kind === "IMAGE")).toHaveLength(2);
  });
});

describe("vault", () => {
  const key = crypto.randomBytes(32);

  it("round-trips: redact → store → reveal equals the original", () => {
    const conn = openDb(":memory:");
    conn.prepare("INSERT INTO ingest_jobs (id, filename, status) VALUES (1, 't', 'done')").run();
    const title = "Contact: maria@example.com";
    const text = "Ako si Maria Santos, 0917 123 4567. Order no: 123456789012345";
    const r = new RecordRedactor();
    const rt = r.redact("reviewTitle", title);
    const rx = r.redact("reviewText", text);
    expect(rx).not.toContain("0917");
    expect(rx).not.toContain("Maria");
    const id = Number(conn.prepare("INSERT INTO reviews (ingest_id, review_title, review_text) VALUES (1, ?, ?)").run(rt, rx).lastInsertRowid);
    prepareVaultInsert(conn)(key, id, r.items);
    const revealed = revealRecord(conn, key, id)!;
    expect(revealed.reviewTitle).toBe(title);
    expect(revealed.reviewText).toBe(text);
  });

  it("rejects a wrong key and a ciphertext moved to another record", () => {
    const enc = encryptValue(key, 1, { field: "reviewText", token: "[PHONE_001]", value: "09171234567" });
    expect(decryptValue(key, 1, "reviewText", "[PHONE_001]", enc)).toBe("09171234567");
    expect(() => decryptValue(crypto.randomBytes(32), 1, "reviewText", "[PHONE_001]", enc)).toThrow();
    expect(() => decryptValue(key, 2, "reviewText", "[PHONE_001]", enc)).toThrow();
  });
});
