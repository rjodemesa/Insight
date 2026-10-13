import type { NextRequest } from "next/server";
import { listReviews, type ReviewSort } from "@/lib/insights/queries";
import { enumParam, intParam, readRoute } from "@/lib/insights/route";

const SORTS: ReviewSort[] = ["newest", "oldest", "helpful", "rating_low", "rating_high"];

/** Redacted reviews with tags. Filters as in lib/query/filters.ts, plus sort, limit (≤100) and offset. */
export function GET(req: NextRequest) {
  return readRoute(req, (conn, f, sp) =>
    listReviews(conn, f, {
      sort: enumParam(sp, "sort", SORTS, "newest"),
      limit: intParam(sp, "limit", 25, 1, 100),
      offset: intParam(sp, "offset", 0, 0, 100_000),
    }),
  );
}
