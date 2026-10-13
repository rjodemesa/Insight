import { NextResponse, type NextRequest } from "next/server";
import { guard } from "@/lib/auth/guard";
import { providerStatus } from "@/lib/ai";

/** Which AI provider and model answer AI requests, and whether it is ready. Never returns the key. */
export async function GET(req: NextRequest) {
  const auth = await guard(req);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json(providerStatus());
}
