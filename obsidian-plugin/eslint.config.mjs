// ─── ESLint (flat config) ────────────────────────────────────────────────────
// Safety tooling required by the project's code-quality directives (PLUG-5):
// no-floating-promises and no-explicit-any are hard errors over BOTH source
// and test files. Type-aware linting resolves types via tsconfig.test.json,
// which includes the whole tree (src + test stubs + vitest config).

import tseslint from "typescript-eslint";

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts", "test/**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.test.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-explicit-any": "error",
      // Underscore-prefixed parameters are the deliberate "unused by design"
      // convention (stub method signatures that must match the real API).
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // Lint only the TypeScript tree; build/config scripts are not part of it.
    ignores: ["dist/**", "node_modules/**", "esbuild.config.mjs", "eslint.config.mjs", "vitest.config.ts"],
  },
);
