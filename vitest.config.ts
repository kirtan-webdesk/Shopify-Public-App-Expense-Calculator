import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // No global DB setup here — DB-integration fitness tests
    // (decisions/fitness-test-plan.md FT-02b/c, FT-05..FT-09, FT-14, FT-15b,
    // FT-17, FT-20) require a live Postgres dev-store, which is not
    // available in this scaffold environment. Only pure/static tests run
    // here; see tests/README.md.
  },
});
