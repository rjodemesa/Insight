import crypto from "node:crypto";

/**
 * One interface for every AI call. A task carries its prompt, the JSON shape the answer
 * must have, a parser that rejects anything else, and a deterministic offline answer for
 * the mock provider. Providers only ever receive REDACTED review text.
 */

/** Bumped when prompts or answer shapes change; stored in the audit log and on AI tags. */
export const PROMPT_VERSION = "p1";

/** Subset of the OpenAPI schema that Gemini's structured output accepts. */
export interface Schema {
  type: "OBJECT" | "ARRAY" | "STRING" | "NUMBER" | "INTEGER" | "BOOLEAN";
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  enum?: string[];
  description?: string;
}

export interface AITask<T> {
  /** Short name for logs and the audit trail: summary, ask, tag, alert. */
  name: string;
  system: string;
  prompt: string;
  schema: Schema;
  maxOutputTokens?: number;
  /** Validates and normalises the model's JSON. Throws AIError("bad_response") on the wrong shape. */
  parse: (raw: unknown) => T;
  /** The answer the mock provider returns. Must pass `parse`. */
  mock: () => unknown;
}

export interface AIResult<T> {
  data: T;
  provider: string;
  model: string;
  version: string;
  promptHash: string;
  ms: number;
  tokens: { prompt: number | null; output: number | null };
}

export interface AIProvider {
  name: "mock" | "gemini";
  model: string;
  /** Human label for the UI, e.g. "Gemini (gemini-3.8-flash)". */
  label: string;
  run<T>(task: AITask<T>): Promise<AIResult<T>>;
}

export type AIErrorCode = "not_configured" | "timeout" | "rate_limited" | "blocked" | "bad_response" | "upstream";

export class AIError extends Error {
  constructor(message: string, readonly code: AIErrorCode) {
    super(message);
  }
}

export const promptHash = (system: string, prompt: string) =>
  crypto.createHash("sha256").update(system).update("\u0000").update(prompt).digest("hex");

const tokenCounts = { prompt: null, output: null };

/** Offline provider: returns each task's deterministic answer. Used by default and in tests. */
export function createMockProvider(): AIProvider {
  return {
    name: "mock",
    model: "mock",
    label: "Mock AI (offline template, not a real model)",
    async run<T>(task: AITask<T>): Promise<AIResult<T>> {
      const started = Date.now();
      const data = task.parse(task.mock());
      return {
        data, provider: "mock", model: "mock", version: PROMPT_VERSION,
        promptHash: promptHash(task.system, task.prompt), ms: Date.now() - started, tokens: tokenCounts,
      };
    },
  };
}

// ---------------------------------------------------------------- shared parsing helpers

export function bad(what: string): never {
  throw new AIError(`The AI answer was not in the expected format (${what}).`, "bad_response");
}

export function obj(x: unknown, what: string): Record<string, unknown> {
  if (!x || typeof x !== "object" || Array.isArray(x)) bad(what);
  return x as Record<string, unknown>;
}

export function str(x: unknown, max: number): string {
  return typeof x === "string" ? x.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

export function arr(x: unknown): unknown[] {
  return Array.isArray(x) ? x : [];
}
