import type { Route } from "./+types/app.results";
import { authenticate } from "~/shopify.server";
import { decodeCalculationResult } from "~/domain/calculation-transport";
import { withPercentages, formatMoney, formatPercent } from "~/domain/presentation";
import { buildDonutChartData, CATEGORY_COLORS, type DonutSliceInput } from "~/domain/donut-chart";

// --------------------------------------------------------------------------
// /app/results — M3 real implementation, replacing the M1 static shell.
//
// Ports design/mockup/results.html (G2-confirmed): the accessible data table
// is the PRIMARY, always-rendered representation (ADR-0004) and comes first
// in reading order; the hand-rolled inline SVG donut is supplementary and
// renders from the exact same computed line-item array — neither derives a
// number the other doesn't have. The mockup's dev-only fixture-data-swap
// dropdown was already stripped at G3 and is NOT reintroduced here.
//
// This route does NOT read from the database and does NOT persist anything
// — M4 (save/history) is explicitly out of scope this sprint. The result it
// renders comes entirely from the `d` query parameter the calculator's
// "Calculate" action produced (app/domain/calculation-transport.ts) — a
// non-persisted, live preview of the form state at the moment Calculate was
// pressed, per the G2 design note this mockup already documented.
// --------------------------------------------------------------------------

export async function loader({ request }: Route.LoaderArgs) {
  await authenticate.admin(request);
  const url = new URL(request.url);
  const encoded = url.searchParams.get("d");
  const result = encoded ? decodeCalculationResult(encoded) : null;
  return { result };
}

export default function ResultsPage({ loaderData }: Route.ComponentProps) {
  const { result } = loaderData;

  if (!result) {
    return (
      <s-page heading="Results">
        <s-link slot="breadcrumb-actions" href="/app/calculator">
          Calculator
        </s-link>
        <s-section>
          <s-banner tone="info" heading="No calculation yet">
            <p>
              Run a calculation from the Calculator page to see results here. Nothing is saved
              automatically — this page only shows the most recent Calculate you ran.
            </p>
          </s-banner>
        </s-section>
      </s-page>
    );
  }

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
    <s-page heading="Results">
      <s-link slot="breadcrumb-actions" href="/app/calculator">
        Calculator
      </s-link>

      <s-section>
        <s-banner tone="warning" heading="Estimate only — not saved">
          <p>
            This is a live preview using the rule values from the Calculator page, including any
            unsaved edits. It has not been saved as a record (save/history is coming in a later
            milestone). Percentages and formula amounts above used placeholder illustrative
            defaults where you have not entered your own figures.
          </p>
        </s-banner>
      </s-section>

      <s-section>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "20px", justifyContent: "space-between" }}>
          <SummaryField label="Revenue" value={formatMoney(result.revenueMinor, result.currencyCode)} />
          <SummaryField
            label="Total expenses"
            value={formatMoney(result.totalExpensesMinor, result.currencyCode)}
          />
          <SummaryField
            label="Net"
            value={formatMoney(result.netAmountMinor, result.currencyCode)}
            negative={result.netAmountMinor < 0}
          />
        </div>
      </s-section>

      <s-section heading="Expense breakdown">
        <div className="results-grid">
          {/* ADR-0004: the data table is the primary, always-rendered
              representation and comes FIRST in DOM/reading order. */}
          <div>
            <table className="data-table">
              <caption>Per-category expense breakdown against the revenue figure above.</caption>
              <thead>
                <tr>
                  <th scope="col">Category</th>
                  <th scope="col">Rule applied</th>
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
                    <td>{ruleAppliedText(li)}</td>
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
                  <td className="numeric">
                    {result.revenueMinor > 0 ? formatPercent(totalPercentage) : "—"}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Supplementary, hand-rolled inline SVG donut (ADR-0004) — renders
              from the SAME `slices` array the table above renders from. */}
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
      </s-section>
    </s-page>
  );
}

function SummaryField({
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

function ruleAppliedText(li: { readonly ruleType: string; readonly rateBasisPoints: number | null; readonly fixedAmountMinor: number | null; readonly formulaKey: string | null }): string {
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
