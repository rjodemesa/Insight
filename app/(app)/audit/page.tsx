import AuditLog from "@/components/audit/AuditLog";

export default function Page() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Audit Log</h1>
      <AuditLog />
    </div>
  );
}
