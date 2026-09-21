import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExpenseRuleFormInput } from "~/domain/expense-rule-validation";
import { EXPENSE_CATEGORIES } from "~/domain/expense-categories";
import { DEFAULT_EXPENSE_RULES } from "~/domain/expense-rule-defaults";

// G4-sprint-3.5 C: "Save rules -> 500". A category whose value was cleared AND
// which was then switched off used to be written with a NULL in the column for
// its rule type, violating chk_expense_rule_value_shape (an unhandled DB error
// -> the root error boundary and a lost form). The service must reject it as a
// field error and write NOTHING.

const repo = vi.hoisted(() => ({
  listExpenseRulesForShop: vi.fn(),
  replaceExpenseRulesForShop: vi.fn(),
  seedExpenseRulesIfMissing: vi.fn(),
}));
vi.mock("~/db/repositories/expense-rule.repository", () => repo);

import { saveExpenseRules } from "~/services/expense-rule.service";

const ctx = { shopId: "11111111-1111-4111-8111-111111111111", shopDomain: "x.myshopify.com" } as never;

function allDefaultRows(): ExpenseRuleFormInput[] {
  return DEFAULT_EXPENSE_RULES.map((d) => ({
    categoryKey: d.categoryKey,
    enabled: true,
    ruleType: d.ruleType,
    rateBasisPoints: d.rateBasisPoints,
    fixedAmountMinor: d.fixedAmountMinor,
    formulaKey: d.formulaKey,
  }));
}

describe("saveExpenseRules — every row must carry a valid value, enabled or not", () => {
  beforeEach(() => {
    repo.replaceExpenseRulesForShop.mockReset();
    repo.replaceExpenseRulesForShop.mockResolvedValue(undefined);
  });

  it("all valid rows: writes all of them in one call", async () => {
    const result = await saveExpenseRules(ctx, allDefaultRows());
    expect(result).toEqual({ ok: true, fieldErrors: {} });
    expect(repo.replaceExpenseRulesForShop).toHaveBeenCalledTimes(1);
    expect(repo.replaceExpenseRulesForShop.mock.calls[0]![1]).toHaveLength(EXPENSE_CATEGORIES.length);
  });

  it("shipping {enabled:false, fixed, null value}: ok:false + a fieldError, nothing written", async () => {
    const rows = allDefaultRows().map((r) =>
      r.categoryKey === "shipping"
        ? { ...r, enabled: false, ruleType: "fixed", rateBasisPoints: null, fixedAmountMinor: null, formulaKey: null }
        : r,
    );
    const result = await saveExpenseRules(ctx, rows);
    expect(result.ok).toBe(false);
    expect(result.fieldErrors.shipping?.fixedAmountMinor).toBe("Enter an amount of 0 or greater.");
    expect(Object.keys(result.fieldErrors)).toEqual(["shipping"]);
    expect(repo.replaceExpenseRulesForShop).not.toHaveBeenCalled();
  });

  it("a disabled percentage row with a cleared value is rejected the same way", async () => {
    const rows = allDefaultRows().map((r) =>
      r.categoryKey === "marketing" ? { ...r, enabled: false, rateBasisPoints: null } : r,
    );
    const result = await saveExpenseRules(ctx, rows);
    expect(result.ok).toBe(false);
    expect(result.fieldErrors.marketing?.rateBasisPoints).toBe("Enter a percentage of 0 or greater.");
    expect(repo.replaceExpenseRulesForShop).not.toHaveBeenCalled();
  });

  it("a disabled formula row with no formula is rejected", async () => {
    const rows = allDefaultRows().map((r) =>
      r.categoryKey === "payroll"
        ? { ...r, enabled: false, ruleType: "formula", rateBasisPoints: null, fixedAmountMinor: null, formulaKey: null }
        : r,
    );
    const result = await saveExpenseRules(ctx, rows);
    expect(result.ok).toBe(false);
    expect(result.fieldErrors.payroll?.formulaKey).toBe("Choose a formula.");
    expect(repo.replaceExpenseRulesForShop).not.toHaveBeenCalled();
  });

  it("a disabled row that DOES hold a valid value is saved (disabled is preserved, not dropped)", async () => {
    const rows = allDefaultRows().map((r) => (r.categoryKey === "shipping" ? { ...r, enabled: false } : r));
    const result = await saveExpenseRules(ctx, rows);
    expect(result.ok).toBe(true);
    const written = repo.replaceExpenseRulesForShop.mock.calls[0]![1] as { categoryKey: string; enabled: boolean; fixedAmountMinor: number | null }[];
    const shipping = written.find((w) => w.categoryKey === "shipping")!;
    expect(shipping.enabled).toBe(false);
    expect(shipping.fixedAmountMinor).toBe(45_000);
  });

  it("errors on several rows are all reported and still nothing is written", async () => {
    const rows = allDefaultRows().map((r) => {
      if (r.categoryKey === "shipping") return { ...r, enabled: false, fixedAmountMinor: null };
      if (r.categoryKey === "cost_of_goods") return { ...r, rateBasisPoints: -5 };
      return r;
    });
    const result = await saveExpenseRules(ctx, rows);
    expect(result.ok).toBe(false);
    expect(Object.keys(result.fieldErrors).sort()).toEqual(["cost_of_goods", "shipping"]);
    expect(repo.replaceExpenseRulesForShop).not.toHaveBeenCalled();
  });

  it("only the active rule type's value is written; the others are null (chk_expense_rule_value_shape)", async () => {
    const rows = allDefaultRows().map((r) =>
      r.categoryKey === "marketing" ? { ...r, ruleType: "fixed", fixedAmountMinor: 1200, rateBasisPoints: 800 } : r,
    );
    await saveExpenseRules(ctx, rows);
    const written = repo.replaceExpenseRulesForShop.mock.calls[0]![1] as { categoryKey: string; rateBasisPoints: number | null; fixedAmountMinor: number | null; formulaKey: string | null }[];
    expect(written.find((w) => w.categoryKey === "marketing")).toMatchObject({
      rateBasisPoints: null,
      fixedAmountMinor: 1200,
      formulaKey: null,
    });
  });
});
