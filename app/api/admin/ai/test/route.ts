import { NextResponse, type NextRequest } from "next/server";
import { guard } from "@/lib/auth/guard";
import { getProvider } from "@/lib/ai";
import { testConnection } from "@/lib/ai/connection";
import { auditAi, aiFailure } from "@/lib/ai/route";

/** IT officers: one tiny request to the configured provider (no review data) to prove the key and model work. */
export async function POST(req: NextRequest) {
  const auth = await guard(req, { roles: ["it_officer"] });
  if (auth instanceof NextResponse) return auth;
  const provider = getProvider();
  try {
    const { result, ...out } = await testConnection(provider);
    auditAi(req, auth, "ai_connection_test", provider, result, { ok: out.ok });
    return NextResponse.json(out);
  } catch (err) {
    auditAi(req, auth, "ai_connection_test", provider, null, { error: err instanceof Error ? err.message.slice(0, 200) : "unknown" }, "failed");
    return aiFailure(err, "ai_connection_test_failed");
  }
}
