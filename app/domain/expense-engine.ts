// The calculation engine (M3, D7). Pure function: no I/O, no Date.now(), no
// Math.random(), no locale-dependent behaviour (ADR-0005 item 5) — identical
// inputs always produce byte-identical output (D7, S3.1, FT-13c).
//
// Money discipline (ADR-0005): every amount is integer minor units end to
// end. Intermediate arithmetic is done in BigInt at a "minor-units * 10000"
// scale (matching rate_basis_points' own /10000 scale, per data-model.md
// §4.2) so a percentage-of-revenue amount that doesn't divide evenly never
// touches a float. Rounding is half-away-from-zero, applied once per
// category (app/domain/money.ts's roundHalfAwayFromZero) and once for the
// total; any residual minor units between "sum of individually-rounded
// categories" and "the rounded total" is allocated by the largest-remainder
// method, ties broken by the fixed category sort order — ADR-0005 item 4,
// implemented literally below, not approximated.
//
// Deliberately NOT in this module: currency formatting, percentage-of-
// revenue display math. Those are render-boundary concerns (ADR-0005: "It is
// converted to a display string exactly once, at the render boundary") and
// live in app/domain/presentation.ts instead, so this file never needs a
// float literal.

import { EXPENSE_CATEGORIES, type ExpenseCategoryKey } from "./expense-categories";
import { computeFormulaAmountMinor } from "./expense-formulas";
import { roundHalfAwayFromZero, toMinorUnits, toMinorUnitsFromBigInt, type MinorUnits } from "./money";
import type { RuleType } from "./rule-types";

/** Bump on any change to the arithmetic/reconciliation algorithm below — a
 * saved calculation stores this string (data-model.md §4.3 `engine_version`)
 * so history never silently re-derives a different number from a later
 * engine build (M4 will wire this into persistence; the constant is real
 * now, per the task brief, even though nothing persists it yet this sprint). */
export const ENGINE_VERSION = "expense-engine@1.0.0";

const SCALE = 10_000n; // matches rate_basis_points' own /10000 fraction (1bp = 1/10000)

export interface EngineRuleInput {
  readonly categoryKey: ExpenseCategoryKey;
  readonly enabled: boolean;
  readonly ruleType: RuleType;
  readonly rateBasisPoints: number | null;
  readonly fixedAmountMinor: number | null;
  readonly formulaKey: string | null;
}

export interface EngineLineItem {
  readonly categoryKey: ExpenseCategoryKey;
  readonly categoryLabel: string;
  readonly sortOrder: number;
  readonly ruleType: RuleType;
  readonly rateBasisPoints: number | null;
  readonly fixedAmountMinor: number | null;
  readonly formulaKey: string | null;
  readonly computedAmountMinor: MinorUnits;
}

export interface EngineInput {
  readonly revenueMinor: number;
  readonly currencyCode: string;
  readonly rules: readonly EngineRuleInput[];
}

export interface EngineResult {
  readonly engineVersion: string;
  readonly revenueMinor: MinorUnits;
  readonly currencyCode: string;
  readonly totalExpensesMinor: MinorUnits;
  readonly netAmountMinor: MinorUnits;
  readonly lineItems: readonly EngineLineItem[];
}

interface ScaledContribution {
  readonly rule: EngineRuleInput;
  readonly sortOrder: number;
  readonly rawScaled: bigint; // exact, at SCALE (minor-units * 10000)
}

/**
 * Runs the engine against a revenue figure and a set of category rules.
 * Disabled rules are excluded from the result entirely (data-model.md §4.4
 * has no "disabled" rule_type — a disabled category simply does not
 * contribute a line item or an amount, matching D6's "a rule can be
 * disabled" without needing a 4th rule-type value the schema's CHECK
 * constraint doesn't allow).
 */
export function calculateExpenses(input: EngineInput): EngineResult {
  if (!Number.isInteger(input.revenueMinor) || input.revenueMinor < 0) {
    throw new TypeError(
      `calculateExpenses: revenueMinor must be a non-negative integer (got ${input.revenueMinor}). ` +
        "This should have been rejected by expense-rule-validation.ts before reaching the engine.",
    );
  }
  const revenueMinorBig = BigInt(input.revenueMinor);

  const enabledRules = input.rules.filter((r) => r.enabled);

  const contributions: ScaledContribution[] = enabledRules.map((rule) => {
    const category = EXPENSE_CATEGORIES.find((c) => c.key === rule.categoryKey);
    if (!category) {
      throw new Error(`calculateExpenses: unknown category key "${rule.categoryKey}".`);
    }
    return {
      rule,
      sortOrder: category.sortOrder,
      rawScaled: computeRawScaled(rule, revenueMinorBig),
    };
  });

  const totalRawScaled = contributions.reduce((sum, c) => sum + c.rawScaled, 0n);
  const totalExpensesMinorBig = roundHalfAwayFromZero(totalRawScaled, SCALE);

  const bases = contributions.map((c) => ({
    contribution: c,
    base: c.rawScaled / SCALE, // exact floor division (BigInt, non-negative)
    remainder: c.rawScaled % SCALE,
  }));
  const baseSum = bases.reduce((sum, b) => sum + b.base, 0n);
  const leftover = totalExpensesMinorBig - baseSum;

  if (leftover < 0n) {
    // Structurally unreachable (sum of floors <= floor of sum <= the
    // half-away-from-zero-rounded total), but asserted per ADR-0005's "the
    // invariant is asserted in the engine, not just in tests" instruction —
    // a violation here means the algorithm itself is wrong, not the input.
    throw new Error(
      `calculateExpenses: internal invariant violated — leftover (${leftover}) is negative. ` +
        "This indicates a bug in the reconciliation algorithm, not bad input.",
    );
  }

  // Largest-remainder method: the categories with the largest fractional
  // remainder get the leftover minor units, one each, ties broken by the
  // fixed category sort order (ADR-0005 item 4, literal).
  const distributionOrder = [...bases].sort((a, b) => {
    if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1;
    return a.contribution.sortOrder - b.contribution.sortOrder;
  });
  const bumped = new Set(distributionOrder.slice(0, Number(leftover)).map((b) => b.contribution));

  const lineItems: EngineLineItem[] = bases
    .map((b) => {
      const finalAmount = b.base + (bumped.has(b.contribution) ? 1n : 0n);
      const category = EXPENSE_CATEGORIES.find((c) => c.key === b.contribution.rule.categoryKey)!;
      return {
        categoryKey: b.contribution.rule.categoryKey,
        categoryLabel: category.label,
        sortOrder: category.sortOrder,
        ruleType: b.contribution.rule.ruleType,
        rateBasisPoints: b.contribution.rule.rateBasisPoints,
        fixedAmountMinor: b.contribution.rule.fixedAmountMinor,
        formulaKey: b.contribution.rule.formulaKey,
        computedAmountMinor: toMinorUnitsFromBigInt(finalAmount),
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const reconciledSum = lineItems.reduce((sum, li) => sum + BigInt(li.computedAmountMinor), 0n);
  if (reconciledSum !== totalExpensesMinorBig) {
    // The core ADR-0005 guarantee, asserted at runtime (not just FT-13d).
    throw new Error(
      `calculateExpenses: reconciliation invariant violated — sum(lineItems)=${reconciledSum} !== ` +
        `total=${totalExpensesMinorBig}.`,
    );
  }

  const netAmountMinorBig = revenueMinorBig - totalExpensesMinorBig;

  return {
    engineVersion: ENGINE_VERSION,
    revenueMinor: toMinorUnits(input.revenueMinor),
    currencyCode: input.currencyCode,
    totalExpensesMinor: toMinorUnitsFromBigInt(totalExpensesMinorBig),
    // Net can legitimately be negative (data-model.md §4.3: "no >= 0 check
    // ... expenses can legitimately exceed revenue") — toMinorUnits only
    // asserts integer-ness, not sign, so this is exactly the right helper.
    netAmountMinor: toMinorUnits(Number(netAmountMinorBig)),
    lineItems,
  };
}

function computeRawScaled(rule: EngineRuleInput, revenueMinorBig: bigint): bigint {
  switch (rule.ruleType) {
    case "percentage": {
      if (rule.rateBasisPoints === null) {
        throw new Error(`calculateExpenses: percentage rule "${rule.categoryKey}" has no rateBasisPoints.`);
      }
      // amount = revenue * bp / 10000, so amount * SCALE(10000) = revenue * bp exactly.
      return revenueMinorBig * BigInt(rule.rateBasisPoints);
    }
    case "fixed": {
      if (rule.fixedAmountMinor === null) {
        throw new Error(`calculateExpenses: fixed rule "${rule.categoryKey}" has no fixedAmountMinor.`);
      }
      return BigInt(rule.fixedAmountMinor) * SCALE;
    }
    case "formula": {
      if (rule.formulaKey === null) {
        throw new Error(`calculateExpenses: formula rule "${rule.categoryKey}" has no formulaKey.`);
      }
      const formulaAmount = computeFormulaAmountMinor(rule.formulaKey, Number(revenueMinorBig));
      return BigInt(formulaAmount) * SCALE;
    }
    default: {
      const _exhaustive: never = rule.ruleType;
      throw new Error(`calculateExpenses: unknown rule type "${_exhaustive}".`);
    }
  }
}
