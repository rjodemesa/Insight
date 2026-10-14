"use client";

import { useEffect, useState } from "react";

/** localStorage key for the chosen theme. The script in app/layout.tsx reads it before first paint. */
export const THEME_KEY = "prism.theme";

/** Switches between light (default) and dark mode; styles are in app/dark.css. */
export default function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.dataset.theme === "dark");
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    if (next) document.documentElement.dataset.theme = "dark";
    else delete document.documentElement.dataset.theme;
    try {
      window.localStorage.setItem(THEME_KEY, next ? "dark" : "light");
    } catch {
      // Storage blocked: the choice lasts for this page only.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={dark}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label="Dark mode"
      className="rounded px-2 py-1 text-ink-muted hover:bg-brand-soft"
    >
      <span aria-hidden="true">{dark ? "☀" : "☾"}</span>
    </button>
  );
}
