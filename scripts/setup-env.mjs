// Creates .env.local with fresh random secrets if it does not exist. Never overwrites.
import crypto from "node:crypto";
import fs from "node:fs";

const FILE = ".env.local";
if (fs.existsSync(FILE)) process.exit(0);

const password = crypto.randomBytes(12).toString("base64url") + "7a";
const lines = [
  "AI_PROVIDER=mock",
  "GEMINI_API_KEY=",
  "GEMINI_MODEL=",
  `PII_VAULT_KEY=${crypto.randomBytes(32).toString("base64")}`,
  `SESSION_SECRET=${crypto.randomBytes(48).toString("base64url")}`,
  "INITIAL_IT_OFFICER_EMAIL=admin@insight.local",
  `INITIAL_IT_OFFICER_PASSWORD=${password}`,
  "",
];
fs.writeFileSync(FILE, lines.join("\n"), { mode: 0o600 });
console.log(`Created ${FILE} with new secrets.`);
console.log("First IT officer: admin@insight.local");
console.log(`Temporary password: ${password}  (you must change it at first sign-in)`);
console.log("Back up PII_VAULT_KEY: without it, redacted originals can never be restored.");
