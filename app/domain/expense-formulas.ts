// Formula-based expense rules are drawn from a FIXED, app-defined set — never
// user-authored (spec.md D6, out-of-scope: "arbitrary custom formulas /
// user-supplied JS execution"; A3). A code constant, same treatment as
// EXPENSE_CATEGORIES (decisions/data-model.md §2).
//
// FILLED AT G4-sprint-2.1 (M2) per the human's explicit instruction to build
// against PLACEHOLDER default rates/formulas rather than wait on OQ-4 (real
// business sign-off). These are illustrative computation PATTERNS, not real
// business figures — every constant below (bands, thresholds, rates) is
// clearly flagged PLACEHOLDER and surfaced to the merchant as such in the
// calculator UI (see app/routes/app.calculator.tsx), never presented as
// authoritative advice.
//
// Each formula is a small, pure, fully self-contained function of
// `revenueMinor` alone — there is no formula-parameters column in the schema
// (expense_rule.formula_key is the only formula-rule column, per
// decisions/data-model.md §4.2), so a formula's "configuration" is baked
// into its own definition, not merchant-editable. This is the "small fixed
// set of pre-defined formula patterns, not a general expression evaluator"
// the task brief calls for — there is no parser, no user-supplied expression,
// and no eval of any kind anywhere in this module.
//
// data-model.md §2 deliberately did NOT add a DB CHECK constraint
// enumerating formula keys while OQ-4 was open. That reasoning no longer
// applies to "is the key one of a fixed, finite set" (this module's own
// FORMULA_KEY_SET is that fixed set now) — but the DB CHECK itself is a
// schema-migration decision, not something this M2/M3 sprint is authorized
// to add unprompted (G-Schema owns migrations). isExpenseFormulaKey() is the
// runtime backstop in the meantime, exactly as originally planned.

import { roundHalfAwayFromZero, toMinorUnitsFromBigInt, type MinorUnits } from "./money";

export interface ExpenseFormulaDefinition {
  readonly key: string;
  readonly label: string;
  /** Shown next to the formula in the UI — makes the placeholder nature of the pattern explicit. */
  readonly placeholderNote: string;
}

export const EXPENSE_FORMULAS = [
  {
    key: "tiered_by_revenue_band",
    label: "Tiered by revenue band",
    placeholderNote:
      "PLACEHOLDER pattern: applies a single rate chosen by which illustrative revenue " +
      "band the entered revenue falls into (5% up to $10,000; 3.5% up to $50,000; 2% up " +
      "to $250,000; 1% above that). Bands and rates are illustrative defaults, not real " +
      "business figures.",
  },
  {
    key: "base_fee_plus_marginal_percent",
    label: "Base fee + marginal percentage above a threshold",
    placeholderNote:
      "PLACEHOLDER pattern: a flat base fee ($25.00) plus 1% of revenue above an " +
      "illustrative $20,000 threshold. Base fee, threshold, and rate are illustrative " +
      "defaults, not real business figures.",
  },
] as const satisfies readonly ExpenseFormulaDefinition[];

export type ExpenseFormulaKey = (typeof EXPENSE_FORMULAS)[number]["key"];

const FORMULA_KEY_SET: ReadonlySet<string> = new Set(EXPENSE_FORMULAS.map((f) => f.key));

export function isExpenseFormulaKey(value: string): value is ExpenseFormulaKey {
  return FORMULA_KEY_SET.has(value);
}

export function getExpenseFormula(key: ExpenseFormulaKey): ExpenseFormulaDefinition {
  const found = EXPENSE_FORMULAS.find((f) => f.key === key);
  if (!found) {
    throw new Error(`Unknown expense formula key: ${key}`);
  }
  return found;
}

// --------------------------------------------------------------------------
// tiered_by_revenue_band — placeholder band table. All amounts in minor
// units (cents-equivalent); bands are inclusive upper bounds, checked in
// ascending order. Integer-only (BigInt) comparisons — no float bands.
// --------------------------------------------------------------------------
const TIERED_BANDS: readonly { readonly ceilingMinor: bigint | null; readonly rateBasisPoints: bigint }[] = [
  { ceilingMinor: 1_000_000n, rateBasisPoints: 500n }, // <= $10,000.00 -> 5.00%
  { ceilingMinor: 5_000_000n, rateBasisPoints: 350n }, // <= $50,000.00 -> 3.50%
  { ceilingMinor: 25_000_000n, rateBasisPoints: 200n }, // <= $250,000.00 -> 2.00%
  { ceilingMinor: null, rateBasisPoints: 100n }, // above that -> 1.00%
];

function computeTieredByRevenueBand(revenueMinorBig: bigint): MinorUnits {
  const band = TIERED_BANDS.find(
    (b) => b.ceilingMinor === null || revenueMinorBig <= b.ceilingMinor,
  );
  // TIERED_BANDS always has a final null-ceiling catch-all entry, so `band`
  // is never undefined — the `!` below documents that invariant rather than
  // hiding a real possibility of failure.
  const rawScaled = revenueMinorBig * band!.rateBasisPoints; // exact, minor-units * 10000 scale
  return toMinorUnitsFromBigInt(roundHalfAwayFromZero(rawScaled, 10_000n));
}

// --------------------------------------------------------------------------
// base_fee_plus_marginal_percent — placeholder base fee + marginal rate
// above a threshold, all in minor units.
// --------------------------------------------------------------------------
const BASE_FEE_MINOR = 2_500n; // $25.00
const THRESHOLD_MINOR = 2_000_000n; // $20,000.00
const MARGINAL_RATE_BASIS_POINTS = 100n; // 1.00%

function computeBaseFeePlusMarginalPercent(revenueMinorBig: bigint): MinorUnits {
  const excess = revenueMinorBig > THRESHOLD_MINOR ? revenueMinorBig - THRESHOLD_MINOR : 0n;
  const marginalRawScaled = excess * MARGINAL_RATE_BASIS_POINTS; // minor-units * 10000 scale
  const marginal = roundHalfAwayFromZero(marginalRawScaled, 10_000n);
  return toMinorUnitsFromBigInt(BASE_FEE_MINOR + marginal);
}

/**
 * Computes a formula rule's contribution for a given revenue figure.
 * Pure, deterministic, integer-only (ADR-0005) — the formula's own internal
 * rounding uses the same round-half-away-from-zero policy as every other
 * rule type, so its result is already a whole minor-unit amount by the time
 * it reaches the engine's largest-remainder reconciliation pass (which
 * therefore never needs to touch a formula category's remainder).
 */
export function computeFormulaAmountMinor(formulaKey: string, revenueMinor: number): MinorUnits {
  if (!isExpenseFormulaKey(formulaKey)) {
    throw new Error(`computeFormulaAmountMinor: unknown formula key "${formulaKey}".`);
  }
  if (!Number.isInteger(revenueMinor) || revenueMinor < 0) {
    throw new TypeError(
      `computeFormulaAmountMinor: revenueMinor must be a non-negative integer (got ${revenueMinor}).`,
    );
  }
  const revenueMinorBig = BigInt(revenueMinor);
  switch (formulaKey) {
    case "tiered_by_revenue_band":
      return computeTieredByRevenueBand(revenueMinorBig);
    case "base_fee_plus_marginal_percent":
      return computeBaseFeePlusMarginalPercent(revenueMinorBig);
    default: {
      // Exhaustiveness guard — if EXPENSE_FORMULAS ever gains a new key
      // without an implementation here, this throws instead of silently
      // returning zero.
      const _exhaustive: never = formulaKey;
      throw new Error(`computeFormulaAmountMinor: no implementation for formula key "${_exhaustive}".`);
    }
  }
}
