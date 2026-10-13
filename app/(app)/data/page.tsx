import { Suspense } from "react";
import DataWorkspace from "@/components/data/DataWorkspace";
import FeedbackQueue from "@/components/data/FeedbackQueue";
import MappingReview from "@/components/data/MappingReview";

export default function DataPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Data</h1>
      <DataWorkspace />
      <Suspense>
        <MappingReview />
      </Suspense>
      <FeedbackQueue />
    </div>
  );
}
