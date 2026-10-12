import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import AppNav from "@/components/AppNav";
import { SessionProvider } from "@/components/SessionContext";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.user.mustChangePassword) redirect("/change-password");
  return (
    <>
      <a href="#main" className="skip-link">Skip to content</a>
      <AppNav
        role={session.user.role}
        email={session.user.email}
        csrfToken={session.csrfToken}
      />
      <SessionProvider value={{ csrfToken: session.csrfToken, role: session.user.role, email: session.user.email }}>
        <main id="main" className="mx-auto max-w-7xl p-4 sm:p-6">{children}</main>
      </SessionProvider>
    </>
  );
}
