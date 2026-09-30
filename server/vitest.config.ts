import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Integration tests spawn a server subprocess; give them breathing room.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
