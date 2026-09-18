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
// Mandatory states handled here (ADR-0004): zero revenue / all-categories-
// zero -> EMPTY_RING sentinel; exactly one non-zero category -> a full
// 100-dash ring, no seams; slices under ~1% -> floored to MIN_VISIBLE_DASH
// so they render as a sliver instead of disappearing (the floor affects
// only the VISUAL dash length, never the cursor/offset math, so downstream
// slices still land at their true angle — ADR-0004's own consequence).

export interface DonutSliceInput {
  readonly categoryKey: string;
  readonly label: string;
  readonly amountMinor: number;
  readonly percentageOfRevenue: number; // 0-100
  readonly color: string;
}

export interface DonutSegment {
  readonly categoryKey: string;
  readonly label: string;
  readonly color: string;
  readonly percentageOfRevenue: number;
  /** stroke-dasharray "dash gap" values, pathLength=100 units. */
  readonly dash: number;
  readonly gap: number;
  /** stroke-dashoffset, pathLength=100 units (counts from 12 o'clock, clockwise). */
  readonly dashOffset: number;
}

export interface DonutChartData {
  readonly isEmpty: boolean;
  readonly ariaLabel: string;
  readonly segments: readonly DonutSegment[];
}

const MIN_VISIBLE_DASH = 0.6; // percentage points — keeps <1% slices visible

export function buildDonutChartData(slices: readonly DonutSliceInput[]): DonutChartData {
  const nonZero = slices.filter((s) => s.percentageOfRevenue > 0);

  if (nonZero.length === 0) {
    return {
      isEmpty: true,
      ariaLabel: "No expenses to display yet.",
      segments: [],
    };
  }

  const ariaLabel =
    "Expense breakdown donut chart. " +
    nonZero.map((s) => `${s.label} ${formatPct(s.percentageOfRevenue)}`).join(", ") +
    ". Full figures are in the table below.";

  let cursor = 0; // running offset, in "percent of circumference" units
  const segments: DonutSegment[] = nonZero.map((s) => {
    const dash = Math.max(s.percentageOfRevenue, MIN_VISIBLE_DASH);
    const gap = 100 - dash;
    const dashOffset = 100 - cursor;
    cursor += s.percentageOfRevenue; // advance by the TRUE percentage, not the floored dash
    return {
      categoryKey: s.categoryKey,
      label: s.label,
      color: s.color,
      percentageOfRevenue: s.percentageOfRevenue,
      dash,
      gap,
      dashOffset,
    };
  });

  return { isEmpty: false, ariaLabel, segments };
}

function formatPct(value: number): string {
  return `${value.toFixed(value < 1 ? 2 : 1)}%`;
}

// A small fixed, deterministic colour palette keyed by the 10 fixed
// categories (design continuity with the G2-approved mockup fixture, which
// used the same hex values — design/mockup/assets/mockup.js
// RESULTS_FIXTURES). Not merchant-configurable; colour is never the only
// carrier of meaning (ADR-0004) — every slice's label/amount/percentage is
// also in the table.
export const CATEGORY_COLORS: Readonly<Record<string, string>> = {
  cost_of_goods: "#5C6AC4",
  marketing: "#EEC200",
  platform_fees: "#9C6ADE",
  payment_processing: "#50B83C",
  shipping: "#006FBB",
  apps_software: "#B98900",
  payroll: "#47C1BF",
  overhead: "#8A8A8A",
  taxes: "#F49342",
  misc: "#DE3618",
};
