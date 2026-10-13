import { Suspense } from "react";
import Dashboard from "@/components/dashboard/Dashboard";

export default function Page() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      {/* Filters are read from the URL, which needs a Suspense boundary. */}
      <Suspense>
        <Dashboard />
      </Suspense>
    </div>
  );
}
