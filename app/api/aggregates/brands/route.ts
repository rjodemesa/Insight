import type { NextRequest } from "next/server";
import { brands } from "@/lib/insights/queries";
import { readRoute } from "@/lib/insights/route";

/** Brand comparison with Intelligence Scores. */
export function GET(req: NextRequest) {
  return readRoute(req, (conn, f) => brands(conn, f));
}
