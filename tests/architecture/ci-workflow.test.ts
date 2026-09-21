import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Static guards on .github/workflows/app-ci.yml (G4-sprint-4.2). No YAML library is a dependency, so this reads the text.
// These do not prove the workflow RUNS (only GitHub can); they pin the safety-relevant shape so a later edit cannot
// quietly point CI's DB steps at anything but the throw-away service container, or drop the four mandatory gates.
const yml = readFileSync(join(process.cwd(), ".github", "workflows", "app-ci.yml"), "utf8").replace(/\r\n/g, "\n");
const code = yml
  .split("\n")
  .filter((l) => !/^\s*#/.test(l))
  .join("\n"); // comments may name variables; only the live YAML counts

describe(".github/workflows/app-ci.yml", () => {
  it("still runs the four mandatory gates with the exact scripts, without --if-present", () => {
    for (const cmd of ["npm run lint", "npm run typecheck", "npm test", "npm run build"]) {
      expect(code, cmd).toMatch(new RegExp(`run: ${cmd}\\n`));
    }
    expect(code).not.toContain("--if-present");
  });

  it("has a health-checked postgres service container", () => {
    expect(code).toMatch(/services:\n\s+postgres:\n\s+image: postgres:\d+/);
    expect(code).toMatch(/--health-cmd "pg_isready /);
    expect(code).toMatch(/--health-retries \d+/);
  });

  it("migrates with an EXPLICIT --env test and then runs the opt-in DB suites with RUN_DB_TESTS=1", () => {
    expect(code).toContain("run: npx sequelize-cli db:migrate --env test\n");
    expect(code).toContain("run: npx vitest run tests/db\n");
    expect(code).toMatch(/RUN_DB_TESTS: "1"/);
    // migrations run BEFORE the DB suites, and both come after the mandatory build
    expect(code.indexOf("db:migrate --env test")).toBeLessThan(code.indexOf("npx vitest run tests/db"));
    expect(code.indexOf("run: npm run build")).toBeLessThan(code.indexOf("db:migrate --env test"));
  });

  it("only ever points at the service container on 127.0.0.1, and only via the test-database variable", () => {
    const urls = code.match(/postgres(?:ql)?:\/\/[^\s"']+/g) ?? [];
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(u).toMatch(/^postgres:\/\/postgres:postgres@127\.0\.0\.1:5432\/expense_calculator_test$/);
    // no production / hosted connection variable or secret is defined or passed anywhere in the live YAML
    expect(code).not.toMatch(/(^|[^A-Z_])(DATABASE_URL|DIRECT_DATABASE_URL|ALLOW_HOSTED_DB)\b/m);
    expect(code).not.toMatch(/\$\{\{\s*secrets\./);
    // set on the two steps that need it, not job-wide (so `npm test` and the guard tests keep their environment)
    expect(code.match(/TEST_DATABASE_URL:/g)).toHaveLength(2);
    const jobHeader = code.slice(code.indexOf("build-test:"), code.indexOf("steps:"));
    expect(jobHeader).not.toContain("TEST_DATABASE_URL");
  });
});
