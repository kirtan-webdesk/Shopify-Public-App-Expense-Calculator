import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_EXPENSE_RULES } from "~/domain/expense-rule-defaults";
import { EXPENSE_CATEGORIES } from "~/domain/expense-categories";

// Default-CI (DB-free) guard for the G4-sprint-3.4 first-load seed-race fix.
// The real two-pool race against Postgres lives in
// tests/db/expense-rule-seed-race.db.test.ts (opt-in); these keep the design
// from regressing where CI can see it:
//   * the service seeds via the insert-IGNORE repository function and then
//     re-reads — it never routes the first-load seed through
//     replaceExpenseRulesForShop (find-then-create/update: unique violation
//     for the loser, and it would overwrite a concurrent winner's rows);
//   * the repository function is bulkCreate({ ignoreDuplicates: true }),
//     i.e. INSERT ... ON CONFLICT DO NOTHING, and threads a caller-supplied
//     transaction only if given (no nested connection under pool.max:1).

const ctx = { shopId: "11111111-1111-4111-8111-111111111111", shopDomain: "x.myshopify.com" } as never;

const repo = vi.hoisted(() => ({
  listExpenseRulesForShop: vi.fn(),
  replaceExpenseRulesForShop: vi.fn(),
  seedExpenseRulesIfMissing: vi.fn(),
}));
vi.mock("~/db/repositories/expense-rule.repository", () => repo);

describe("getOrSeedExpenseRules — seed via insert-ignore, then re-read (mocked repository)", () => {
  const row = (categoryKey: string, over: Record<string, unknown> = {}) => {
    const d = DEFAULT_EXPENSE_RULES.find((r) => r.categoryKey === categoryKey)!;
    return {
      categoryKey,
      enabled: true,
      ruleType: d.ruleType,
      rateBasisPoints: d.rateBasisPoints,
      fixedAmountMinor: d.fixedAmountMinor === null ? null : String(d.fixedAmountMinor),
      formulaKey: d.formulaKey,
      ...over,
    };
  };

  beforeEach(() => {
    for (const f of Object.values(repo)) f.mockReset();
  });

  it("no rules yet: seeds the 10 defaults through seedExpenseRulesIfMissing (never replaceExpenseRulesForShop), then re-reads", async () => {
    const { getOrSeedExpenseRules } = await import("~/services/expense-rule.service");
    repo.listExpenseRulesForShop
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(EXPENSE_CATEGORIES.map((c) => row(c.key)));
    repo.seedExpenseRulesIfMissing.mockResolvedValue(undefined);

    const views = await getOrSeedExpenseRules(ctx);

    expect(repo.replaceExpenseRulesForShop).not.toHaveBeenCalled();
    expect(repo.seedExpenseRulesIfMissing).toHaveBeenCalledTimes(1);
    const inputs = repo.seedExpenseRulesIfMissing.mock.calls[0]![1] as Array<Record<string, unknown>>;
    expect(inputs).toHaveLength(10);
    expect(inputs.map((i) => i.categoryKey).sort()).toEqual(DEFAULT_EXPENSE_RULES.map((d) => d.categoryKey).sort());
    for (const i of inputs) {
      const d = DEFAULT_EXPENSE_RULES.find((r) => r.categoryKey === i.categoryKey)!;
      expect(i).toEqual({
        categoryKey: d.categoryKey,
        ruleType: d.ruleType,
        rateBasisPoints: d.rateBasisPoints,
        fixedAmountMinor: d.fixedAmountMinor,
        formulaKey: d.formulaKey,
        enabled: true,
      });
    }
    expect(repo.listExpenseRulesForShop).toHaveBeenCalledTimes(2); // read, seed, RE-READ
    expect(views).toHaveLength(10);
  });

  it("a concurrent seeder won: the re-read's rows (customised) are returned, not the defaults we tried to insert", async () => {
    const { getOrSeedExpenseRules } = await import("~/services/expense-rule.service");
    repo.listExpenseRulesForShop
      .mockResolvedValueOnce([]) // we saw nothing...
      .mockResolvedValueOnce(
        // ...but by the re-read the winner's rows exist, one customised.
        EXPENSE_CATEGORIES.map((c) => (c.key === "marketing" ? row(c.key, { rateBasisPoints: 4242 }) : row(c.key))),
      );
    repo.seedExpenseRulesIfMissing.mockResolvedValue(undefined); // ON CONFLICT DO NOTHING: no throw

    const views = await getOrSeedExpenseRules(ctx);
    expect(views.find((v) => v.categoryKey === "marketing")!.rateBasisPoints).toBe(4242);
    expect(repo.replaceExpenseRulesForShop).not.toHaveBeenCalled();
  });

  it("rules already exist: no seed at all", async () => {
    const { getOrSeedExpenseRules } = await import("~/services/expense-rule.service");
    repo.listExpenseRulesForShop.mockResolvedValueOnce(EXPENSE_CATEGORIES.map((c) => row(c.key)));
    await getOrSeedExpenseRules(ctx);
    expect(repo.seedExpenseRulesIfMissing).not.toHaveBeenCalled();
    expect(repo.replaceExpenseRulesForShop).not.toHaveBeenCalled();
  });
});

describe("static: the first-load seed path cannot regress to create-or-update", () => {
  const src = readFileSync(join(process.cwd(), "app", "services", "expense-rule.service.ts"), "utf8");
  const fn = /export async function getOrSeedExpenseRules[\s\S]*?\n}\r?\n/.exec(src)?.[0] ?? "";

  it("getOrSeedExpenseRules exists and seeds via seedExpenseRulesIfMissing", () => {
    expect(fn.length).toBeGreaterThan(0);
    expect(fn).toMatch(/await seedExpenseRulesIfMissing\(/);
  });

  it("getOrSeedExpenseRules never calls replaceExpenseRulesForShop / upsertExpenseRule", () => {
    expect(fn).not.toMatch(/replaceExpenseRulesForShop\(/);
    expect(fn).not.toMatch(/upsertExpenseRule\(/);
  });

  it("the repository's seed function uses bulkCreate with ignoreDuplicates: true", () => {
    const repoSrc = readFileSync(join(process.cwd(), "app", "db", "repositories", "expense-rule.repository.ts"), "utf8");
    const seed = /export async function seedExpenseRulesIfMissing[\s\S]*?\n}\r?\n/.exec(repoSrc)?.[0] ?? "";
    expect(seed.length).toBeGreaterThan(0);
    expect(seed).toMatch(/\.bulkCreate\(/);
    expect(seed).toMatch(/ignoreDuplicates:\s*true/);
    expect(seed).not.toMatch(/\.create\(|\.upsert\(|\.update\(|\.save\(/);
  });
});
