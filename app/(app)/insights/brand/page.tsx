import { Suspense } from "react";
import BrandDetail from "@/components/insights/BrandDetail";

/** Brand detail. The brand comes from the `brand` filter in the URL. */
export default function Page() {
  return (
    <Suspense>
      <BrandDetail />
    </Suspense>
  );
}
