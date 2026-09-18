// expense-calculation.service — M3 orchestration around the pure engine
// (app/domain/expense-engine.ts). "Calculate" runs against CURRENT FORM
// STATE, including unsaved edits (G2 design note: "Calculate runs on
// unsaved form state, safe per the snapshot data model") — this service
// therefore takes rule rows exactly as submitted by the calculator form, not
// rows read back from the database. It does not persist anything (M4 scope,
// explicitly out for this sprint) and does not import any repository.

import { calculateExpenses, type EngineInput, type EngineResult } from "~/domain/expense-engine";
import {
  hasAnyFieldError,
  validateCurrencyCode,
  validateExpenseRuleRow,
  validateRevenueMinor,
  type ExpenseRuleFieldErrors,
  type ExpenseRuleFormInput,
} from "~/domain/expense-rule-validation";

export interface RunCalculationInput {
  readonly revenueMinor: number | null;
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
  const revenueCheck = validateRevenueMinor(input.revenueMinor);
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
    revenueMinor: input.revenueMinor as number,
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
