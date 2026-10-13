import type { NextRequest } from "next/server";
import { trend, type Bucket } from "@/lib/insights/queries";
import { enumParam, readRoute } from "@/lib/insights/route";

/** Sentiment and rating over time, by month (default) or week, with a change test on the latest period. */
export function GET(req: NextRequest) {
  return readRoute(req, (conn, f, sp) => trend(conn, f, enumParam<Bucket>(sp, "bucket", ["month", "week"], "month")));
}
