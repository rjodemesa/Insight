import { describe, expect, it } from "vitest";
import { hashPassword, passwordPolicyError, verifyPassword } from "@/lib/auth/password";
import { clearLoginAttempts, loginRetryAfter, recordFailedLogin } from "@/lib/auth/rateLimit";

describe("passwords", () => {
  it("hashes and verifies", async () => {
    const h = await hashPassword("correct horse 42");
    expect(await verifyPassword("correct horse 42", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
  });

  it("enforces the policy", () => {
    expect(passwordPolicyError("short1")).not.toBeNull();
    expect(passwordPolicyError("onlyletterslong")).not.toBeNull();
    expect(passwordPolicyError("letters-and-123")).toBeNull();
  });
});

describe("login rate limit", () => {
  it("blocks after 5 failures and resets on success", () => {
    const key = "1.2.3.4|a@b.c";
    const t = 1_000_000;
    for (let i = 0; i < 5; i++) recordFailedLogin(key, t);
    expect(loginRetryAfter(key, t)).toBeGreaterThan(0);
    expect(loginRetryAfter(key, t + 16 * 60 * 1000)).toBe(0);
    for (let i = 0; i < 5; i++) recordFailedLogin(key, t);
    clearLoginAttempts(key);
    expect(loginRetryAfter(key, t)).toBe(0);
  });
});
