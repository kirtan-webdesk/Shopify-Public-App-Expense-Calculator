import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_EXPENSE_RULES } from "~/domain/expense-rule-defaults";

// calculateFromSavedRules (G2-revision v2, J1): Calculate runs on the shop's SAVED
// rules, loaded server-side. The input type has no rule field at all; these tests pin
// what it reads and what it never writes.

const repo = vi.hoisted(() => ({
  listExpenseRulesForShop: vi.fn(),
  replaceExpenseRulesForShop: vi.fn(),
  seedExpenseRulesIfMissing: vi.fn(),
}));
vi.mock("~/db/repositories/expense-rule.repository", () => repo);

import { calculateFromSavedRules, ruleViewToFormInput } from "~/services/expense-calculation.service";

const ctxA = { shopId: "11111111-1111-4111-8111-111111111111", shopDomain: "a.myshopify.com" } as never;
const ctxB = { shopId: "22222222-2222-4222-8222-222222222222", shopDomain: "b.myshopify.com" } as never;

const rows = (over: Record<string, Record<string, unknown>> = {}) =>
  DEFAULT_EXPENSE_RULES.map((d) => ({
    categoryKey: d.categoryKey,
    enabled: true,
    ruleType: d.ruleType,
    rateBasisPoints: d.rateBasisPoints,
    fixedAmountMinor: d.fixedAmountMinor === null ? null : String(d.fixedAmountMinor),
    formulaKey: d.formulaKey,
    ...(over[d.categoryKey] ?? {}),
  }));

describe("calculateFromSavedRules", () => {
  beforeEach(() => {
    for (const fn of Object.values(repo)) fn.mockReset();
    repo.listExpenseRulesForShop.mockResolvedValue(rows());
  });

  it("computes from the saved rules of the shop it is given (and only that shop)", async () => {
    repo.listExpenseRulesForShop.mockImplementation(async (ctx: { shopId: string }) =>
      ctx.shopId === "1".repeat(8) + "-1111-4111-8111-111111111111"
        ? rows({ marketing: { rateBasisPoints: 1000 } })
        : rows({ marketing: { rateBasisPoints: 2000 } }),
    );
    const a = await calculateFromSavedRules(ctxA, { revenueText: "1000", currencyCode: "USD" });
    const b = await calculateFromSavedRules(ctxB, { revenueText: "1000", currencyCode: "USD" });
    if (!a.ok || !b.ok) throw new Error("expected success");
    expect(a.result.lineItems.find((l) => l.categoryKey === "marketing")!.computedAmountMinor).toBe(10_000);
    expect(b.result.lineItems.find((l) => l.categoryKey === "marketing")!.computedAmountMinor).toBe(20_000);
    expect(repo.listExpenseRulesForShop.mock.calls.map((c) => c[0])).toEqual([ctxA, ctxB]);
  });

  it("leaves a saved-off category out", async () => {
    repo.listExpenseRulesForShop.mockResolvedValue(rows({ misc: { enabled: false } }));
    const r = await calculateFromSavedRules(ctxA, { revenueText: "1000", currencyCode: "USD" });
    if (!r.ok) throw new Error("expected success");
    expect(r.result.lineItems.map((l) => l.categoryKey)).not.toContain("misc");
  });

  it("a saved rule with an unusable value (enabled, no amount) fails as savedRulesInvalid, not as a silent zero", async () => {
    repo.listExpenseRulesForShop.mockResolvedValue(rows({ shipping: { fixedAmountMinor: null } }));
    const r = await calculateFromSavedRules(ctxA, { revenueText: "1000", currencyCode: "USD" });
    expect(r).toMatchObject({ ok: false, savedRulesInvalid: true });
  });

  it("form errors (revenue / currency) are reported without saved-rule blame", async () => {
    const r = await calculateFromSavedRules(ctxA, { revenueText: "-1", currencyCode: "JPY" });
    expect(r).toEqual({
      ok: false,
      revenueError: "Revenue amount must be zero or greater.",
      currencyError: "Choose a supported currency.",
      savedRulesInvalid: false,
    });
  });

  it("never writes rules (no replace, and no seed when rules already exist)", async () => {
    await calculateFromSavedRules(ctxA, { revenueText: "1000", currencyCode: "USD" });
    expect(repo.replaceExpenseRulesForShop).not.toHaveBeenCalled();
    expect(repo.seedExpenseRulesIfMissing).not.toHaveBeenCalled();
  });

  it("extra properties on the input object cannot smuggle rules in (the type has no rule field, and none is read)", async () => {
    const smuggled = {
      revenueText: "1000",
      currencyCode: "USD",
      rows: [{ categoryKey: "misc", enabled: true, ruleType: "fixed", rateBasisPoints: null, fixedAmountMinor: 1, formulaKey: null }],
      rules: [{ categoryKey: "misc", enabled: true, ruleType: "fixed", fixedAmountMinor: 1 }],
    };
    const r = await calculateFromSavedRules(ctxA, smuggled);
    const clean = await calculateFromSavedRules(ctxA, { revenueText: "1000", currencyCode: "USD" });
    expect(r).toEqual(clean);
  });

  it("ruleViewToFormInput is a pure shape translation", () => {
    expect(
      ruleViewToFormInput({
        categoryKey: "shipping",
        categoryLabel: "Shipping",
        sortOrder: 4,
        enabled: false,
        ruleType: "fixed",
        rateBasisPoints: null,
        fixedAmountMinor: 45_000,
        formulaKey: null,
      }),
    ).toEqual({ categoryKey: "shipping", enabled: false, ruleType: "fixed", rateBasisPoints: null, fixedAmountMinor: 45_000, formulaKey: null });
  });
});
