import type { ReactNode } from "react";
import type { EngineResult } from "~/domain/expense-engine";
import { formatMoney, formatPercent, formatRuleApplied, withPercentages } from "~/domain/presentation";
import { buildDonutChartData, CATEGORY_COLORS, type DonutSliceInput } from "~/domain/donut-chart";

// Shared by the Results page (live, not-yet-saved calculation) and the
// saved-calculation detail page (frozen snapshot). Both render from an
// EngineResult-shaped value; this component derives no money figure of its
// own — the only arithmetic here is the display-only "% of revenue"
// (app/domain/presentation.ts), which is a pure function of the amounts it
// is handed.
//
// ADR-0004: the accessible data table is the primary, always-rendered
// representation and comes FIRST in DOM/reading order; the hand-rolled inline
// SVG donut is supplementary and renders from the SAME line-item array.

export function SummaryField({
  label,
  value,
  negative,
}: {
  readonly label: string;
  readonly value: string;
  readonly negative?: boolean;
}) {
  return (
    <div>
      <div style={{ fontSize: "0.8125rem", color: "var(--p-color-text-secondary, #616161)" }}>{label}</div>
      <div style={{ fontSize: "1.25rem", fontWeight: 600, color: negative ? "#D82C0D" : undefined }}>
        {value}
      </div>
    </div>
  );
}

export function ExpenseBreakdown({
  result,
  caption,
  ruleColumnHeading,
}: {
  readonly result: EngineResult;
  readonly caption: ReactNode;
  readonly ruleColumnHeading: string;
}) {
  const lineItems = withPercentages(result);
  const slices: DonutSliceInput[] = lineItems.map((li) => ({
    categoryKey: li.categoryKey,
    label: li.categoryLabel,
    amountMinor: li.computedAmountMinor,
    percentageOfRevenue: li.percentageOfRevenue,
    color: CATEGORY_COLORS[li.categoryKey] ?? "#8A8A8A",
  }));
  const donut = buildDonutChartData(slices);

  const totalPercentage =
    result.revenueMinor > 0 ? (result.totalExpensesMinor / result.revenueMinor) * 100 : 0;

  return (
    <div className="results-grid">
      <div>
        <table className="data-table">
          <caption>{caption}</caption>
          <thead>
            <tr>
              <th scope="col">Category</th>
              <th scope="col">{ruleColumnHeading}</th>
              <th scope="col" className="numeric">
                Amount
              </th>
              <th scope="col" className="numeric">
                % of revenue
              </th>
            </tr>
          </thead>
          <tbody>
            {lineItems.length === 0 && (
              <tr>
                <td colSpan={4}>No expense rules are enabled for this calculation.</td>
              </tr>
            )}
            {lineItems.map((li) => (
              <tr key={li.categoryKey}>
                <th scope="row">
                  <span
                    className="data-table__swatch"
                    style={{ background: CATEGORY_COLORS[li.categoryKey] ?? "#8A8A8A" }}
                    aria-hidden="true"
                  ></span>
                  {li.categoryLabel}
                </th>
                <td>{formatRuleApplied(li)}</td>
                <td className="numeric">{formatMoney(li.computedAmountMinor, result.currencyCode)}</td>
                <td className="numeric">
                  {result.revenueMinor > 0 ? formatPercent(li.percentageOfRevenue) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total expenses</th>
              <td></td>
              <td className="numeric">{formatMoney(result.totalExpensesMinor, result.currencyCode)}</td>
              <td className="numeric">{result.revenueMinor > 0 ? formatPercent(totalPercentage) : "—"}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="chart-panel">
        <DonutChart data={donut} size={220} stroke={28} />
        {!donut.isEmpty && (
          <ul className="donut-legend">
            {lineItems
              .filter((li) => li.computedAmountMinor > 0)
              .map((li) => (
                <li key={li.categoryKey}>
                  <span
                    className="donut-legend__swatch"
                    style={{ background: CATEGORY_COLORS[li.categoryKey] ?? "#8A8A8A" }}
                    aria-hidden="true"
                  ></span>
                  <span className="donut-legend__label">{li.categoryLabel}</span>
                  <span className="donut-legend__value">
                    {result.revenueMinor > 0
                      ? formatPercent(li.percentageOfRevenue)
                      : formatMoney(li.computedAmountMinor, result.currencyCode)}
                  </span>
                </li>
              ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// Hand-rolled inline SVG donut renderer (ADR-0004). Geometry comes entirely
// from app/domain/donut-chart.ts (pure, tested); this component only maps
// that data to <circle> elements. role="img" + aria-label carries the
// accessible summary; every element inside is aria-hidden — the table above
// remains the accessible source of truth.
// --------------------------------------------------------------------------
function DonutChart({
  data,
  size,
  stroke,
}: {
  readonly data: ReturnType<typeof buildDonutChartData>;
  readonly size: number;
  readonly stroke: number;
}) {
  const radius = size / 2 - stroke / 2;
  const cx = size / 2;
  const cy = size / 2;

  if (data.isEmpty) {
    return (
      <svg role="img" aria-label={data.ariaLabel} viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        <circle
          aria-hidden="true"
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke="var(--p-color-border, #e3e3e3)"
          strokeWidth={stroke}
        />
        <text
          aria-hidden="true"
          x={cx}
          y={cy}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={13}
          fill="var(--p-color-text-secondary, #616161)"
        >
          No data
        </text>
      </svg>
    );
  }

  return (
    <svg role="img" aria-label={data.ariaLabel} viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
      <g transform={`rotate(-90 ${cx} ${cy})`}>
        {data.segments.map((seg) => (
          <circle
            key={seg.categoryKey}
            aria-hidden="true"
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke={seg.color}
            strokeWidth={stroke}
            pathLength={100}
            strokeDasharray={`${seg.dash} ${seg.gap}`}
            strokeDashoffset={seg.dashOffset}
          />
        ))}
      </g>
    </svg>
  );
}
