import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import AdminWorkspace from "@/components/admin/AdminWorkspace";

export default async function Page() {
  // The nav hides this tab from users; the APIs also refuse them. This stops a typed URL.
  const session = await getSession();
  if (session?.user.role !== "it_officer") redirect("/dashboard");
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Admin</h1>
      <Suspense>
        <AdminWorkspace />
      </Suspense>
    </div>
  );
}
