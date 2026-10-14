import { Suspense } from "react";
import Dashboard from "@/components/dashboard/Dashboard";
import DashboardTitle from "@/components/dashboard/DashboardTitle";

export default function Page() {
  return (
    <div className="space-y-4">
      {/* Filters and the persona are read from the URL, which needs a Suspense boundary. */}
      <Suspense fallback={<h1 className="text-2xl font-semibold">Dashboard</h1>}>
        <DashboardTitle />
        <Dashboard />
      </Suspense>
    </div>
  );
}
