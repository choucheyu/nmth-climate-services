import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.spec.ts", "**/*.spec.ts", "**/*.spec.tsx"],
    exclude: ["e2e/**"]
  }
});
