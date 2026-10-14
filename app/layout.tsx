import type { Metadata } from "next";
import "./globals.css";
import "./dark.css";

export const metadata: Metadata = {
  title: "Prism",
  description: "Prism: A Digital Platform for Consumer-Driven Brand Growth. P&G Philippines academic prototype, for presentation only.",
  robots: { index: false, follow: false },
};

/** Applies a saved dark-mode choice before first paint, so pages don't flash light. */
const THEME_SCRIPT = `try{if(localStorage.getItem("prism.theme")==="dark")document.documentElement.dataset.theme="dark"}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The theme script changes data-theme before React hydrates.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
