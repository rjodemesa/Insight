import { Suspense } from "react";
import InsightsWorkspace from "@/components/insights/InsightsWorkspace";

export default function Page() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Insights</h1>
      <Suspense>
        <InsightsWorkspace />
      </Suspense>
    </div>
  );
}
