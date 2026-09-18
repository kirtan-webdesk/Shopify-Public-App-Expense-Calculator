import { describe, expect, it } from "vitest";
import { calculateExpenses, ENGINE_VERSION, type EngineRuleInput } from "~/domain/expense-engine";
import { EXPENSE_CATEGORIES } from "~/domain/expense-categories";

function rule(overrides: Partial<EngineRuleInput> & Pick<EngineRuleInput, "categoryKey">): EngineRuleInput {
  return {
    enabled: true,
    ruleType: "percentage",
    rateBasisPoints: 0,
    fixedAmountMinor: null,
    formulaKey: null,
    ...overrides,
  };
}

describe("expense-engine (ADR-0005 — determinism, rounding, reconciliation)", () => {
  it("has a real engine version constant", () => {
    expect(ENGINE_VERSION).toMatch(/^expense-engine@/);
  });

  it("is deterministic: identical inputs produce byte-identical output across repeated runs", () => {
    const input = {
      revenueMinor: 5_000_001, // deliberately awkward, not a round number
      currencyCode: "USD",
      rules: [
        rule({ categoryKey: "cost_of_goods", rateBasisPoints: 3250 }),
        rule({ categoryKey: "marketing", rateBasisPoints: 800 }),
        rule({ categoryKey: "payroll", rateBasisPoints: 1800 }),
        rule({ categoryKey: "shipping", ruleType: "fixed", fixedAmountMinor: 45_000, rateBasisPoints: null }),
      ],
    };
    const results = Array.from({ length: 20 }, () => calculateExpenses(input));
    const first = JSON.stringify(results[0]);
    for (const r of results) {
      expect(JSON.stringify(r)).toBe(first);
    }
  });

  it("reconciles exactly: sum(lineItems) === total, even where naive per-category rounding would break it", () => {
    // revenue chosen so several percentage rules produce a fractional
    // number of minor units that does NOT divide evenly — this is the
    // case largest-remainder reconciliation exists for.
    // e.g. 10001 minor units * 3250bp / 10000 = 3250.325 -> rounds to 3250
    // individually, but the true continuous sum across all categories
    // rounds differently, and naive per-category rounding does not
    // guarantee the categories sum to that total.
    const revenueMinor = 10_001;
    const rules: EngineRuleInput[] = [
      rule({ categoryKey: "cost_of_goods", rateBasisPoints: 3250 }),
      rule({ categoryKey: "marketing", rateBasisPoints: 800 }),
      rule({ categoryKey: "platform_fees", rateBasisPoints: 290 }),
      rule({ categoryKey: "payment_processing", rateBasisPoints: 260 }),
      rule({ categoryKey: "payroll", rateBasisPoints: 1800 }),
      rule({ categoryKey: "taxes", rateBasisPoints: 600 }),
      rule({ categoryKey: "misc", rateBasisPoints: 150 }),
    ];
    const result = calculateExpenses({ revenueMinor, currencyCode: "USD", rules });
    const sum = result.lineItems.reduce((s, li) => s + li.computedAmountMinor, 0);
    expect(sum).toBe(result.totalExpensesMinor);
  });

  it("reconciles exactly across a large randomized matrix of rule sets (property-style, FT-13d-equivalent)", () => {
    let seed = 42;
    function nextRandom() {
      // simple deterministic PRNG so the test itself stays deterministic
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    }
    for (let trial = 0; trial < 200; trial++) {
      const revenueMinor = Math.floor(nextRandom() * 10_000_000);
      const rules: EngineRuleInput[] = EXPENSE_CATEGORIES.map((c) => {
        const enabled = nextRandom() > 0.2;
        const bp = Math.floor(nextRandom() * 5000);
        return rule({ categoryKey: c.key, enabled, rateBasisPoints: bp });
      });
      const result = calculateExpenses({ revenueMinor, currencyCode: "USD", rules });
      const sum = result.lineItems.reduce((s, li) => s + li.computedAmountMinor, 0);
      expect(sum).toBe(result.totalExpensesMinor);
      // no category is negative
      for (const li of result.lineItems) {
        expect(li.computedAmountMinor).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("excludes disabled rules from the result entirely", () => {
    const result = calculateExpenses({
      revenueMinor: 100_000,
      currencyCode: "USD",
      rules: [
        rule({ categoryKey: "cost_of_goods", rateBasisPoints: 1000 }),
        rule({ categoryKey: "marketing", rateBasisPoints: 1000, enabled: false }),
      ],
    });
    expect(result.lineItems).toHaveLength(1);
    expect(result.lineItems[0]?.categoryKey).toBe("cost_of_goods");
    expect(result.totalExpensesMinor).toBe(10_000);
  });

  it("zero revenue: percentage categories are zero, fixed categories still apply", () => {
    const result = calculateExpenses({
      revenueMinor: 0,
      currencyCode: "USD",
      rules: [
        rule({ categoryKey: "cost_of_goods", rateBasisPoints: 3250 }),
        rule({ categoryKey: "shipping", ruleType: "fixed", fixedAmountMinor: 45_000, rateBasisPoints: null }),
      ],
    });
    const cogs = result.lineItems.find((li) => li.categoryKey === "cost_of_goods");
    const shipping = result.lineItems.find((li) => li.categoryKey === "shipping");
    expect(cogs?.computedAmountMinor).toBe(0);
    expect(shipping?.computedAmountMinor).toBe(45_000);
    expect(result.revenueMinor).toBe(0);
  });

  it("net amount is revenue minus total, and can legitimately be negative (no clamping)", () => {
    const result = calculateExpenses({
      revenueMinor: 1000,
      currencyCode: "USD",
      rules: [rule({ categoryKey: "cost_of_goods", ruleType: "fixed", fixedAmountMinor: 5000, rateBasisPoints: null })],
    });
    expect(result.netAmountMinor).toBe(1000 - 5000);
    expect(result.netAmountMinor).toBeLessThan(0);
  });

  it("half-away-from-zero rounding: an exact .5 remainder rounds up", () => {
    // revenue=10, rate=2500bp (25%) -> raw = 10*2500=25000, /10000 = 2.5 exactly
    // -> rounds to 3 (half away from zero), reconciled to a single category.
    const result = calculateExpenses({
      revenueMinor: 10,
      currencyCode: "USD",
      rules: [rule({ categoryKey: "cost_of_goods", rateBasisPoints: 2500 })],
    });
    expect(result.totalExpensesMinor).toBe(3);
    expect(result.lineItems[0]?.computedAmountMinor).toBe(3);
  });

  it("largest-remainder ties break by the fixed category sort order", () => {
    // Two categories with IDENTICAL fractional remainders — the tie must
    // resolve to the category with the lower (earlier) sortOrder every time.
    // revenue=3, rate=3333bp for both -> raw=3*3333=9999, /10000 = 0.9999
    // base=0, remainder=9999 for both; total = round(0.9999*2) = round(1.9998) = 2
    // baseSum=0, leftover=2 -> BOTH get +1 this time (leftover==count), so
    // instead use a case where leftover < count to actually test the tie-break.
    const result = calculateExpenses({
      revenueMinor: 3,
      currencyCode: "USD",
      rules: [
        rule({ categoryKey: "misc", rateBasisPoints: 1667 }), // later sortOrder (9)
        rule({ categoryKey: "cost_of_goods", rateBasisPoints: 1667 }), // earlier sortOrder (0)
        rule({ categoryKey: "taxes", rateBasisPoints: 1667 }), // sortOrder 8
      ],
    });
    // raw per category = 3*1667 = 5001 -> base=0, remainder=5001 (identical
    // for all three); total raw = 15003 -> round(15003/10000)=round(1.5003)=2
    // baseSum=0, leftover=2 -> two of the three tied categories get +1,
    // chosen by ascending sortOrder: cost_of_goods (0) and taxes (8), not misc (9).
    const cogs = result.lineItems.find((li) => li.categoryKey === "cost_of_goods");
    const taxes = result.lineItems.find((li) => li.categoryKey === "taxes");
    const misc = result.lineItems.find((li) => li.categoryKey === "misc");
    expect(cogs?.computedAmountMinor).toBe(1);
    expect(taxes?.computedAmountMinor).toBe(1);
    expect(misc?.computedAmountMinor).toBe(0);
    const sum = result.lineItems.reduce((s, li) => s + li.computedAmountMinor, 0);
    expect(sum).toBe(result.totalExpensesMinor);
    expect(result.totalExpensesMinor).toBe(2);
  });

  it("formula rules contribute an already-rounded integer amount", () => {
    const result = calculateExpenses({
      revenueMinor: 3_000_000, // $30,000 -> above the $20,000 threshold
      currencyCode: "USD",
      rules: [rule({ categoryKey: "payroll", ruleType: "formula", formulaKey: "base_fee_plus_marginal_percent", rateBasisPoints: null })],
    });
    // base $25.00 (2500) + 1% of (3,000,000 - 2,000,000) = 2500 + 10000 = 12500
    expect(result.lineItems[0]?.computedAmountMinor).toBe(12_500);
    expect(result.totalExpensesMinor).toBe(12_500);
  });

  it("throws on an unknown category key (defensive assertion)", () => {
    expect(() =>
      calculateExpenses({
        revenueMinor: 100,
        currencyCode: "USD",
        // @ts-expect-error — deliberately invalid for this test
        rules: [rule({ categoryKey: "not_a_real_category" })],
      }),
    ).toThrow();
  });

  it("throws on a negative or non-integer revenue (defensive assertion)", () => {
    expect(() =>
      calculateExpenses({ revenueMinor: -1, currencyCode: "USD", rules: [] }),
    ).toThrow(TypeError);
    expect(() =>
      calculateExpenses({ revenueMinor: 1.5, currencyCode: "USD", rules: [] }),
    ).toThrow(TypeError);
  });
});
