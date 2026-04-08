import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,           // vi, describe, it, expect available globally
    environment: "node",      // Node.js environment
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/services/**/*.ts"],
      exclude: [],
    },
  },
});
