import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Approximates FT-21 (ADR-0009 D1, G1.5-revision): no recurring in-process
// scheduler anywhere in the server bundle. On Vercel a setInterval loop
// started as a module-scope side effect has no guarantee of ever firing
// again after the first response — the GDPR compliance mechanism now
// depends entirely on the two HTTP-invoked tiers (fast: after-response.server.ts,
// slow: api.cron.tick.tsx), never on a timer.

const APP_DIR = join(process.cwd(), "app");
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, out);
    } else if (SOURCE_EXTENSIONS.has(entry.slice(entry.lastIndexOf(".")))) {
      out.push(full);
    }
  }
  return out;
}

describe("no in-process scheduler (FT-21 approximation, ADR-0009 D1)", () => {
  it("app/workers/bootstrap.server.ts does not exist", () => {
    expect(existsSync(join(APP_DIR, "workers", "bootstrap.server.ts"))).toBe(false);
  });

  it("entry.server.tsx does not import bootstrap.server", () => {
    // Matches an actual import statement, not a historical explanatory
    // comment mentioning the removed module/function by name (which the
    // file legitimately still carries, for context) — a bare
    // startBackgroundWorkers() call with no corresponding import would fail
    // typecheck anyway (npm run typecheck, run separately), so the import
    // check alone is the load-bearing assertion here.
    const source = readFileSync(join(APP_DIR, "entry.server.tsx"), "utf8");
    expect(source).not.toMatch(/from\s+["'][^"']*bootstrap\.server["']/);
  });

  it("no module-scope setInterval( call exists anywhere under app/", () => {
    const files = walk(APP_DIR);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(
        source,
        `${file} calls setInterval( — a recurring in-process timer has no ` +
          "guarantee of firing on Vercel (ADR-0009 D1). Compliance work must " +
          "be invoked over HTTP (after-response.server.ts fast tier, " +
          "api.cron.tick.tsx slow tier), never a timer.",
      ).not.toMatch(/setInterval\s*\(/);
    }
  });
});
