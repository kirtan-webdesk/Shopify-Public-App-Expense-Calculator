import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Static guards for M4's structural promises (FT-14b approximation, D11):
//  - the history read/write path has no route to `expense_rule` (no import, no
//    reference), so a saved calculation cannot be re-derived from live config;
//  - calculations are append-only in normal operation: no update or delete
//    function exists in the calculation repository, and no route/service
//    exposes an update/delete for them.
// (The DB-level BEFORE UPDATE trigger and the query-log no-join assertion are
// covered against a real database in tests/db/calculation-history.db.test.ts.)

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

/** Strips block and line comments so a comment MENTIONING expense_rule (the
 * files explain that they don't use it) is not mistaken for using it. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("M4 history path never touches expense_rule (FT-14b approximation)", () => {
  const historyPathFiles = [
    "app/db/repositories/calculation.repository.ts",
    "app/services/calculation-history.service.ts",
    "app/components/saved-calculation-page.tsx",
    "app/routes/app.history.tsx",
    "app/routes/app.history.$id.tsx",
  ];

  it.each(historyPathFiles)("%s does not import or reference the expense_rule model/repository", (file) => {
    const code = stripComments(read(file));
    expect(code).not.toMatch(/expense-rule\.repository/);
    expect(code).not.toMatch(/expense-rule\.model/);
    expect(code).not.toMatch(/ExpenseRuleModel/);
    expect(code).not.toMatch(/expense_rule/);
  });

  it("the saved-calculation detail page never invokes the engine", () => {
    for (const file of [
      "app/components/saved-calculation-page.tsx",
      "app/routes/app.history.$id.tsx",
      "app/services/calculation-history.service.ts",
    ]) {
      const code = stripComments(read(file));
      // getSavedCalculation renders stored values; nothing may call the engine.
      expect(code, `${file} must not call calculateExpenses`).not.toMatch(/calculateExpenses\s*\(/);
    }
  });
});

describe("saved calculations are append-only in normal operation", () => {
  it("the calculation repository exports no update/delete/destroy function", () => {
    const code = stripComments(read("app/db/repositories/calculation.repository.ts"));
    const exported = [...code.matchAll(/export\s+async\s+function\s+(\w+)/g)].map((m) => m[1]);
    expect(exported.length).toBeGreaterThan(0);
    for (const name of exported) {
      expect(name, `unexpected mutating export "${name}"`).not.toMatch(/update|delete|destroy|remove|edit|upsert/i);
    }
    expect(code).not.toMatch(/\.destroy\s*\(/);
    expect(code).not.toMatch(/\.update\s*\(/);
    expect(code).not.toMatch(/\.upsert\s*\(/);
  });

  it("the history routes have no action (no write path from the detail or list page)", () => {
    for (const file of ["app/routes/app.history.tsx", "app/routes/app.history.$id.tsx"]) {
      const code = stripComments(read(file));
      expect(code, `${file} must not export an action`).not.toMatch(/export\s+(async\s+)?function\s+action/);
    }
  });

  it("the detail page renders no form control and no Save affordance", () => {
    const code = stripComments(read("app/components/saved-calculation-page.tsx"));
    expect(code).not.toMatch(/<input\b/);
    expect(code).not.toMatch(/<textarea\b/);
    expect(code).not.toMatch(/<select\b/);
    expect(code).not.toMatch(/<form\b/i);
    expect(code).not.toMatch(/<s-(text-field|number-field|money-field|select|checkbox|switch|text-area)\b/);
    expect(code).not.toMatch(/Save (this )?calculation/i);
  });
});
