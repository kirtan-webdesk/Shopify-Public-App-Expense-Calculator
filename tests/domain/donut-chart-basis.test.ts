import { describe, expect, it } from "vitest";
import { buildDonutChartData, type DonutSliceInput } from "~/domain/donut-chart";

// G4-sprint-3.5 B2 / B2b: the empty state and the slices are keyed on the
// EXPENSE AMOUNT (not on percentage-of-revenue), and the ring is measured
// against revenue only when the expenses fit inside it — otherwise against
// total expenses, so it can never be drawn past 100%.

function slice(overrides: Partial<DonutSliceInput> & Pick<DonutSliceInput, "categoryKey">): DonutSliceInput {
  return {
    label: overrides.categoryKey,
    amountMinor: 0,
    percentageOfRevenue: 0,
    color: "#000000",
    ...overrides,
  };
}

describe("donut-chart at zero revenue and when expenses exceed revenue", () => {
  it("revenue 0 + shipping 45000: NOT empty — one full-ring segment, basis = share of total expenses", () => {
    // percentageOfRevenue() defines x / 0 as 0, so at revenue 0 every slice carries 0%.
    const data = buildDonutChartData([
      slice({ categoryKey: "shipping", label: "Shipping", amountMinor: 45_000, percentageOfRevenue: 0 }),
      slice({ categoryKey: "marketing", amountMinor: 0, percentageOfRevenue: 0 }),
    ]);
    expect(data.isEmpty).toBe(false);
    expect(data.basis).toBe("expenses");
    expect(data.segments).toHaveLength(1);
    expect(data.segments[0]).toMatchObject({ categoryKey: "shipping", dash: 100, gap: 0, dashOffset: 100, share: 100 });
    expect(data.ariaLabel).toContain("of total expenses");
  });

  it("revenue 0 with two expenses: shares are of total expenses and close the ring at exactly 100", () => {
    const data = buildDonutChartData([
      slice({ categoryKey: "shipping", amountMinor: 45_000, percentageOfRevenue: 0 }),
      slice({ categoryKey: "cost_of_goods", amountMinor: 5_000, percentageOfRevenue: 0 }),
    ]);
    expect(data.isEmpty).toBe(false);
    expect(data.segments.map((s) => s.share)).toEqual([90, 10]);
    expect(data.segments.map((s) => s.dash)).toEqual([90, 10]);
    expect(data.segments.map((s) => s.dashOffset)).toEqual([100, 10]);
  });

  it("expenses exceed revenue (revenue 10000c: cogs 5000 = 50%, shipping 45000 = 450%): dashes 10 and 90, none > 100, no negative gap", () => {
    const data = buildDonutChartData([
      slice({ categoryKey: "cost_of_goods", amountMinor: 5_000, percentageOfRevenue: 50 }),
      slice({ categoryKey: "shipping", amountMinor: 45_000, percentageOfRevenue: 450 }),
    ]);
    expect(data.basis).toBe("expenses");
    expect(data.segments.map((s) => s.dash)).toEqual([10, 90]);
    for (const seg of data.segments) {
      expect(seg.dash).toBeLessThanOrEqual(100);
      expect(seg.gap).toBeGreaterThanOrEqual(0);
      expect(seg.dashOffset).toBeGreaterThanOrEqual(0);
      expect(seg.dashOffset).toBeLessThanOrEqual(100);
    }
    expect(data.ariaLabel).toContain("of total expenses");
    // the true share of revenue is still reported alongside
    expect(data.segments.map((s) => s.percentageOfRevenue)).toEqual([50, 450]);
  });

  it("seeded-defaults shape: 158.5% of revenue switches to share of total expenses and stays within 100", () => {
    // 71.5% of revenue in percentage rules + $870 fixed on $1,000 revenue.
    const data = buildDonutChartData([
      slice({ categoryKey: "cost_of_goods", amountMinor: 32_500, percentageOfRevenue: 32.5 }),
      slice({ categoryKey: "marketing", amountMinor: 8_000, percentageOfRevenue: 8 }),
      slice({ categoryKey: "shipping", amountMinor: 45_000, percentageOfRevenue: 45 }),
      slice({ categoryKey: "payroll", amountMinor: 42_000, percentageOfRevenue: 42 }),
      slice({ categoryKey: "overhead", amountMinor: 31_000, percentageOfRevenue: 31 }),
    ]);
    expect(data.basis).toBe("expenses");
    const total = data.segments.reduce((sum, s) => sum + s.share, 0);
    expect(total).toBeCloseTo(100, 6);
    for (const seg of data.segments) {
      expect(seg.dash).toBeLessThanOrEqual(100);
      expect(seg.gap).toBeGreaterThanOrEqual(0);
    }
  });

  it("revenue 100000c with cogs 5000 + shipping 45000 (50% of revenue, fits): ring stays share-of-revenue, dashes 5 and 45", () => {
    const data = buildDonutChartData([
      slice({ categoryKey: "cost_of_goods", amountMinor: 5_000, percentageOfRevenue: 5 }),
      slice({ categoryKey: "shipping", amountMinor: 45_000, percentageOfRevenue: 45 }),
    ]);
    expect(data.basis).toBe("revenue");
    expect(data.segments.map((s) => s.dash)).toEqual([5, 45]);
    expect(data.segments.map((s) => s.dashOffset)).toEqual([100, 95]);
    expect(data.ariaLabel).toContain("share of revenue");
    expect(data.ariaLabel).not.toContain("of total expenses");
  });

  it("expenses exactly equal to revenue (sums to 100%) stays share-of-revenue despite float noise", () => {
    const tenths = Array.from({ length: 10 }, (_, i) =>
      slice({ categoryKey: `c${i}`, amountMinor: 1_000, percentageOfRevenue: 10 }),
    );
    const data = buildDonutChartData(tenths);
    expect(data.basis).toBe("revenue");
    expect(data.segments.every((s) => s.dash === 10)).toBe(true);
    for (const seg of data.segments) {
      expect(seg.dashOffset).toBeGreaterThanOrEqual(0);
      expect(seg.dashOffset).toBeLessThanOrEqual(100);
    }
  });

  it("all-zero amounts -> the empty ring, keyed on the amount rather than the percentage", () => {
    expect(
      buildDonutChartData([
        slice({ categoryKey: "cost_of_goods", amountMinor: 0, percentageOfRevenue: 0 }),
        slice({ categoryKey: "marketing", amountMinor: 0, percentageOfRevenue: 0 }),
      ]).isEmpty,
    ).toBe(true);
    expect(buildDonutChartData([slice({ categoryKey: "marketing", amountMinor: 0, percentageOfRevenue: 12 })]).isEmpty).toBe(true);
  });

  it("a sub-1% slice is still floored to a visible sliver on the expenses basis, without exceeding 100", () => {
    const data = buildDonutChartData([
      slice({ categoryKey: "shipping", amountMinor: 999_900, percentageOfRevenue: 0 }),
      slice({ categoryKey: "misc", amountMinor: 100, percentageOfRevenue: 0 }),
    ]);
    const misc = data.segments.find((s) => s.categoryKey === "misc")!;
    expect(misc.share).toBeCloseTo(0.01, 5);
    expect(misc.dash).toBe(0.6);
    expect(misc.gap).toBeCloseTo(99.4, 5);
    expect(data.segments.every((s) => s.dash <= 100 && s.gap >= 0)).toBe(true);
  });

  it('the accessible label points at the table ABOVE (the table precedes the chart), never "below"', () => {
    const data = buildDonutChartData([
      slice({ categoryKey: "cost_of_goods", label: "Cost of Goods", amountMinor: 5000, percentageOfRevenue: 50 }),
    ]);
    expect(data.ariaLabel).toContain("Full figures are in the table above.");
    expect(data.ariaLabel).not.toContain("below");
  });
});
