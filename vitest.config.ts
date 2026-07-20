import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Builds dist/ once under a cross-process lock; see scripts/vitest-dist-setup.mjs.
    globalSetup: ["./scripts/vitest-dist-setup.mjs"],
    // Waiting for another run's lock can exceed the default hook budget.
    hookTimeout: 600_000,
    exclude: [
      "dist/**",
      "node_modules/**",
      ".smithers/**",
      ".worktrees/**",
      "**/.worktrees/**",
    ],
  },
});
