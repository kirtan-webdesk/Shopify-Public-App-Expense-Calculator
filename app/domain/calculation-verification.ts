// Server-side re-verification of a client-carried calculation before it is
// persisted (M4, D10).
//
// The Results page receives its numbers via the `d` query parameter
// (app/domain/calculation-transport.ts) — data that round-tripped through the
// merchant's own browser and is therefore attacker-controllable. Saving it
// verbatim would let a tampered URL/form persist arbitrary amounts into an
// append-only history table, where they could never be corrected.
//
// So the save path never trusts the transported AMOUNTS. It treats the
// transported result only as a claim about INPUTS (revenue, currency, and the
// rule applied to each category), re-validates every input with the same
// validators the calculator's own server action uses, re-runs the pure
// engine, and only accepts the claim if the engine's independently computed
// output matches what was claimed. What gets persisted is the engine's own
// recomputed result — never the client-supplied numbers.
//
// The DB-side reconciliation trigger (sum(line items) = total) remains a
// backstop; this is the primary check and does not depend on it.

import { calculateExpenses, type EngineInput, type EngineResult } from "./expense-engine";
import {
  hasAnyFieldError,
  validateCurrencyCode,
  validateExpenseRuleRow,
  validateRevenueMinor,
} from "./expense-rule-validation";

export type VerifyCalculationResult =
  | { readonly ok: true; readonly result: EngineResult }
  | {
      readonly ok: false;
      /** `invalid_input`: an input failed validation. `mismatch`: inputs were
       * valid but the claimed amounts do not equal the engine's own output
       * (tampered payload, or the engine changed since Calculate was run). */
      readonly reason: "invalid_input" | "mismatch";
      readonly message: string;
    };

const INVALID_MESSAGE =
  "This calculation could not be saved because its inputs are not valid. Run Calculate again from the Calculator page.";
const MISMATCH_MESSAGE =
  "This calculation could not be saved because it no longer matches a fresh calculation. Run Calculate again from the Calculator page.";

export function recomputeAndVerifyClaimedResult(claimed: EngineResult): VerifyCalculationResult {
  const invalid = (): VerifyCalculationResult => ({
    ok: false,
    reason: "invalid_input",
    message: INVALID_MESSAGE,
  });

  if (!validateRevenueMinor(claimed.revenueMinor).valid) return invalid();
  if (!validateCurrencyCode(claimed.currencyCode).valid) return invalid();

  const seen = new Set<string>();
  for (const li of claimed.lineItems) {
    if (seen.has(li.categoryKey)) return invalid(); // one line item per category
    seen.add(li.categoryKey);
    const errors = validateExpenseRuleRow({
      categoryKey: li.categoryKey,
      enabled: true,
      ruleType: li.ruleType,
      rateBasisPoints: li.ruleType === "percentage" ? li.rateBasisPoints : null,
      fixedAmountMinor: li.ruleType === "fixed" ? li.fixedAmountMinor : null,
      formulaKey: li.ruleType === "formula" ? li.formulaKey : null,
    });
    if (hasAnyFieldError(errors)) return invalid();
  }

  // Only the rule that is actually active for each rule type is carried into
  // the engine — the same normalisation runCalculation applies — so a
  // transported line item with stray values in its inactive columns cannot
  // smuggle them into the persisted snapshot.
  const engineInput: EngineInput = {
    revenueMinor: claimed.revenueMinor,
    currencyCode: claimed.currencyCode,
    rules: claimed.lineItems.map((li) => ({
      categoryKey: li.categoryKey,
      enabled: true,
      ruleType: li.ruleType,
      rateBasisPoints: li.ruleType === "percentage" ? li.rateBasisPoints : null,
      fixedAmountMinor: li.ruleType === "fixed" ? li.fixedAmountMinor : null,
      formulaKey: li.ruleType === "formula" ? li.formulaKey : null,
    })),
  };

  let recomputed: EngineResult;
  try {
    recomputed = calculateExpenses(engineInput);
  } catch {
    return invalid();
  }

  if (
    recomputed.totalExpensesMinor !== claimed.totalExpensesMinor ||
    recomputed.netAmountMinor !== claimed.netAmountMinor ||
    recomputed.lineItems.length !== claimed.lineItems.length
  ) {
    return { ok: false, reason: "mismatch", message: MISMATCH_MESSAGE };
  }
  const claimedByCategory = new Map(claimed.lineItems.map((li) => [li.categoryKey, li]));
  for (const mine of recomputed.lineItems) {
    const theirs = claimedByCategory.get(mine.categoryKey);
    if (!theirs || mine.computedAmountMinor !== theirs.computedAmountMinor) {
      return { ok: false, reason: "mismatch", message: MISMATCH_MESSAGE };
    }
  }

  return { ok: true, result: recomputed };
}
