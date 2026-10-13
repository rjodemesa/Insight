import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "P&G Consumer Insight",
  description: "Consumer review intelligence for P&G Philippines (academic prototype for presentation only)",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
