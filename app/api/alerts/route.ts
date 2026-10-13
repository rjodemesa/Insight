import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard } from "@/lib/auth/guard";
import { listAlerts, type AlertStatus } from "@/lib/agent/alerts";

const STATUSES = ["proposed", "approved", "dismissed", "all"] as const;

/** Alerts by status (?status=proposed|approved|dismissed|all), most severe first, with counts per status. */
export async function GET(req: NextRequest) {
  const auth = await guard(req);
  if (auth instanceof NextResponse) return auth;
  const s = req.nextUrl.searchParams.get("status") ?? "proposed";
  if (!(STATUSES as readonly string[]).includes(s)) {
    return NextResponse.json({ error: `status must be one of: ${STATUSES.join(", ")}.` }, { status: 400 });
  }
  return NextResponse.json(listAlerts(db(), s as AlertStatus | "all"), { headers: { "Cache-Control": "no-store" } });
}
