import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

// The real `obsidian` package ships types only (no runtime). Alias it to a local
// stub so the plugin's classes can be constructed and exercised in tests.
export default defineConfig({
  resolve: {
    alias: {
      obsidian: resolve(__dirname, "test/obsidian-stub.ts"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
