import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Static guard: every /app page is registered in app/routes.ts UNDER the `app`
// layout route (so it inherits authenticate.admin), the new Expense rules page
// is among them, and no /app route file is orphaned.

const ROOT = process.cwd();
const routesSource = readFileSync(join(ROOT, "app", "routes.ts"), "utf8");
const appBlock = routesSource.slice(routesSource.indexOf('route("app", "routes/app.tsx"'));

describe("route registration (app/routes.ts)", () => {
  it("registers the Expense rules page at /app/rules, inside the app layout route", () => {
    expect(appBlock).toContain('route("rules", "routes/app.rules.tsx")');
    expect(routesSource.indexOf('route("rules", "routes/app.rules.tsx")')).toBeGreaterThan(
      routesSource.indexOf('route("app", "routes/app.tsx"'),
    );
  });

  it("registers every /app page under the layout: index, calculator, rules, results, history, history/:id", () => {
    for (const expected of [
      'index("routes/app._index.tsx")',
      'route("calculator", "routes/app.calculator.tsx")',
      'route("rules", "routes/app.rules.tsx")',
      'route("results", "routes/app.results.tsx")',
      'route("history", "routes/app.history.tsx")',
      'route("history/:id", "routes/app.history.$id.tsx")',
    ]) {
      expect(appBlock, expected).toContain(expected);
    }
  });

  it("every registered route file exists", () => {
    const files = [...routesSource.matchAll(/["'](routes\/[^"']+)["']/g)].map((m) => m[1]!);
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) expect(existsSync(join(ROOT, "app", f)), f).toBe(true);
  });

  it("every app.*.tsx route file is registered (no orphaned page)", () => {
    const appFiles = readdirSync(join(ROOT, "app", "routes")).filter((f) => /^app\..+\.tsx$/.test(f));
    expect(appFiles).toContain("app.rules.tsx");
    for (const f of appFiles) expect(routesSource, `${f} is not registered in app/routes.ts`).toContain(`routes/${f}`);
  });

  it("the Expense rules route is not registered as a webhook / top-level sibling (it must inherit the admin auth of the layout)", () => {
    const before = routesSource.slice(0, routesSource.indexOf('route("app", "routes/app.tsx"'));
    expect(before).not.toContain("app.rules.tsx");
  });
});
