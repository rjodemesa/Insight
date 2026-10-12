/**
 * Creates the first IT officer from INITIAL_IT_OFFICER_EMAIL / _PASSWORD.
 * Idempotent: does nothing if that account already exists. Runs before `npm run dev`.
 */
import { openDb } from "../lib/db";
import { appendAudit } from "../lib/audit";
import { hashPassword } from "../lib/auth/password";

async function main() {
  const email = process.env.INITIAL_IT_OFFICER_EMAIL?.trim().toLowerCase();
  const password = process.env.INITIAL_IT_OFFICER_PASSWORD;
  const conn = openDb();
  try {
    if (!email || !password) {
      const n = (conn.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
      if (n === 0) console.warn("[seed] No users yet. Set INITIAL_IT_OFFICER_EMAIL and _PASSWORD in .env.local.");
      return;
    }
    if (conn.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) return;
    const info = conn
      .prepare("INSERT INTO users (email, display_name, password_hash, role, must_change_password) VALUES (?, ?, ?, 'it_officer', 1)")
      .run(email, "IT Officer", await hashPassword(password));
    appendAudit(conn, {
      action: "user_seeded", role: "system", entityType: "user",
      entityId: String(info.lastInsertRowid), details: { email, role: "it_officer" },
    });
    console.log(`[seed] Created IT officer ${email}. Password change is required at first sign-in.`);
  } finally {
    conn.close();
  }
}

main().catch((err) => {
  console.error("[seed] Failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
