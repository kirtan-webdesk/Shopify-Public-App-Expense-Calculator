// PLACEHOLDER default expense-rule values, seeded per shop on first use of
// the calculator (see app/services/expense-rule.service.ts).
//
// Human's explicit instruction (G4-sprint-2.1 task brief): OQ-4 (real
// business sign-off on default rates) is still unanswered; build against
// clearly-illustrative placeholder values instead of waiting. These are NOT
// real business figures and must never be presented as authoritative advice
// — every surface that renders them (app/routes/app.calculator.tsx) carries
// a visible "illustrative placeholder default" label, matching the
// G2-approved mockup's own banner/notes for the same reason
// (design/mockup/calculator.html, DESIGN-NOTES.md §4 item 6).
//
// Values below are lifted directly from the G2-approved calculator.html
// mockup fixture (not invented fresh at this gate) — that mockup was already
// reviewed and confirmed as "illustrative only" at G2, so reusing the same
// numbers keeps the shipped UI visually consistent with what was approved
// rather than introducing a second, undiscussed set of placeholder figures.
import { EXPENSE_CATEGORIES, type ExpenseCategoryKey } from "./expense-categories";
import type { RuleType } from "./rule-types";

export interface DefaultExpenseRule {
  readonly categoryKey: ExpenseCategoryKey;
  readonly ruleType: RuleType;
  readonly rateBasisPoints: number | null;
  readonly fixedAmountMinor: number | null;
  readonly formulaKey: string | null;
}

// All fixedAmountMinor figures assume a 2-decimal-exponent currency (USD/CAD/
// EUR/GBP, the four options the mockup's currency selector offers) — minor
// units = cents. The engine takes currency from calculation.currency_code
// independently; these are just illustrative starting values in whatever
// currency the shop later picks.
export const DEFAULT_EXPENSE_RULES: readonly DefaultExpenseRule[] = [
  { categoryKey: "cost_of_goods", ruleType: "percentage", rateBasisPoints: 3250, fixedAmountMinor: null, formulaKey: null }, // 32.5%
  { categoryKey: "marketing", ruleType: "percentage", rateBasisPoints: 800, fixedAmountMinor: null, formulaKey: null }, // 8%
  { categoryKey: "platform_fees", ruleType: "percentage", rateBasisPoints: 290, fixedAmountMinor: null, formulaKey: null }, // 2.9%
  { categoryKey: "payment_processing", ruleType: "percentage", rateBasisPoints: 260, fixedAmountMinor: null, formulaKey: null }, // 2.6%
  { categoryKey: "shipping", ruleType: "fixed", rateBasisPoints: null, fixedAmountMinor: 45_000, formulaKey: null }, // $450.00
  { categoryKey: "apps_software", ruleType: "fixed", rateBasisPoints: null, fixedAmountMinor: 12_000, formulaKey: null }, // $120.00
  { categoryKey: "payroll", ruleType: "percentage", rateBasisPoints: 1800, fixedAmountMinor: null, formulaKey: null }, // 18%
  { categoryKey: "overhead", ruleType: "fixed", rateBasisPoints: null, fixedAmountMinor: 30_000, formulaKey: null }, // $300.00
  { categoryKey: "taxes", ruleType: "percentage", rateBasisPoints: 600, fixedAmountMinor: null, formulaKey: null }, // 6%
  { categoryKey: "misc", ruleType: "percentage", rateBasisPoints: 150, fixedAmountMinor: null, formulaKey: null }, // 1.5%
] as const satisfies readonly DefaultExpenseRule[];

// Defensive invariant check (dev-time, not a hot path): every category has
// exactly one default, and the set is exactly EXPENSE_CATEGORIES — catches a
// category being added/removed from the code constant without this file
// being updated to match.
const DEFAULT_KEYS = new Set(DEFAULT_EXPENSE_RULES.map((r) => r.categoryKey));
if (DEFAULT_KEYS.size !== EXPENSE_CATEGORIES.length) {
  throw new Error(
    "expense-rule-defaults.ts: DEFAULT_EXPENSE_RULES does not cover exactly the categories " +
      "in EXPENSE_CATEGORIES — update this file to match.",
  );
}
