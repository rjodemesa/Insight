import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Consumer Insight Platform",
  description: "Internal consumer review intelligence for P&G Philippines",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
