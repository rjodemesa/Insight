import type { NextRequest } from "next/server";
import { brandComparison } from "@/lib/insights/ratings";
import { readRoute } from "@/lib/insights/route";

/** Every brand's reviews, share of reviews (visibility), star mix and over/underperformer verdict. */
export function GET(req: NextRequest) {
  return readRoute(req, (conn, f) => brandComparison(conn, f), { cache: true });
}
