import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Static guards for two Polaris web-component mistakes found by rendering the G2-revision
// mockup in a browser (G4-sprint-4.1), where they made the layout silently fall back to one column:
//   1. s-grid's container-query syntax splits branches on commas, so a comma INSIDE a branch
//      (`repeat(3, 1fr)`) is mis-parsed. Write the tracks out: "1fr 1fr 1fr".
//   2. `@container ...` values only measure inside an <s-query-container> ancestor.

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return name.endsWith(".tsx") ? [full] : [];
  });
}
const files = tsxFiles(join(process.cwd(), "app"));

describe("Polaris markup guards", () => {
  it("finds the app's tsx files", () => {
    expect(files.length).toBeGreaterThan(8);
  });

  it.each(files)("%s: no repeat() (a comma inside a branch) in an @container value", (file) => {
    const source = readFileSync(file, "utf8");
    for (const m of source.matchAll(/@container[^"'`]*/g)) {
      expect(m[0], `${file}: ${m[0]}`).not.toMatch(/repeat\(/);
    }
  });

  it.each(files)("%s: every @container value has an s-query-container in the same file", (file) => {
    const source = readFileSync(file, "utf8");
    if (!source.includes("@container")) return;
    expect(source, `${file} uses @container but no <s-query-container>`).toContain("<s-query-container>");
  });
});
