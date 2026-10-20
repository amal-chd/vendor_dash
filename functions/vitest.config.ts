import { defineConfig } from "vitest/config";

// Tests live in test/ (outside src/) so they are never compiled into the
// deployed functions bundle. They exercise the pure, side-effect-free helpers
// extracted from the Cloud Functions.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
