import type { NextRequest } from "next/server";
import { products, type ProductSort } from "@/lib/insights/queries";
import { enumParam, intParam, readRoute } from "@/lib/insights/route";

/** Canonical products in the filtered reviews, with Intelligence Scores. sort = score | reviews | name | negative. */
export function GET(req: NextRequest) {
  return readRoute(
    req,
    (conn, f, sp) =>
      products(conn, f, enumParam<ProductSort>(sp, "sort", ["score", "reviews", "name", "negative"], "score"), intParam(sp, "limit", 200, 1, 1000)),
    { cache: true },
  );
}
