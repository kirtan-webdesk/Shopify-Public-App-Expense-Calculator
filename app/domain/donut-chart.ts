// Hand-rolled inline SVG donut geometry (ADR-0004) — NO charting library, NO
// canvas. Pure function: given the already-computed line items + revenue, it
// returns SEGMENT DATA for a React component to render as <circle> elements
// (stacked stroke-dasharray, pathLength=100 normalizes to percentages
// directly) — the same technique design/mockup/assets/mockup.js prototyped,
// reimplemented here as testable geometry instead of an HTML-string builder.
//
// Both the table (app/routes/app.results.tsx) and this chart render from the
// SAME computed line-item array; this module derives no number the engine
// didn't already produce. The <svg> the caller renders from this data must
// carry role="img" + a summarising aria-label and be aria-hidden internally
// — the data table remains the accessible source of truth (ADR-0004); this
// module only computes geometry, it does not decide accessibility markup.
//
// Mandatory states handled here (ADR-0004): all expenses zero -> EMPTY_RING
// sentinel; exactly one non-zero category -> a full 100-dash ring, no seams;
// slices under ~1% -> floored to MIN_VISIBLE_DASH so they render as a sliver
// instead of disappearing (the floor affects only the VISUAL dash length,
// never the cursor/offset math, so downstream slices still land at their true
// angle — ADR-0004's own consequence).
//
// What is a "slice" and what is the ring measured against (G4-sprint-3.5):
//   * A category is on the chart iff its EXPENSE AMOUNT is > 0. It is never
//     keyed on percentage-of-revenue: at revenue 0 every percentage is 0 (the
//     table shows a dash), yet a $450 shipping fee is still a real expense and
//     must not read as "No data".
//   * The ring's basis is "share of revenue" when there IS revenue and the
//     expenses fit inside it (their percentages sum to <= 100), so the ring's
//     empty part honestly shows the margin left. Otherwise (revenue 0, or
//     expenses larger than revenue) the ring is "share of total expenses" and
//     always closes at exactly 100 — a share-of-revenue ring cannot be drawn
//     past 100% (dash > 100 / negative gap are invalid stroke-dasharray values
//     and the arcs overlap). The basis is reported so the caption/legend/
//     aria-label can say which one they are showing.

export interface DonutSliceInput {
  readonly categoryKey: string;
  readonly label: string;
  readonly amountMinor: number;
  /** 0-100+; 0 when revenue is 0 (percentageOfRevenue() defines x/0 as 0). */
  readonly percentageOfRevenue: number;
  readonly color: string;
}

export type DonutBasis = "revenue" | "expenses";

export interface DonutSegment {
  readonly categoryKey: string;
  readonly label: string;
  readonly color: string;
  /** The category's true share of revenue (0 when revenue is 0; may exceed 100 in total). */
  readonly percentageOfRevenue: number;
  /** The category's share of the ring's basis (see DonutBasis), 0-100. */
  readonly share: number;
  /** stroke-dasharray "dash gap" values, pathLength=100 units. Always 0 <= dash <= 100 and gap = 100 - dash >= 0. */
  readonly dash: number;
  readonly gap: number;
  /** stroke-dashoffset, pathLength=100 units (counts from 12 o'clock, clockwise), within [0, 100]. */
  readonly dashOffset: number;
}

export interface DonutChartData {
  readonly isEmpty: boolean;
  readonly ariaLabel: string;
  readonly basis: DonutBasis;
  readonly segments: readonly DonutSegment[];
}

const MIN_VISIBLE_DASH = 0.6; // percentage points — keeps <1% slices visible
// Float slack when deciding "the percentages sum to at most 100": ten slices of
// an exactly-100% split can add up to 100.00000000000001.
const SUM_EPSILON = 1e-9;

export function buildDonutChartData(slices: readonly DonutSliceInput[]): DonutChartData {
  const present = slices.filter((s) => s.amountMinor > 0);

  if (present.length === 0) {
    return {
      isEmpty: true,
      ariaLabel: "No expenses to display yet.",
      basis: "expenses",
      segments: [],
    };
  }

  const totalAmount = present.reduce((sum, s) => sum + s.amountMinor, 0);
  // percentageOfRevenue is 0 for every slice exactly when revenue is 0, so a
  // positive amount with a positive percentage means there is revenue.
  const hasRevenue = present.every((s) => s.percentageOfRevenue > 0);
  const percentSum = present.reduce((sum, s) => sum + s.percentageOfRevenue, 0);
  const basis: DonutBasis = hasRevenue && percentSum <= 100 + SUM_EPSILON ? "revenue" : "expenses";

  const shareOf = (s: DonutSliceInput): number =>
    basis === "revenue" ? s.percentageOfRevenue : (s.amountMinor / totalAmount) * 100;

  const basisText = basis === "revenue" ? "share of revenue" : "share of total expenses";
  const ariaLabel =
    `Expense breakdown donut chart, shown as a ${basisText}. ` +
    present.map((s) => `${s.label} ${formatPct(shareOf(s))}`).join(", ") +
    ". Full figures are in the table above.";

  let cursor = 0; // running offset, in "percent of circumference" units
  const segments: DonutSegment[] = present.map((s) => {
    const share = shareOf(s);
    const dash = Math.min(100, Math.max(share, MIN_VISIBLE_DASH));
    const gap = 100 - dash;
    const dashOffset = Math.min(100, Math.max(0, 100 - cursor));
    cursor += share; // advance by the TRUE share, not the floored dash
    return {
      categoryKey: s.categoryKey,
      label: s.label,
      color: s.color,
      percentageOfRevenue: s.percentageOfRevenue,
      share,
      dash,
      gap,
      dashOffset,
    };
  });

  return { isEmpty: false, ariaLabel, basis, segments };
}

function formatPct(value: number): string {
  return `${value.toFixed(value < 1 ? 2 : 1)}%`;
}

// A small fixed, deterministic colour palette keyed by the 10 fixed
// categories. Not merchant-configurable; colour is never the only carrier of
// meaning (ADR-0004) - every slice's label/amount/percentage is also in the
// table.
//
// G2-revision v2 (J8): the v1 palette had colours below 3:1 against white
// (QA finding p4; WCAG 1.4.11 non-text contrast). Every colour below is at
// least 3:1 on #FFFFFF - asserted by tests/domain/chart-palette.test.ts, which
// computes the WCAG relative-luminance contrast ratio rather than trusting a
// hand-calculated comment.
export const CATEGORY_COLORS: Readonly<Record<string, string>> = {
  cost_of_goods: "#1D4ED8",
  marketing: "#C2410C",
  platform_fees: "#7C3AED",
  payment_processing: "#15803D",
  shipping: "#0E7490",
  apps_software: "#A16207",
  payroll: "#BE185D",
  overhead: "#475569",
  taxes: "#B91C1C",
  misc: "#4D7C0F",
};

/** Fallback for a category key the palette does not know (>= 3:1 on white). */
export const FALLBACK_CATEGORY_COLOR = "#616161";
