import { Suspense } from "react";
import DataSections from "@/components/data/DataSections";

export default function DataPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Data</h1>
      {/* Sections and filters live in the URL, which needs a Suspense boundary. */}
      <Suspense>
        <DataSections />
      </Suspense>
    </div>
  );
}
