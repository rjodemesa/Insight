import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import Placeholder from "@/components/Placeholder";

export default async function AdminPage() {
  const session = await getSession();
  if (session?.user.role !== "it_officer") notFound();
  return (
    <Placeholder title="Admin" phase={5}>
      <p>User management, PII reveal and restore, purge, AI provider settings, redaction rules and system health.</p>
      <p className="mt-2 text-sm">
        System health is already available as JSON at <code>/api/health</code> (IT officers only see the details).
      </p>
    </Placeholder>
  );
}
