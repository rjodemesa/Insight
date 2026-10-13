import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname),
      // Tests run on the server side, so the marker package resolves to its no-op build.
      "server-only": path.resolve(import.meta.dirname, "node_modules/server-only/empty.js"),
    },
  },
  // PRISM_DB_PATH keeps tests away from the real data/ folder (no rename, no reads).
  test: { environment: "node", include: ["tests/**/*.test.ts"], env: { PRISM_DB_PATH: ":memory:" } },
});
