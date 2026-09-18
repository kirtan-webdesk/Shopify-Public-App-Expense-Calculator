import { describe, expect, it } from "vitest";
import {
  hasAnyFieldError,
  isSupportedCurrencyCode,
  parseDecimalString,
  validateCurrencyCode,
  validateExpenseRuleRow,
  validateFixedAmount,
  validateFormulaKey,
  validatePercentageRate,
  validateRevenueMinor,
} from "~/domain/expense-rule-validation";

describe("parseDecimalString (ADR-0005 — no float parsing of merchant input)", () => {
  it("parses a whole number", () => {
    expect(parseDecimalString("450", 2)).toBe(45_000);
  });

  it("parses a decimal with the maximum allowed precision", () => {
    expect(parseDecimalString("32.50", 2)).toBe(3_250);
    expect(parseDecimalString("32.5", 2)).toBe(3_250);
  });

  it("strips thousands-separator commas", () => {
    expect(parseDecimalString("12,500.50", 2)).toBe(1_250_050);
  });

  it("rejects more fractional digits than allowed", () => {
    expect(parseDecimalString("32.555", 2)).toBeNull();
  });

  it("rejects negative numbers, empty strings, and garbage", () => {
    expect(parseDecimalString("-5", 2)).toBeNull();
    expect(parseDecimalString("", 2)).toBeNull();
    expect(parseDecimalString("abc", 2)).toBeNull();
    expect(parseDecimalString("  ", 2)).toBeNull();
  });

  it("handles zero and leading zeros", () => {
    expect(parseDecimalString("0", 2)).toBe(0);
    expect(parseDecimalString("0.00", 2)).toBe(0);
    expect(parseDecimalString("007.50", 2)).toBe(750);
  });
});

describe("field validators", () => {
  it("validateRevenueMinor accepts zero and positive integers", () => {
    expect(validateRevenueMinor(0).valid).toBe(true);
    expect(validateRevenueMinor(100).valid).toBe(true);
  });

  it("validateRevenueMinor rejects null, negative, and absurdly large values", () => {
    expect(validateRevenueMinor(null).valid).toBe(false);
    expect(validateRevenueMinor(-1).valid).toBe(false);
    expect(validateRevenueMinor(1e15).valid).toBe(false);
  });

  it("validateCurrencyCode only accepts the supported set", () => {
    expect(validateCurrencyCode("USD").valid).toBe(true);
    expect(validateCurrencyCode("JPY").valid).toBe(false);
    expect(isSupportedCurrencyCode("CAD")).toBe(true);
  });

  it("validatePercentageRate rejects negative and out-of-range values", () => {
    expect(validatePercentageRate(0).valid).toBe(true);
    expect(validatePercentageRate(3250).valid).toBe(true);
    expect(validatePercentageRate(-1).valid).toBe(false);
    expect(validatePercentageRate(999_999).valid).toBe(false);
    expect(validatePercentageRate(null).valid).toBe(false);
  });

  it("validateFixedAmount rejects negative and out-of-range values", () => {
    expect(validateFixedAmount(0).valid).toBe(true);
    expect(validateFixedAmount(-1).valid).toBe(false);
    expect(validateFixedAmount(9_999_999_999).valid).toBe(false);
  });

  it("validateFormulaKey only accepts a known formula key", () => {
    expect(validateFormulaKey("tiered_by_revenue_band").valid).toBe(true);
    expect(validateFormulaKey("made_up_formula").valid).toBe(false);
    expect(validateFormulaKey(null).valid).toBe(false);
  });
});

describe("validateExpenseRuleRow (mirrors the DB chk_expense_rule_value_shape constraint)", () => {
  it("accepts a valid percentage row", () => {
    const errors = validateExpenseRuleRow({
      categoryKey: "cost_of_goods",
      enabled: true,
      ruleType: "percentage",
      rateBasisPoints: 3250,
      fixedAmountMinor: null,
      formulaKey: null,
    });
    expect(hasAnyFieldError(errors)).toBe(false);
  });

  it("rejects an invalid percentage value on an enabled row", () => {
    const errors = validateExpenseRuleRow({
      categoryKey: "cost_of_goods",
      enabled: true,
      ruleType: "percentage",
      rateBasisPoints: -5,
      fixedAmountMinor: null,
      formulaKey: null,
    });
    expect(hasAnyFieldError(errors)).toBe(true);
    expect(errors.rateBasisPoints).toBeDefined();
  });

  it("rejects an unknown category key", () => {
    const errors = validateExpenseRuleRow({
      categoryKey: "not_real",
      enabled: true,
      ruleType: "percentage",
      rateBasisPoints: 100,
      fixedAmountMinor: null,
      formulaKey: null,
    });
    expect(errors.categoryKey).toBeDefined();
  });

  it("rejects an unknown rule type", () => {
    const errors = validateExpenseRuleRow({
      categoryKey: "cost_of_goods",
      enabled: true,
      ruleType: "percentage_ish",
      rateBasisPoints: 100,
      fixedAmountMinor: null,
      formulaKey: null,
    });
    expect(errors.ruleType).toBeDefined();
  });

  it("validates a formula row against the known formula set", () => {
    const errors = validateExpenseRuleRow({
      categoryKey: "payroll",
      enabled: true,
      ruleType: "formula",
      rateBasisPoints: null,
      fixedAmountMinor: null,
      formulaKey: "not_a_real_formula",
    });
    expect(errors.formulaKey).toBeDefined();
  });
});
