import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard } from "@/lib/auth/guard";
import { providerStatus } from "@/lib/ai";
import { aiUsage } from "@/lib/admin/health";
import { PROMPT_VERSION } from "@/lib/ai/provider";

/**
 * IT officers: the AI settings in use and the last 7 days of AI calls. Settings are read-only
 * here by design: the provider, model and key live in .env.local, never in the database.
 */
export async function GET(req: NextRequest) {
  const auth = await guard(req, { roles: ["it_officer"] });
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ ...providerStatus(), promptVersion: PROMPT_VERSION, usage: aiUsage(db(), 7) }, { headers: { "Cache-Control": "no-store" } });
}
