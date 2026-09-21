// Render-boundary formatting helpers. ADR-0005: "converted to a display
// string exactly once, at the render boundary" — this is that boundary.
// Everything upstream of this module (expense-engine.ts, money.ts) is
// integer/BigInt only; percentage-of-revenue and currency-string formatting
// are DISPLAY concerns that never feed back into a stored or computed money
// value, so ordinary floating-point math is fine here (and only here).

import type { EngineLineItem, EngineResult } from "./expense-engine";
import { EXPENSE_FORMULAS } from "./expense-formulas";

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

// Static (not Intl.DisplayNames) so server and browser always render the same
// text — no hydration mismatch if the two ICU builds ever disagree on a name.
const CURRENCY_NAMES: Record<string, string> = {
  USD: "US Dollar",
  CAD: "Canadian Dollar",
  EUR: "Euro",
  GBP: "British Pound",
};

/** Currency picker option text, e.g. "USD — US Dollar" (matches the G2 mockup). */
export function currencyOptionLabel(currencyCode: string): string {
  const name = CURRENCY_NAMES[currencyCode];
  return name ? `${currencyCode} — ${name}` : currencyCode;
}

/**
 * The currency symbol the shared formatter would put in front of an amount
 * (e.g. "USD" -> "$", "EUR" -> "€", "GBP" -> "£"). Used for input prefixes and
 * the calculator's per-category summary so they follow the selected currency
 * instead of a hardcoded "$". Falls back to the code itself for an unknown one.
 */
export function currencySymbol(currencyCode: string): string {
  try {
    const parts = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currencyCode,
      currencyDisplay: "narrowSymbol",
    }).formatToParts(0);
    return parts.find((p) => p.type === "currency")?.value ?? currencyCode;
  } catch {
    return currencyCode;
  }
}

/**
 * Drops insignificant trailing zeros from a decimal string of at most 2
 * decimals ("32.50" -> "32.5", "8.00" -> "8", "2.9" -> "2.9"). Anything else
 * (blank, non-numeric, more than 2 decimals) is returned untouched so a
 * half-typed or invalid value is never silently rewritten in the UI.
 */
export function trimDecimalZeros(text: string): string {
  const trimmed = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return text;
  return String(Number(trimmed));
}

/**
 * One-line description of the rule applied to a category, rendered from the
 * rule's own values (never from the current live rule). Shared by the
 * Results page and the saved-calculation detail page so both describe a rule
 * identically — on the detail page the inputs are the stored `*_at_save`
 * columns, so a later edit to the live rule cannot change this text.
 *
 * `currencyCode` (the calculation's own currency) gives a fixed amount its
 * symbol, e.g. "$450.00 fixed" / "€450.00 fixed"; without it only the bare
 * number is shown.
 */
export function formatRuleApplied(
  li: {
    readonly ruleType: string;
    readonly rateBasisPoints: number | null;
    readonly fixedAmountMinor: number | null;
    readonly formulaKey: string | null;
  },
  currencyCode?: string,
): string {
  if (li.ruleType === "percentage" && li.rateBasisPoints !== null) {
    return `${trimDecimalZeros((li.rateBasisPoints / 100).toFixed(2))}% of revenue`;
  }
  if (li.ruleType === "fixed" && li.fixedAmountMinor !== null) {
    const amount = currencyCode
      ? formatMoney(li.fixedAmountMinor, currencyCode)
      : (li.fixedAmountMinor / 100).toFixed(2);
    return `${amount} fixed`;
  }
  if (li.ruleType === "formula" && li.formulaKey) {
    // Merchant-facing label, not the internal snake_case key. An unknown key
    // (e.g. a formula retired after a snapshot was saved) falls back to the
    // stored key so the snapshot still says something true.
    const label = EXPENSE_FORMULAS.find((f) => f.key === li.formulaKey)?.label;
    return `Formula: ${label ?? li.formulaKey}`;
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
