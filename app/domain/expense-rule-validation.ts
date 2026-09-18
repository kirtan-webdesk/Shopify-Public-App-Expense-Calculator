// Input parsing + validation for the calculator form (M2, D4/D6, S2.2).
// Pure functions, no I/O — shared by the client-side form state
// (app/routes/app.calculator.tsx) AND the server-side action, so "client and
// server side" rejection (S2.2) is the SAME validation logic run twice, not
// two independently-maintained implementations that can drift apart.
//
// ADR-0005's parsing discipline ("every input parse... must go through the
// shared helpers") applies here: merchant-typed decimal strings (e.g.
// "12,500.50" or "32.5") are converted to integer minor-units / basis-points
// by STRING DIGIT-SHIFTING, never by parseFloat/Number() on a decimal
// string — that is exactly the float-precision regression ADR-0005 flags as
// the most likely place for a bug.

import { isExpenseCategoryKey } from "./expense-categories";
import { isExpenseFormulaKey } from "./expense-formulas";
import { isRuleType } from "./rule-types";

// The 4 currencies the calculator's currency selector offers (design/mockup/
// calculator.html) — all 2-decimal-exponent currencies. ADR-0005 notes the
// minor-unit exponent is currency-dependent in general (e.g. JPY=0, KWD=3);
// this app does not yet support a non-2-exponent currency. VERIFY AT BUILD
// before adding one: parseDecimalString's callers below assume exponent 2.
export const SUPPORTED_CURRENCY_CODES = ["USD", "CAD", "EUR", "GBP"] as const;
export type SupportedCurrencyCode = (typeof SUPPORTED_CURRENCY_CODES)[number];

export function isSupportedCurrencyCode(value: string): value is SupportedCurrencyCode {
  return (SUPPORTED_CURRENCY_CODES as readonly string[]).includes(value);
}

/**
 * Parses a merchant-typed decimal string (optionally with thousands
 * commas) into an integer scaled by 10^decimalPlaces, e.g.
 * parseDecimalString("12,500.50", 2) -> 1250050 (cents).
 * Returns null for anything that isn't a plain non-negative decimal with at
 * most `decimalPlaces` fractional digits (no float parsing anywhere in this
 * function — every step is string manipulation or integer parseInt).
 */
export function parseDecimalString(raw: string, decimalPlaces: number): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const cleaned = trimmed.replace(/,/g, "");
  const pattern = new RegExp(`^\\d+(\\.\\d{1,${decimalPlaces}})?$`);
  if (!pattern.test(cleaned)) return null;

  const [wholePart, fractionPart = ""] = cleaned.split(".");
  const paddedFraction = fractionPart.padEnd(decimalPlaces, "0");
  const digits = `${wholePart}${paddedFraction}`;
  const normalized = digits.replace(/^0+(?=\d)/, "");
  const value = parseInt(normalized, 10);
  return Number.isSafeInteger(value) ? value : null;
}

// --------------------------------------------------------------------------
// Sanity bounds. These are SANITY BACKSTOPS against typos/overflow (e.g.
// "3250" typed into a percentage field meant to hold "32.50"), NOT business
// rules — there is no product decision here about what a "reasonable"
// expense percentage is, only a ceiling well beyond anything a real
// merchant would intentionally enter.
// --------------------------------------------------------------------------
export const MAX_REVENUE_MINOR = 999_999_999_999; // ~$10 billion
export const MAX_RATE_BASIS_POINTS = 100_000; // 1000% — generous on purpose
export const MAX_FIXED_AMOUNT_MINOR = 999_999_999; // ~$10,000,000.00

export interface FieldValidation {
  readonly valid: boolean;
  readonly error?: string;
}

export function validateRevenueMinor(revenueMinor: number | null): FieldValidation {
  if (revenueMinor === null) {
    return { valid: false, error: "Enter a revenue amount." };
  }
  if (!Number.isInteger(revenueMinor) || revenueMinor < 0) {
    return { valid: false, error: "Revenue must be zero or a positive amount." };
  }
  if (revenueMinor > MAX_REVENUE_MINOR) {
    return { valid: false, error: "Revenue is larger than this calculator supports — check for a typo." };
  }
  return { valid: true };
}

export function validateCurrencyCode(currencyCode: string): FieldValidation {
  if (!isSupportedCurrencyCode(currencyCode)) {
    return { valid: false, error: "Choose a supported currency." };
  }
  return { valid: true };
}

export function validatePercentageRate(rateBasisPoints: number | null): FieldValidation {
  if (rateBasisPoints === null) {
    return { valid: false, error: "Enter a percentage of 0 or greater." };
  }
  if (!Number.isInteger(rateBasisPoints) || rateBasisPoints < 0) {
    return { valid: false, error: "Enter a percentage of 0 or greater." };
  }
  if (rateBasisPoints > MAX_RATE_BASIS_POINTS) {
    return { valid: false, error: "That percentage looks too large — check for a typo." };
  }
  return { valid: true };
}

export function validateFixedAmount(fixedAmountMinor: number | null): FieldValidation {
  if (fixedAmountMinor === null) {
    return { valid: false, error: "Enter an amount of 0 or greater." };
  }
  if (!Number.isInteger(fixedAmountMinor) || fixedAmountMinor < 0) {
    return { valid: false, error: "Enter an amount of 0 or greater." };
  }
  if (fixedAmountMinor > MAX_FIXED_AMOUNT_MINOR) {
    return { valid: false, error: "That amount looks too large — check for a typo." };
  }
  return { valid: true };
}

export function validateFormulaKey(formulaKey: string | null): FieldValidation {
  if (!formulaKey || !isExpenseFormulaKey(formulaKey)) {
    return { valid: false, error: "Choose a formula." };
  }
  return { valid: true };
}

export interface ExpenseRuleFormInput {
  readonly categoryKey: string;
  readonly enabled: boolean;
  readonly ruleType: string;
  readonly rateBasisPoints: number | null;
  readonly fixedAmountMinor: number | null;
  readonly formulaKey: string | null;
}

export interface ExpenseRuleFieldErrors {
  readonly categoryKey?: string;
  readonly ruleType?: string;
  readonly rateBasisPoints?: string;
  readonly fixedAmountMinor?: string;
  readonly formulaKey?: string;
}

/**
 * Validates one category's rule row. Mirrors the DB's
 * chk_expense_rule_value_shape CHECK constraint exactly (the value column
 * matching rule_type is required and set; the other two are ignored/blank)
 * — this is the same shape rule enforced twice, at the application layer
 * (fast, friendly errors) and the database layer (the backstop), matching
 * this app's established belt-and-suspenders pattern (data-model.md §4.2).
 */
export function validateExpenseRuleRow(input: ExpenseRuleFormInput): ExpenseRuleFieldErrors {
  const errors: { -readonly [K in keyof ExpenseRuleFieldErrors]?: string } = {};

  if (!isExpenseCategoryKey(input.categoryKey)) {
    errors.categoryKey = "Unknown category.";
  }
  if (!isRuleType(input.ruleType)) {
    errors.ruleType = "Choose a rule type.";
    return errors;
  }
  // A disabled row's value fields are not required to be individually valid
  // — the row won't contribute to a calculation either way (see
  // expense-engine.ts) — but if a value IS present for the active rule type
  // it is still checked, so a merchant can't save visible garbage into a
  // field they'll re-enable later without noticing.
  if (input.ruleType === "percentage" && (input.enabled || input.rateBasisPoints !== null)) {
    const result = validatePercentageRate(input.rateBasisPoints);
    if (!result.valid) errors.rateBasisPoints = result.error;
  }
  if (input.ruleType === "fixed" && (input.enabled || input.fixedAmountMinor !== null)) {
    const result = validateFixedAmount(input.fixedAmountMinor);
    if (!result.valid) errors.fixedAmountMinor = result.error;
  }
  if (input.ruleType === "formula" && (input.enabled || input.formulaKey !== null)) {
    const result = validateFormulaKey(input.formulaKey);
    if (!result.valid) errors.formulaKey = result.error;
  }
  return errors;
}

export function hasAnyFieldError(errors: ExpenseRuleFieldErrors): boolean {
  return Object.values(errors).some((v) => v !== undefined);
}
