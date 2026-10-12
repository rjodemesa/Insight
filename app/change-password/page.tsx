import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";
import ChangePasswordForm from "./ChangePasswordForm";

export const dynamic = "force-dynamic";

export default async function ChangePasswordPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-4 rounded-lg border border-line bg-surface p-8 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold">Change your password</h1>
          <p className="text-sm text-ink-muted">
            {session.user.mustChangePassword
              ? "You must set a new password before continuing."
              : "Choose a new password."}{" "}
            Use at least {MIN_PASSWORD_LENGTH} characters, with a letter and a number.
          </p>
        </div>
        <ChangePasswordForm csrfToken={session.csrfToken} />
      </div>
    </main>
  );
}
