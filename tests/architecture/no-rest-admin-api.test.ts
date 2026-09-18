import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Approximates FT-10 (REST prohibited, Req 2.2.4) and FT-11b (zero
// admin.graphql( call sites outside an empty allowlist — ADR-0006: the app
// makes NO Admin GraphQL call on any core path). Walks app/ source looking
// for the patterns those fitness tests ban.

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

describe("no REST usage, no Admin GraphQL calls (FT-10 / FT-11b approximation)", () => {
  const files = walk(APP_DIR);

  it("finds app source files to scan", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("no file calls admin.rest or hits a literal /admin/api/*.json REST path", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (/\badmin\.rest\b/.test(source) || /\/admin\/api\/[^\s'"`]*\.json/.test(source)) {
        offenders.push(file);
      }
    }
    expect(offenders, `REST usage found in: ${offenders.join(", ")}`).toEqual([]);
  });

  it("no file calls admin.graphql( — ADR-0006's zero-Admin-API-dependency invariant", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (/\badmin\.graphql\s*\(/.test(source)) {
        offenders.push(file);
      }
    }
    expect(
      offenders,
      `admin.graphql( call found outside the (currently empty) allowlist in: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});
