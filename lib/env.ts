import "server-only";

/** Server-only env access. Never expose these via NEXT_PUBLIC_. */
export type AIProviderName = "mock" | "watsonx" | "gemini";

function optional(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v : undefined;
}

export function sessionSecret(): string {
  const s = optional("SESSION_SECRET");
  if (!s || s.length < 32) {
    throw new Error("SESSION_SECRET is missing or shorter than 32 characters. See .env.example.");
  }
  return s;
}

/** Returns the 32-byte vault key, or throws. Redaction must refuse to run without it. */
export function piiVaultKey(): Buffer {
  const raw = optional("PII_VAULT_KEY");
  if (!raw) throw new Error("PII_VAULT_KEY is not set. Redaction is disabled until it is configured.");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("PII_VAULT_KEY must be 32 bytes, base64-encoded.");
  return key;
}

export function aiProvider(): AIProviderName {
  const p = (optional("AI_PROVIDER") ?? "mock").toLowerCase();
  return p === "watsonx" || p === "gemini" ? p : "mock";
}

export const isProduction = process.env.NODE_ENV === "production";
