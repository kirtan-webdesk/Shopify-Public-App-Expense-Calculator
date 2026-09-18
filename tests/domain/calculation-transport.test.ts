import { describe, expect, it } from "vitest";
import { calculateExpenses } from "~/domain/expense-engine";
import { decodeCalculationResult, encodeCalculationResult } from "~/domain/calculation-transport";

describe("calculation-transport (encode/decode round trip)", () => {
  it("round-trips a typical calculation exactly", () => {
    const result = calculateExpenses({
      revenueMinor: 5_000_000,
      currencyCode: "USD",
      rules: [
        { categoryKey: "cost_of_goods", enabled: true, ruleType: "percentage", rateBasisPoints: 3250, fixedAmountMinor: null, formulaKey: null },
        { categoryKey: "shipping", enabled: true, ruleType: "fixed", rateBasisPoints: null, fixedAmountMinor: 45_000, formulaKey: null },
        { categoryKey: "payroll", enabled: true, ruleType: "formula", rateBasisPoints: null, fixedAmountMinor: null, formulaKey: "tiered_by_revenue_band" },
        { categoryKey: "marketing", enabled: false, ruleType: "percentage", rateBasisPoints: 800, fixedAmountMinor: null, formulaKey: null },
      ],
    });

    const encoded = encodeCalculationResult(result);
    expect(typeof encoded).toBe("string");
    expect(encoded.length).toBeGreaterThan(0);
    // sanity: stays well under any realistic URL length concern
    expect(encoded.length).toBeLessThan(1500);

    const decoded = decodeCalculationResult(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded!.engineVersion).toBe(result.engineVersion);
    expect(decoded!.revenueMinor).toBe(result.revenueMinor);
    expect(decoded!.currencyCode).toBe(result.currencyCode);
    expect(decoded!.totalExpensesMinor).toBe(result.totalExpensesMinor);
    expect(decoded!.netAmountMinor).toBe(result.netAmountMinor);
    expect(decoded!.lineItems).toHaveLength(result.lineItems.length);
    for (let i = 0; i < result.lineItems.length; i++) {
      expect(decoded!.lineItems[i]?.categoryKey).toBe(result.lineItems[i]?.categoryKey);
      expect(decoded!.lineItems[i]?.computedAmountMinor).toBe(result.lineItems[i]?.computedAmountMinor);
      expect(decoded!.lineItems[i]?.ruleType).toBe(result.lineItems[i]?.ruleType);
    }
  });

  it("returns null for garbage input rather than throwing", () => {
    expect(decodeCalculationResult("not-valid-base64url-json!!")).toBeNull();
    expect(decodeCalculationResult("")).toBeNull();
  });

  it("returns null for a well-formed but structurally wrong payload", () => {
    const bogus = Buffer.from(JSON.stringify({ v: 2, foo: "bar" }), "utf8").toString("base64url");
    expect(decodeCalculationResult(bogus)).toBeNull();
  });

  it("round-trips the zero-revenue / empty-line-items degenerate state", () => {
    const result = calculateExpenses({ revenueMinor: 0, currencyCode: "USD", rules: [] });
    const decoded = decodeCalculationResult(encodeCalculationResult(result));
    expect(decoded?.lineItems).toHaveLength(0);
    expect(decoded?.totalExpensesMinor).toBe(0);
  });
});
