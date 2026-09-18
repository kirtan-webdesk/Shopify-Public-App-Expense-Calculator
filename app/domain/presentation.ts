// Render-boundary formatting helpers. ADR-0005: "converted to a display
// string exactly once, at the render boundary" — this is that boundary.
// Everything upstream of this module (expense-engine.ts, money.ts) is
// integer/BigInt only; percentage-of-revenue and currency-string formatting
// are DISPLAY concerns that never feed back into a stored or computed money
// value, so ordinary floating-point math is fine here (and only here).

import type { EngineLineItem, EngineResult } from "./expense-engine";

/**
 * Percentage of revenue a line item's amount represents, 0-100 (or 0 if
 * revenue is 0 — division by zero is defined as 0%, matching ADR-0004's
 * zero-revenue state rather than throwing or producing NaN/Infinity).
 */
export function percentageOfRevenue(amountMinor: number, revenueMinor: number): number {
  if (revenueMinor <= 0) return 0;
  return (amountMinor / revenueMinor) * 100;
}

export interface LineItemWithPercentage extends EngineLineItem {
  readonly percentageOfRevenue: number;
}

export function withPercentages(result: EngineResult): readonly LineItemWithPercentage[] {
  return result.lineItems.map((li) => ({
    ...li,
    percentageOfRevenue: percentageOfRevenue(li.computedAmountMinor, result.revenueMinor),
  }));
}

const CURRENCY_MINOR_EXPONENT: Record<string, number> = {
  USD: 2,
  CAD: 2,
  EUR: 2,
  GBP: 2,
};

/**
 * Formats a MinorUnits amount as a currency string, e.g. formatMoney(165000,
 * "USD") -> "$1,650.00". Uses Intl.NumberFormat's own currency-aware
 * rounding display (it never re-rounds our already-integer minor-units
 * value — it just places the decimal point and applies locale grouping).
 * VERIFY AT BUILD if a currency with a non-2 minor-unit exponent is ever
 * added (see expense-rule-validation.ts SUPPORTED_CURRENCY_CODES note).
 */
export function formatMoney(amountMinor: number, currencyCode: string): string {
  const exponent = CURRENCY_MINOR_EXPONENT[currencyCode] ?? 2;
  const major = amountMinor / 10 ** exponent;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode,
    currencyDisplay: "narrowSymbol",
  }).format(major);
}

/**
 * One-line description of the rule applied to a category, rendered from the
 * rule's own values (never from the current live rule). Shared by the
 * Results page and the saved-calculation detail page so both describe a rule
 * identically — on the detail page the inputs are the stored `*_at_save`
 * columns, so a later edit to the live rule cannot change this text.
 */
export function formatRuleApplied(li: {
  readonly ruleType: string;
  readonly rateBasisPoints: number | null;
  readonly fixedAmountMinor: number | null;
  readonly formulaKey: string | null;
}): string {
  if (li.ruleType === "percentage" && li.rateBasisPoints !== null) {
    return `${(li.rateBasisPoints / 100).toFixed(2)}% of revenue`;
  }
  if (li.ruleType === "fixed" && li.fixedAmountMinor !== null) {
    return `${(li.fixedAmountMinor / 100).toFixed(2)} fixed`;
  }
  if (li.ruleType === "formula" && li.formulaKey) {
    return `Formula: ${li.formulaKey}`;
  }
  return "—";
}

const MONTH_ABBREVIATIONS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * Formats a stored timestamp as e.g. "Sep 17, 2026, 9:14 AM UTC" (matches the
 * G2 mockup's "Sep 17, 2026, 9:14 AM" plus an explicit zone).
 *
 * Deliberately hand-assembled from UTC fields rather than Intl.DateTimeFormat:
 * (1) the project timezone is still unconfirmed (spec OQ-6) so the zone is
 * stated rather than guessed, and (2) newer ICU builds emit a narrow
 * no-break space before AM/PM in some runtimes and not others — a server/
 * browser difference in that character would be a hydration mismatch. This
 * function is pure and produces identical output everywhere.
 */
export function formatSavedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const month = MONTH_ABBREVIATIONS[date.getUTCMonth()] ?? "—";
  const hours24 = date.getUTCHours();
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const meridiem = hours24 < 12 ? "AM" : "PM";
  return `${month} ${date.getUTCDate()}, ${date.getUTCFullYear()}, ${hours12}:${minutes} ${meridiem} UTC`;
}

export function formatPercent(value: number): string {
  return `${value.toFixed(value !== 0 && value < 1 ? 2 : 1)}%`;
}

/**
 * Converts a minor-units integer (cents, or basis points where 100bp = 1%)
 * into a 2-decimal edit-field string, e.g. 3250 -> "32.50", 45000 -> "450.00".
 * Used to seed a text/number input's initial value from a stored integer —
 * a display/edit-boundary concern, not engine math, so ordinary division is
 * fine here (see this module's header note).
 */
export function minorUnitsToInputString(value: number, decimalPlaces = 2): string {
  return (value / 10 ** decimalPlaces).toFixed(decimalPlaces);
}
