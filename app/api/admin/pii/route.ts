import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard } from "@/lib/auth/guard";
import { redactionFlags } from "@/lib/admin/pii";
import { vaultCounts } from "@/lib/admin/purge";

/** IT officers: what the vault holds (by kind) and the reviews users flagged for missed personal data. */
export async function GET(req: NextRequest) {
  const auth = await guard(req, { roles: ["it_officer"] });
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ vault: vaultCounts(db()), flags: redactionFlags(db()) }, { headers: { "Cache-Control": "no-store" } });
}
