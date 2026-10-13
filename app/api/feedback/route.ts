import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard } from "@/lib/auth/guard";
import { listFeedback } from "@/lib/feedback";

/** Tag corrections and missed-redaction flags, newest first, for the triage list. */
export async function GET(req: NextRequest) {
  const auth = await guard(req);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json(listFeedback(db()), { headers: { "Cache-Control": "no-store" } });
}
