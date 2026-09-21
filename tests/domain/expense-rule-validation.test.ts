import { describe, expect, it } from "vitest";
import {
  describeDecimalProblem,
  hasAnyFieldError,
  isSupportedCurrencyCode,
  parseDecimalString,
  validateCurrencyCode,
  validateExpenseRuleRow,
  validateFixedAmount,
  validateFormulaKey,
  validatePercentageRate,
  validateRevenueMinor,
  validateRevenueText,
} from "~/domain/expense-rule-validation";

describe("parseDecimalString (ADR-0005 — no float parsing of merchant input)", () => {
  it("parses a whole number", () => {
    expect(parseDecimalString("450", 2)).toBe(45_000);
  });

  it("parses a decimal with the maximum allowed precision", () => {
    expect(parseDecimalString("32.50", 2)).toBe(3_250);
    expect(parseDecimalString("32.5", 2)).toBe(3_250);
  });

  it("accepts commas only as proper thousands separators", () => {
    expect(parseDecimalString("12,500.50", 2)).toBe(1_250_050);
    expect(parseDecimalString("1,234", 2)).toBe(123_400);
    expect(parseDecimalString("1,234,567.8", 2)).toBe(123_456_780);
    expect(parseDecimalString("999", 2)).toBe(99_900);
  });

  it("rejects a comma anywhere else instead of dropping it (\"1,5\" must never read as 15.00)", () => {
    expect(parseDecimalString("1,5", 2)).toBeNull();
    expect(parseDecimalString("1,50", 2)).toBeNull();
    expect(parseDecimalString("12,34", 2)).toBeNull();
    expect(parseDecimalString("1234,567", 2)).toBeNull(); // first group is 4 digits
    expect(parseDecimalString(",500", 2)).toBeNull();
    expect(parseDecimalString("1,,000", 2)).toBeNull();
    expect(parseDecimalString("1,000,", 2)).toBeNull();
    expect(parseDecimalString("1.000,50", 2)).toBeNull(); // European grouping
    expect(parseDecimalString("1,000.5,0", 2)).toBeNull();
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

  it("validateRevenueMinor says \"zero or greater\" (not \"enter an amount\") for a negative", () => {
    expect(validateRevenueMinor(-1).error).toBe("Revenue amount must be zero or greater.");
    expect(validateRevenueMinor(null).error).toBe("Enter a revenue amount.");
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

describe("validateRevenueText — the revenue field's raw text, one validator for client and server", () => {
  function error(raw: string): string | undefined {
    const r = validateRevenueText(raw);
    return r.valid ? undefined : r.error;
  }

  it("empty (or whitespace only) -> \"Enter a revenue amount.\"", () => {
    expect(error("")).toBe("Enter a revenue amount.");
    expect(error("   ")).toBe("Enter a revenue amount.");
  });

  it("a leading minus -> \"Revenue amount must be zero or greater.\" (not the empty-field message)", () => {
    expect(error("-5")).toBe("Revenue amount must be zero or greater.");
    expect(error("-0.01")).toBe("Revenue amount must be zero or greater.");
    expect(error("  -1,000")).toBe("Revenue amount must be zero or greater.");
    expect(error("-")).toBe("Revenue amount must be zero or greater.");
  });

  it("valid values return the integer minor-units amount", () => {
    expect(validateRevenueText("0")).toEqual({ valid: true, revenueMinor: 0 });
    expect(validateRevenueText("0.00")).toEqual({ valid: true, revenueMinor: 0 });
    expect(validateRevenueText("1,234.50")).toEqual({ valid: true, revenueMinor: 123_450 });
    expect(validateRevenueText("  50000  ")).toEqual({ valid: true, revenueMinor: 5_000_000 });
    expect(validateRevenueText("10.5")).toEqual({ valid: true, revenueMinor: 1_050 });
    expect(validateRevenueText("007.50")).toEqual({ valid: true, revenueMinor: 750 });
  });

  it("each bad-decimal shape gets a message naming its own problem", () => {
    expect(error("10.555")).toBe("Use at most 2 decimal places.");
    expect(error("10.5000")).toBe("Use at most 2 decimal places.");
    expect(error(".5")).toBe("Enter a digit before the decimal point, for example 0.50.");
    expect(error("5.")).toBe("Remove the trailing decimal point or add digits after it.");
    expect(error("1e5")).toBe("Enter a plain number without an exponent, for example 100000 instead of 1e5.");
    expect(error("1E5")).toContain("without an exponent");
    expect(error("1,5")).toBe("Commas can only separate thousands, for example 1,234.50.");
    expect(error("12,34.00")).toBe("Commas can only separate thousands, for example 1,234.50.");
    expect(error("abc")).toBe("Enter a number using digits only, for example 1234.50.");
    expect(error("$100")).toBe("Enter a number using digits only, for example 1234.50.");
    expect(error("1.2.3")).toBe("Enter a number using digits only, for example 1234.50.");
    expect(error("+5")).toBe("Enter a number using digits only, for example 1234.50.");
    // none of these collapses into the empty-field message
    for (const raw of ["10.555", ".5", "5.", "1e5", "1,5", "abc"]) {
      expect(error(raw)).not.toBe("Enter a revenue amount.");
    }
  });

  it("over the limit -> the limit message (including digit strings too long to hold as an integer)", () => {
    const limit = "Revenue is larger than this calculator supports — check for a typo.";
    expect(error("10000000000")).toBe(limit); // 10^10 major = 10^12 minor > 999,999,999,999
    expect(error("99999999999999999999999")).toBe(limit);
    expect(validateRevenueText("9999999999.99")).toEqual({ valid: true, revenueMinor: 999_999_999_999 });
    expect(error("10000000000.00")).toBe(limit);
  });
});

describe("describeDecimalProblem", () => {
  it("returns null for syntactically fine input, including values that are merely too large", () => {
    expect(describeDecimalProblem("1,234.50", 2)).toBeNull();
    expect(describeDecimalProblem("0", 2)).toBeNull();
    expect(describeDecimalProblem("99999999999999999999999", 2)).toBeNull();
  });

  it("pluralises the decimal-places message for the requested precision", () => {
    expect(describeDecimalProblem("1.55", 1)).toBe("Use at most 1 decimal place.");
    expect(describeDecimalProblem("1.555", 2)).toBe("Use at most 2 decimal places.");
  });
});
