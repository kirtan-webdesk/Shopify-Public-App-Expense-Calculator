// expense-calculation.service - M3 orchestration around the pure engine
// (app/domain/expense-engine.ts).
//
// G2-revision v2 (J1): "Calculate" runs against the shop's SAVED rules only.
// The rules editor moved to its own page (/app/rules), so there is no unsaved
// rule state on the Calculator to run against, and the action never accepts
// rule values from the client: `calculateFromSavedRules` loads them server-side
// for the authenticated shop and hands them to the pure `runCalculation`.
// Nothing is persisted here (saving a calculation is the history service's
// job, after re-verification).

import { calculateExpenses, type EngineInput, type EngineResult } from "~/domain/expense-engine";
import type { ShopContext } from "~/db/repositories/shop-context";
import { getOrSeedExpenseRules, type ExpenseRuleView } from "~/services/expense-rule.service";
import {
  hasAnyFieldError,
  validateCurrencyCode,
  validateExpenseRuleRow,
  validateRevenueText,
  type ExpenseRuleFieldErrors,
  type ExpenseRuleFormInput,
} from "~/domain/expense-rule-validation";

export interface RunCalculationInput {
  /**
   * The revenue field's RAW text, exactly as submitted. Parsing it here (via
   * validateRevenueText) rather than accepting a pre-parsed number is what lets
   * a typed "-5" or "1e5" be reported with its real reason instead of collapsing
   * into a null that can only say "Enter a revenue amount".
   */
  readonly revenueText: string;
  readonly currencyCode: string;
  readonly rows: readonly ExpenseRuleFormInput[];
}

export type RunCalculationResult =
  | { readonly ok: true; readonly result: EngineResult }
  | {
      readonly ok: false;
      readonly revenueError?: string;
      readonly currencyError?: string;
      readonly fieldErrors: Readonly<Record<string, ExpenseRuleFieldErrors>>;
    };

/**
 * Validates a calculator form submission (server-side — never trust the
 * client's own validation, S2.2) and, if valid, runs the engine. Rows whose
 * OWN validation fails are reported as field errors and the whole
 * calculation is rejected rather than silently dropping/zeroing the bad
 * row — a merchant should never see a total that quietly excluded a
 * category because of a typo it never told them about.
 */
export function runCalculation(input: RunCalculationInput): RunCalculationResult {
  const revenueCheck = validateRevenueText(input.revenueText);
  const currencyCheck = validateCurrencyCode(input.currencyCode);

  const fieldErrors: Record<string, ExpenseRuleFieldErrors> = {};
  for (const row of input.rows) {
    const errors = validateExpenseRuleRow(row);
    if (hasAnyFieldError(errors)) {
      fieldErrors[row.categoryKey] = errors;
    }
  }

  if (!revenueCheck.valid || !currencyCheck.valid || Object.keys(fieldErrors).length > 0) {
    return {
      ok: false,
      revenueError: revenueCheck.valid ? undefined : revenueCheck.error,
      currencyError: currencyCheck.valid ? undefined : currencyCheck.error,
      fieldErrors,
    };
  }

  const engineInput: EngineInput = {
    revenueMinor: revenueCheck.revenueMinor,
    currencyCode: input.currencyCode,
    rules: input.rows.map((row) => ({
      categoryKey: row.categoryKey as EngineInput["rules"][number]["categoryKey"],
      enabled: row.enabled,
      ruleType: row.ruleType as EngineInput["rules"][number]["ruleType"],
      rateBasisPoints: row.ruleType === "percentage" ? row.rateBasisPoints : null,
      fixedAmountMinor: row.ruleType === "fixed" ? row.fixedAmountMinor : null,
      formulaKey: row.ruleType === "formula" ? row.formulaKey : null,
    })),
  };

  const result = calculateExpenses(engineInput);
  return { ok: true, result };
}

/** What the Calculator form is allowed to send: revenue text and a currency. Nothing else. */
export interface CalculateFromSavedRulesInput {
  readonly revenueText: string;
  readonly currencyCode: string;
}

export type CalculateFromSavedRulesResult =
  | { readonly ok: true; readonly result: EngineResult }
  | {
      readonly ok: false;
      readonly revenueError?: string;
      readonly currencyError?: string;
      /** True when the merchant's own SAVED rules failed validation (not a form error they can fix here). */
      readonly savedRulesInvalid: boolean;
    };

/** A saved rule as the validator/engine input rows. Pure shape translation. */
export function ruleViewToFormInput(view: ExpenseRuleView): ExpenseRuleFormInput {
  return {
    categoryKey: view.categoryKey,
    enabled: view.enabled,
    ruleType: view.ruleType,
    rateBasisPoints: view.rateBasisPoints,
    fixedAmountMinor: view.fixedAmountMinor,
    formulaKey: view.formulaKey,
  };
}

/**
 * The Calculate path: validates the merchant's revenue text and currency, loads
 * THIS shop's saved rules (seeding the placeholder defaults on a first-ever
 * load, exactly as the rules page does), and runs the engine on them.
 *
 * The rule set comes only from `ctx` (the authenticated shop); there is no
 * parameter through which a caller could substitute rule values.
 */
export async function calculateFromSavedRules(
  ctx: ShopContext,
  input: CalculateFromSavedRulesInput,
): Promise<CalculateFromSavedRulesResult> {
  const saved = await getOrSeedExpenseRules(ctx);
  const outcome = runCalculation({
    revenueText: input.revenueText,
    currencyCode: input.currencyCode,
    rows: saved.map(ruleViewToFormInput),
  });
  if (outcome.ok) return outcome;
  return {
    ok: false,
    revenueError: outcome.revenueError,
    currencyError: outcome.currencyError,
    savedRulesInvalid: Object.keys(outcome.fieldErrors).length > 0,
  };
}
