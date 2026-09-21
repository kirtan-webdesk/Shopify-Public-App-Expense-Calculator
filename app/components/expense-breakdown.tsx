import type { EngineResult } from "~/domain/expense-engine";
import { formatMoney, formatPercent, formatRuleApplied, withPercentages } from "~/domain/presentation";
import {
  buildDonutChartData,
  CATEGORY_COLORS,
  FALLBACK_CATEGORY_COLOR,
  type DonutChartData,
  type DonutSliceInput,
} from "~/domain/donut-chart";

// Shared by the Results page (live, not-yet-saved calculation) and the
// saved-calculation detail page (frozen snapshot). Both render from an
// EngineResult-shaped value; this component derives no money figure of its
// own - the only arithmetic here is the display-only "% of revenue"
// (app/domain/presentation.ts), which is a pure function of the amounts it
// is handed.
//
// G2-revision v2 (design/v2/results.html, history-detail.html): Polaris web
// components for layout (s-grid / s-stack / s-box), the three figures as
// tiles, and s-table for the breakdown. ADR-0004 still holds: the breakdown
// TABLE is the primary, always-rendered representation and comes FIRST in
// DOM/reading order; the hand-rolled inline SVG donut (no chart library) is
// supplementary and renders from the SAME line-item array.

const colorFor = (categoryKey: string): string => CATEGORY_COLORS[categoryKey] ?? FALLBACK_CATEGORY_COLOR;

export interface MetricLabels {
  readonly revenue: string;
  readonly total: string;
  readonly net: string;
}

/**
 * Revenue / Total expenses / Net as three tiles: three columns when the
 * container is wider than 560px, one column below (R1: not stacked full-width on
 * wide iframes). `s-grid`'s `@container` syntax only measures inside an
 * `s-query-container`, which the G2 mockup omitted, and the branches are split on
 * commas, so `repeat(3, 1fr)` (a comma inside the branch) is mis-parsed and the grid
 * stays one column: write the three tracks out ("1fr 1fr 1fr"). Both were causes of
 * the mockup's tiles stacking at 1000px (measured in a browser, G4-sprint-4.1).
 * A negative net is signalled by a text badge with an icon, never by colour alone.
 */
export function MetricTiles({ result, labels }: { readonly result: EngineResult; readonly labels: MetricLabels }) {
  const { currencyCode: currency, revenueMinor, totalExpensesMinor, netAmountMinor } = result;
  const totalShare =
    revenueMinor > 0 ? `${formatPercent((totalExpensesMinor / revenueMinor) * 100)} of revenue` : currency;
  return (
    <s-query-container>
      <s-grid gridTemplateColumns="@container (inline-size > 560px) 1fr 1fr 1fr, 1fr" gap="base">
        <MetricTile label={labels.revenue} value={formatMoney(revenueMinor, currency)} sub={currency} />
        <MetricTile label={labels.total} value={formatMoney(totalExpensesMinor, currency)} sub={totalShare} />
        <MetricTile
          label={labels.net}
          value={formatMoney(netAmountMinor, currency)}
          sub={currency}
          flag={netAmountMinor < 0}
        />
      </s-grid>
    </s-query-container>
  );
}

function MetricTile({
  label,
  value,
  sub,
  flag,
}: {
  readonly label: string;
  readonly value: string;
  readonly sub: string;
  readonly flag?: boolean;
}) {
  return (
    <s-box border="base" borderRadius="base" padding="base" background="subdued">
      <s-stack gap="small">
        <s-text color="subdued">{label}</s-text>
        <s-heading>
          <span className="tabular">{value}</span>
        </s-heading>
        <s-stack direction="inline" gap="small" alignItems="center">
          <s-text color="subdued">{sub}</s-text>
          {flag && (
            <s-badge tone="critical" icon="alert-circle">
              Expenses exceed revenue
            </s-badge>
          )}
        </s-stack>
      </s-stack>
    </s-box>
  );
}

export function ExpenseBreakdown({
  result,
  ruleColumnHeading,
}: {
  readonly result: EngineResult;
  readonly ruleColumnHeading: string;
}) {
  const lineItems = withPercentages(result);
  const slices: DonutSliceInput[] = lineItems.map((li) => ({
    categoryKey: li.categoryKey,
    label: li.categoryLabel,
    amountMinor: li.computedAmountMinor,
    percentageOfRevenue: li.percentageOfRevenue,
    color: colorFor(li.categoryKey),
  }));
  const donut = buildDonutChartData(slices);
  const { currencyCode: currency, revenueMinor, totalExpensesMinor } = result;
  const hasRevenue = revenueMinor > 0;
  const totalPercentage = hasRevenue ? (totalExpensesMinor / revenueMinor) * 100 : 0;
  const leftOver = donut.basis === "revenue" ? 100 - donut.segments.reduce((sum, s) => sum + s.share, 0) : 0;
  const basisText = describeBasis(donut, hasRevenue);

  return (
    <s-query-container>
      <s-grid gridTemplateColumns="@container (inline-size > 720px) 3fr 2fr, 1fr" gap="large" alignItems="start">
        {/* No aria-label on s-table: the host has no ARIA role of its own (the grid role lives in its
          shadow root), so a host label is not exposed as the table's name and axe flags it as a
          prohibited attribute (measured, G4-sprint-4.1). The table is introduced by the section
          heading above it ("Expense breakdown"). */}
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">Category</s-table-header>
            <s-table-header listSlot="secondary">{ruleColumnHeading}</s-table-header>
            <s-table-header format="currency">{`Amount (${currency})`}</s-table-header>
            <s-table-header format="numeric">% of revenue</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {lineItems.length === 0 && (
              <s-table-row>
                <s-table-cell>No expense rules are enabled for this calculation.</s-table-cell>
                <s-table-cell></s-table-cell>
                <s-table-cell></s-table-cell>
                <s-table-cell></s-table-cell>
              </s-table-row>
            )}
            {lineItems.map((li) => (
              <s-table-row key={li.categoryKey}>
                <s-table-cell>
                  <span className="swatch" style={{ background: colorFor(li.categoryKey) }} aria-hidden="true"></span>
                  {li.categoryLabel}
                </s-table-cell>
                <s-table-cell>{formatRuleApplied(li, currency)}</s-table-cell>
                <s-table-cell>
                  <span className="tabular">{formatMoney(li.computedAmountMinor, currency)}</span>
                </s-table-cell>
                <s-table-cell>
                  <span className="tabular">{hasRevenue ? formatPercent(li.percentageOfRevenue) : "—"}</span>
                </s-table-cell>
              </s-table-row>
            ))}
            <s-table-row>
              <s-table-cell>
                <strong>Total expenses</strong>
              </s-table-cell>
              <s-table-cell></s-table-cell>
              <s-table-cell>
                <strong className="tabular">{formatMoney(totalExpensesMinor, currency)}</strong>
              </s-table-cell>
              <s-table-cell>
                <strong className="tabular">{hasRevenue ? formatPercent(totalPercentage) : "—"}</strong>
              </s-table-cell>
            </s-table-row>
          </s-table-body>
        </s-table>

        <s-stack gap="base">
          <s-heading>{basisText.title}</s-heading>
          <DonutChart data={donut} />
          <s-text color="subdued">{basisText.note}</s-text>
          {!donut.isEmpty && (
            <ul className="legend">
              {donut.segments.map((seg) => (
                <li key={seg.categoryKey}>
                  <span className="swatch" style={{ background: seg.color }} aria-hidden="true"></span>
                  <span className="legend__label">{seg.label}</span>
                  <span className="legend__value">{formatPercent(seg.share)}</span>
                </li>
              ))}
              {donut.basis === "revenue" && leftOver > 0.005 && (
                <li>
                  <span className="swatch swatch--track" aria-hidden="true"></span>
                  <span className="legend__label">Left over (net)</span>
                  <span className="legend__value">{formatPercent(leftOver)}</span>
                </li>
              )}
            </ul>
          )}
        </s-stack>
      </s-grid>
    </s-query-container>
  );
}

/** The on-screen statement of what the ring is a share OF (also in the aria-label). */
export function describeBasis(donut: DonutChartData, hasRevenue: boolean): { title: string; note: string } {
  if (donut.isEmpty) {
    return { title: "Chart", note: "Nothing to plot: no category has an expense amount above 0." };
  }
  if (donut.basis === "revenue") {
    return {
      title: "Share of revenue",
      note: "Each slice is a category's share of your revenue. The grey part of the ring is what is left over (net).",
    };
  }
  if (!hasRevenue) {
    return {
      title: "Share of total expenses",
      note:
        "Each slice is a category's share of total expenses. There is no revenue to compare against, " +
        "so the ring always closes at 100%.",
    };
  }
  return {
    title: "Share of total expenses",
    note:
      "Each slice is a category's share of total expenses, because expenses are higher than revenue " +
      "and a ring cannot show more than 100% of revenue.",
  };
}

// --------------------------------------------------------------------------
// Hand-rolled inline SVG donut renderer (ADR-0004). Geometry comes entirely
// from app/domain/donut-chart.ts (pure, tested); this component only maps
// that data to <circle> elements. role="img" + aria-label carries the
// accessible summary; every element inside is aria-hidden - the table remains
// the accessible source of truth.
// --------------------------------------------------------------------------
const SIZE = 220;
const STROKE = 38;

function DonutChart({ data }: { readonly data: DonutChartData }) {
  const radius = (SIZE - STROKE) / 2;
  const c = SIZE / 2;

  if (data.isEmpty) {
    return (
      <svg
        className="donut"
        role="img"
        aria-label={data.ariaLabel}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width={SIZE}
        height={SIZE}
      >
        <circle aria-hidden="true" cx={c} cy={c} r={radius} fill="none" stroke="#e3e3e3" strokeWidth={STROKE} />
        <text aria-hidden="true" x={c} y={c} textAnchor="middle" dominantBaseline="middle" fontSize={14} fill="#616161">
          No data
        </text>
      </svg>
    );
  }

  return (
    <svg
      className="donut"
      role="img"
      aria-label={data.ariaLabel}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      width={SIZE}
      height={SIZE}
    >
      <g transform={`rotate(-90 ${c} ${c})`}>
        {/* The empty part of a share-of-revenue ring is the margin left over. */}
        {data.basis === "revenue" && (
          <circle aria-hidden="true" cx={c} cy={c} r={radius} fill="none" stroke="#e3e3e3" strokeWidth={STROKE} />
        )}
        {data.segments.map((seg) => (
          <circle
            key={seg.categoryKey}
            aria-hidden="true"
            cx={c}
            cy={c}
            r={radius}
            fill="none"
            stroke={seg.color}
            strokeWidth={STROKE}
            pathLength={100}
            strokeDasharray={`${seg.dash} ${seg.gap}`}
            strokeDashoffset={seg.dashOffset}
          />
        ))}
      </g>
    </svg>
  );
}
