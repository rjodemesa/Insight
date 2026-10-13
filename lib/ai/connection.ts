import { obj, type AIProvider, type AITask } from "./provider";

/** A tiny request that proves the provider, key and model work. Sends no review data. */
export function connectionTask(): AITask<{ ok: boolean }> {
  return {
    name: "connection_test",
    system: "You are a health check. Answer exactly as the schema asks.",
    prompt: 'Return {"ok": true}.',
    maxOutputTokens: 256,
    schema: { type: "OBJECT", properties: { ok: { type: "BOOLEAN" } }, required: ["ok"] },
    parse: (raw) => ({ ok: obj(raw, "connection test").ok === true }),
    mock: () => ({ ok: true }),
  };
}

export async function testConnection(provider: AIProvider) {
  const res = await provider.run(connectionTask());
  return { ok: res.data.ok, provider: provider.name, model: provider.model, label: provider.label, ms: res.ms, result: res };
}
