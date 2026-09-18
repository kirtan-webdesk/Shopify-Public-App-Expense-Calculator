// Formula-based expense rules are drawn from a FIXED, app-defined set — never
// user-authored (spec.md D6, out-of-scope: "arbitrary custom formulas /
// user-supplied JS execution"; A3). A code constant, same treatment as
// EXPENSE_CATEGORIES (decisions/data-model.md §2).
//
// UNPOPULATED PENDING OQ-4 (default expense rates/formula sign-off — spec.md
// §13.2). data-model.md §2 explicitly did NOT add a DB CHECK constraint
// enumerating formula keys for this reason: locking the list at the database
// layer before the real set is confirmed would mean amending or following up
// the initial migration before M2 can even start. This module is the
// application-level enum acting as the safety net in the meantime; a
// `formula_key` value is validated against THIS list, not against a
// hallucinated one.
//
// M2 (Configuration milestone) owns filling this in once OQ-4 closes, and —
// per data-model.md §2 — adding the deferred `CHECK (formula_key IN (...))`
// constraint in a follow-up migration at that point.

export interface ExpenseFormulaDefinition {
  readonly key: string;
  readonly label: string;
}

// Deliberately empty at G3/M1. Do not invent formula definitions here — the
// calculator.html mockup's "Tiered by revenue band" / "Per-unit average"
// options are explicitly labeled placeholders (DESIGN-NOTES.md §4 item 7),
// not a proposal, and were not carried into this constant for that reason.
export const EXPENSE_FORMULAS: readonly ExpenseFormulaDefinition[] = [];

const FORMULA_KEY_SET: ReadonlySet<string> = new Set(
  EXPENSE_FORMULAS.map((f) => f.key),
);

export function isExpenseFormulaKey(value: string): boolean {
  return FORMULA_KEY_SET.has(value);
}
