import { describe, expect, it } from "vitest";
import {
  EXPENSE_FORMULAS,
  computeFormulaAmountMinor,
  isExpenseFormulaKey,
} from "~/domain/expense-formulas";

describe("expense-formulas (fixed, app-defined pattern set — no user-authored expressions)", () => {
  it("has a small fixed, non-empty set of formulas", () => {
    expect(EXPENSE_FORMULAS.length).toBeGreaterThan(0);
    expect(EXPENSE_FORMULAS.length).toBeLessThanOrEqual(5);
  });

  it("isExpenseFormulaKey rejects anything not in the fixed set", () => {
    expect(isExpenseFormulaKey("tiered_by_revenue_band")).toBe(true);
    expect(isExpenseFormulaKey("eval(1+1)")).toBe(false);
    expect(isExpenseFormulaKey("")).toBe(false);
  });

  it("computeFormulaAmountMinor throws on an unknown key rather than guessing", () => {
    expect(() => computeFormulaAmountMinor("nonexistent", 1000)).toThrow();
  });

  it("computeFormulaAmountMinor is deterministic and integer-only", () => {
    const a = computeFormulaAmountMinor("tiered_by_revenue_band", 750_000);
    const b = computeFormulaAmountMinor("tiered_by_revenue_band", 750_000);
    expect(a).toBe(b);
    expect(Number.isInteger(a)).toBe(true);
  });

  it("tiered_by_revenue_band applies the correct band boundaries", () => {
    // <= $10,000 (1,000,000) -> 5%
    expect(computeFormulaAmountMinor("tiered_by_revenue_band", 1_000_000)).toBe(50_000);
    // just above $10,000 -> 3.5% band
    expect(computeFormulaAmountMinor("tiered_by_revenue_band", 1_000_001)).toBe(35_000);
    // above $250,000 -> 1% band
    expect(computeFormulaAmountMinor("tiered_by_revenue_band", 30_000_000)).toBe(300_000);
  });

  it("base_fee_plus_marginal_percent applies the base fee with no marginal below the threshold", () => {
    // revenue below the $20,000 threshold -> base fee only
    expect(computeFormulaAmountMinor("base_fee_plus_marginal_percent", 500_000)).toBe(2_500);
  });

  it("base_fee_plus_marginal_percent adds the marginal percentage above the threshold", () => {
    // $30,000 revenue -> base $25 + 1% of ($30,000 - $20,000) = 2500 + 10000 = 12500
    expect(computeFormulaAmountMinor("base_fee_plus_marginal_percent", 3_000_000)).toBe(12_500);
  });

  it("rejects a negative or non-integer revenue", () => {
    expect(() => computeFormulaAmountMinor("tiered_by_revenue_band", -1)).toThrow(TypeError);
    expect(() => computeFormulaAmountMinor("tiered_by_revenue_band", 1.5)).toThrow(TypeError);
  });
});
