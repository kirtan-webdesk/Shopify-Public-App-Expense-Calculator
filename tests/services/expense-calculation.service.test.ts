import { describe, expect, it } from "vitest";
import { runCalculation } from "~/services/expense-calculation.service";
import type { ExpenseRuleFormInput } from "~/domain/expense-rule-validation";

// runCalculation takes the revenue field's RAW TEXT so a typed "-5" / "1e5" is
// reported with its real reason instead of collapsing into "Enter a revenue amount."

const shipping: ExpenseRuleFormInput = {
  categoryKey: "shipping",
  enabled: true,
  ruleType: "fixed",
  rateBasisPoints: null,
  fixedAmountMinor: 45_000,
  formulaKey: null,
};

function failure(revenueText: string, currencyCode = "USD", rows: readonly ExpenseRuleFormInput[] = [shipping]) {
  const r = runCalculation({ revenueText, currencyCode, rows });
  if (r.ok) throw new Error(`expected a failure for revenue ${JSON.stringify(revenueText)}`);
  return r;
}

describe("runCalculation (raw revenue text)", () => {
  it("succeeds at revenue 0 with a fixed-amount expense", () => {
    const r = runCalculation({ revenueText: "0", currencyCode: "USD", rows: [shipping] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.revenueMinor).toBe(0);
      expect(r.result.totalExpensesMinor).toBe(45_000);
      expect(r.result.netAmountMinor).toBe(-45_000);
    }
  });

  it("parses proper thousands grouping", () => {
    const r = runCalculation({ revenueText: "1,234.50", currencyCode: "CAD", rows: [] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.revenueMinor).toBe(123_450);
  });

  it("empty -> 'Enter a revenue amount.'", () => {
    expect(failure("").revenueError).toBe("Enter a revenue amount.");
  });

  it("negative -> 'Revenue amount must be zero or greater.' (not the empty-field message)", () => {
    expect(failure("-5").revenueError).toBe("Revenue amount must be zero or greater.");
  });

  it("'1,5' is rejected with the commas message, not read as 15.00", () => {
    const r = failure("1,5");
    expect(r.revenueError).toBe("Commas can only separate thousands, for example 1,234.50.");
  });

  it("names 3 decimal places, '.5', '1e5' and non-numeric text", () => {
    expect(failure("10.555").revenueError).toBe("Use at most 2 decimal places.");
    expect(failure(".5").revenueError).toContain("digit before the decimal point");
    expect(failure("1e5").revenueError).toContain("without an exponent");
    expect(failure("abc").revenueError).toContain("digits only");
  });

  it("over the limit -> the limit message", () => {
    expect(failure("10000000000").revenueError).toContain("larger than this calculator supports");
  });

  it("reports revenue, currency and row errors together", () => {
    const bad: ExpenseRuleFormInput = { ...shipping, fixedAmountMinor: null };
    const r = failure("-1", "JPY", [bad]);
    expect(r.revenueError).toBe("Revenue amount must be zero or greater.");
    expect(r.currencyError).toBe("Choose a supported currency.");
    expect(r.fieldErrors.shipping?.fixedAmountMinor).toBeDefined();
  });

  it("a blank currency is a currency error (the select can never submit a silent empty value)", () => {
    expect(failure("100", "").currencyError).toBe("Choose a supported currency.");
  });

  it("a DISABLED row with no value does not block a calculation (it takes no part in it)", () => {
    const disabledBlank: ExpenseRuleFormInput = { ...shipping, enabled: false, fixedAmountMinor: null };
    const r = runCalculation({ revenueText: "1000", currencyCode: "USD", rows: [disabledBlank] });
    expect(r.ok).toBe(true);
  });
});
