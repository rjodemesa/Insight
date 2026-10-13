import "server-only";
import { aiProvider, geminiConfig } from "@/lib/env";
import { createGeminiProvider } from "./gemini";
import { createMockProvider, type AIProvider } from "./provider";

/** The provider chosen by AI_PROVIDER (mock unless set to gemini). */
export function getProvider(): AIProvider {
  return aiProvider() === "gemini" ? createGeminiProvider(geminiConfig()) : createMockProvider();
}

/** What the UI shows about the AI in use. Never includes the key. */
export function providerStatus() {
  const p = getProvider();
  const configured = p.name === "mock" || Boolean(geminiConfig().apiKey);
  return { provider: p.name, model: p.model, label: p.label, configured };
}
