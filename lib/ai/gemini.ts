import { log } from "@/lib/log";
import { AIError, PROMPT_VERSION, promptHash, type AIProvider, type AIResult, type AITask } from "./provider";

/**
 * Google Gemini over the generateContent REST endpoint, with structured JSON output.
 * The key goes in the x-goog-api-key header, never the URL, so it stays out of logs.
 * Retries rate limits and server errors twice; everything else fails fast.
 */
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const TIMEOUT_MS = 60_000;
const RETRIES = 2;

export interface GeminiOptions {
  apiKey: string | undefined;
  model: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { message?: string; status?: string };
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createGeminiProvider(opts: GeminiOptions): AIProvider {
  const doFetch = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? wait;
  const model = opts.model;

  async function call(body: unknown): Promise<GeminiResponse> {
    if (!opts.apiKey) {
      throw new AIError("Gemini is selected but GEMINI_API_KEY is empty. Add the key to .env.local and restart, or set AI_PROVIDER=mock.", "not_configured");
    }
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await doFetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": opts.apiKey },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS),
        });
      } catch (err) {
        const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
        if (attempt < RETRIES && !timedOut) {
          await sleep(1000 * 3 ** attempt);
          continue;
        }
        throw new AIError(timedOut ? "Gemini did not answer in time. Try again." : "Could not reach Gemini. Check the network connection.", timedOut ? "timeout" : "upstream");
      }
      const data = (await res.json().catch(() => ({}))) as GeminiResponse;
      if (res.ok) return data;
      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < RETRIES) {
        const after = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(after) && after > 0 ? Math.min(after, 10) * 1000 : 1000 * 3 ** attempt);
        continue;
      }
      const detail = (data.error?.message ?? "").slice(0, 200);
      log("warn", "gemini_error", { status: res.status, model, detail });
      if (res.status === 429) throw new AIError("Gemini's rate limit or quota was reached. Wait a minute and try again.", "rate_limited");
      if (res.status === 400 && /api key/i.test(detail)) throw new AIError("Gemini rejected the API key. Check GEMINI_API_KEY.", "not_configured");
      if (res.status === 401 || res.status === 403) throw new AIError("Gemini rejected the API key or the project has no access to this model.", "not_configured");
      if (res.status === 404) throw new AIError(`Gemini has no model called "${model}". Check GEMINI_MODEL.`, "not_configured");
      throw new AIError(`Gemini returned an error (${res.status})${detail ? `: ${detail}` : ""}.`, "upstream");
    }
  }

  return {
    name: "gemini",
    model,
    label: `Gemini (${model})`,
    async run<T>(task: AITask<T>): Promise<AIResult<T>> {
      const started = Date.now();
      const data = await call({
        systemInstruction: { parts: [{ text: task.system }] },
        contents: [{ role: "user", parts: [{ text: task.prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: task.schema,
          temperature: 0.2,
          maxOutputTokens: task.maxOutputTokens ?? 8192,
        },
      });
      if (data.promptFeedback?.blockReason) {
        throw new AIError(`Gemini declined the request (${data.promptFeedback.blockReason}).`, "blocked");
      }
      const cand = data.candidates?.[0];
      if (!cand) throw new AIError("Gemini returned no answer.", "bad_response");
      if (cand.finishReason === "SAFETY" || cand.finishReason === "PROHIBITED_CONTENT" || cand.finishReason === "BLOCKLIST") {
        throw new AIError(`Gemini stopped the answer (${cand.finishReason}).`, "blocked");
      }
      if (cand.finishReason === "MAX_TOKENS") throw new AIError("Gemini's answer was cut off. Narrow the filters and try again.", "bad_response");
      const text = (cand.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("");
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        throw new AIError("Gemini's answer was not valid JSON.", "bad_response");
      }
      return {
        data: task.parse(raw),
        provider: "gemini",
        model,
        version: PROMPT_VERSION,
        promptHash: promptHash(task.system, task.prompt),
        ms: Date.now() - started,
        tokens: { prompt: data.usageMetadata?.promptTokenCount ?? null, output: data.usageMetadata?.candidatesTokenCount ?? null },
      };
    },
  };
}
