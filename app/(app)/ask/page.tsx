import { Suspense } from "react";
import AskWorkspace from "@/components/ask/AskWorkspace";

export default function Page() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Ask AI</h1>
      {/* Filters are read from the URL, which needs a Suspense boundary. */}
      <Suspense>
        <AskWorkspace />
      </Suspense>
    </div>
  );
}
