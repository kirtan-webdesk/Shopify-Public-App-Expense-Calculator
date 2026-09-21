// Pure form-state helpers for the Expense rules page (app/routes/app.rules.tsx).
// No I/O, no React: unit-testable, and shared by the client editor and the
// server action so both read the same shapes.
//
// The rules editor keeps every value as a DISPLAY STRING while it is being
// edited (so a merchant can clear a field without it snapping back to "0"),
// and converts through the SAME parseDecimalString the server validates with -
// never a separate, possibly-drifting client parser (ADR-0005).

import { EXPENSE_CATEGORIES, type ExpenseCategoryKey } from "./expense-categories";
import { DEFAULT_EXPENSE_RULES } from "./expense-rule-defaults";
import { EXPENSE_FORMULAS } from "./expense-formulas";
import { parseDecimalString, type ExpenseRuleFormInput } from "./expense-rule-validation";
import type { RuleType } from "./rule-types";
import { minorUnitsToInputString } from "./presentation";

export interface RuleRowState {
  readonly categoryKey: ExpenseCategoryKey;
  readonly enabled: boolean;
  readonly ruleType: RuleType;
  readonly percentText: string;
  readonly fixedText: string;
  readonly formulaKey: string;
}

/** A stored rule (or a placeholder default), in the shape the editor loads. */
export interface RuleSource {
  readonly categoryKey: ExpenseCategoryKey;
  readonly enabled: boolean;
  readonly ruleType: RuleType;
  readonly rateBasisPoints: number | null;
  readonly fixedAmountMinor: number | null;
  readonly formulaKey: string | null;
}

export function toRowState(source: RuleSource): RuleRowState {
  return {
    categoryKey: source.categoryKey,
    enabled: source.enabled,
    ruleType: source.ruleType,
    percentText: source.rateBasisPoints !== null ? minorUnitsToInputString(source.rateBasisPoints) : "0.00",
    fixedText: source.fixedAmountMinor !== null ? minorUnitsToInputString(source.fixedAmountMinor) : "0.00",
    formulaKey: source.formulaKey ?? EXPENSE_FORMULAS[0]?.key ?? "",
  };
}

/** Rows keyed by category, from the saved rules the loader returned. */
export function rowStatesFromRules(rules: readonly RuleSource[]): Record<string, RuleRowState> {
  const rows: Record<string, RuleRowState> = {};
  for (const rule of rules) rows[rule.categoryKey] = toRowState(rule);
  return rows;
}

/**
 * The placeholder defaults as editor rows (J5 "Reset to placeholder defaults").
 * Every category is switched ON, exactly as first-load seeding does
 * (expense-rule.service getOrSeedExpenseRules). This only PRODUCES form values:
 * the caller puts them in the form and nothing is written until the merchant
 * saves; Discard restores the saved values.
 */
export function placeholderDefaultRowStates(): Record<string, RuleRowState> {
  return rowStatesFromRules(DEFAULT_EXPENSE_RULES.map((d) => ({ ...d, enabled: true })));
}

export function toFormInput(row: RuleRowState): ExpenseRuleFormInput {
  return {
    categoryKey: row.categoryKey,
    enabled: row.enabled,
    ruleType: row.ruleType,
    rateBasisPoints: row.ruleType === "percentage" ? parseDecimalString(row.percentText, 2) : null,
    fixedAmountMinor: row.ruleType === "fixed" ? parseDecimalString(row.fixedText, 2) : null,
    formulaKey: row.ruleType === "formula" ? row.formulaKey || null : null,
  };
}

/** True when two row sets carry the same values (used to decide "is the form dirty"). */
export function rowStatesEqual(a: Record<string, RuleRowState>, b: Record<string, RuleRowState>): boolean {
  return EXPENSE_CATEGORIES.every((c) => {
    const x = a[c.key];
    const y = b[c.key];
    return (
      x !== undefined &&
      y !== undefined &&
      x.enabled === y.enabled &&
      x.ruleType === y.ruleType &&
      x.percentText === y.percentText &&
      x.fixedText === y.fixedText &&
      x.formulaKey === y.formulaKey
    );
  });
}

// Form field names the Save action reads (one set per category):
//   enabled-<key>   present (any value) iff the rule is switched on
//   type-<key>      percentage | fixed | formula
//   percent-<key> / fixed-<key>   decimal text
//   formula-<key>   formula key
export const enabledField = (key: string) => `enabled-${key}`;
export const typeField = (key: string) => `type-${key}`;
export const percentField = (key: string) => `percent-${key}`;
export const fixedField = (key: string) => `fixed-${key}`;
export const formulaField = (key: string) => `formula-${key}`;

/**
 * Server-side parse of the Save form: always exactly one row per known
 * category (a category the client omitted becomes an "off, no value" row that
 * validation rejects, never a silently-skipped one). Nothing here trusts the
 * client's own validation - the result goes straight to saveExpenseRules.
 */
export function parseRuleRowsFromFormData(formData: FormData): ExpenseRuleFormInput[] {
  return EXPENSE_CATEGORIES.map((category) => {
    const key = category.key;
    const enabled = formData.get(enabledField(key)) !== null;
    // An unknown rule type is passed through as-is so validation names it,
    // rather than being coerced into a valid one.
    const ruleType = String(formData.get(typeField(key)) ?? "percentage");
    const percentRaw = String(formData.get(percentField(key)) ?? "");
    const fixedRaw = String(formData.get(fixedField(key)) ?? "");
    const formulaKeyRaw = formData.get(formulaField(key));
    return {
      categoryKey: key,
      enabled,
      ruleType,
      rateBasisPoints: ruleType === "percentage" ? parseDecimalString(percentRaw, 2) : null,
      fixedAmountMinor: ruleType === "fixed" ? parseDecimalString(fixedRaw, 2) : null,
      formulaKey: ruleType === "formula" ? (formulaKeyRaw ? String(formulaKeyRaw) : null) : null,
    };
  });
}
