import { describe, expect, it } from "vitest";
import { buildDonutChartData, type DonutSliceInput } from "~/domain/donut-chart";

function slice(overrides: Partial<DonutSliceInput> & Pick<DonutSliceInput, "categoryKey">): DonutSliceInput {
  return {
    label: overrides.categoryKey,
    amountMinor: 0,
    percentageOfRevenue: 0,
    color: "#000000",
    ...overrides,
  };
}

describe("donut-chart geometry (ADR-0004 mandated states)", () => {
  it("zero revenue / all-categories-zero -> empty ring sentinel, not a crash", () => {
    const data = buildDonutChartData([
      slice({ categoryKey: "cost_of_goods", amountMinor: 0, percentageOfRevenue: 0 }),
      slice({ categoryKey: "marketing", amountMinor: 0, percentageOfRevenue: 0 }),
    ]);
    expect(data.isEmpty).toBe(true);
    expect(data.segments).toHaveLength(0);
  });

  it("no slices at all -> also the empty state, not a crash", () => {
    const data = buildDonutChartData([]);
    expect(data.isEmpty).toBe(true);
  });

  it("exactly one non-zero category -> a single full-ring segment (100 dash, no seam)", () => {
    const data = buildDonutChartData([
      slice({ categoryKey: "cost_of_goods", amountMinor: 10_000, percentageOfRevenue: 100 }),
      slice({ categoryKey: "marketing", amountMinor: 0, percentageOfRevenue: 0 }),
    ]);
    expect(data.isEmpty).toBe(false);
    expect(data.segments).toHaveLength(1);
    expect(data.segments[0]?.dash).toBe(100);
    expect(data.segments[0]?.gap).toBe(0);
  });

  it("slices under ~1% are floored to a minimum visible dash length without disturbing downstream angles", () => {
    const data = buildDonutChartData([
      slice({ categoryKey: "cost_of_goods", amountMinor: 96_000, percentageOfRevenue: 96 }),
      slice({ categoryKey: "apps_software", amountMinor: 400, percentageOfRevenue: 0.4 }),
      slice({ categoryKey: "overhead", amountMinor: 350, percentageOfRevenue: 0.35 }),
    ]);
    const small1 = data.segments.find((s) => s.categoryKey === "apps_software");
    const small2 = data.segments.find((s) => s.categoryKey === "overhead");
    // floored to the visible minimum, not their true (sub-1%) percentage
    expect(small1?.dash).toBeGreaterThanOrEqual(0.6);
    expect(small2?.dash).toBeGreaterThanOrEqual(0.6);
    expect(small1?.dash).not.toBe(0.4);
    // but the offset (cursor position) still reflects the TRUE percentages,
    // not the floored dash — verified by checking the cumulative math: the
    // third segment's offset should be 100 - (96 + 0.4) = 3.6, not
    // 100 - (96 + 0.6).
    const third = data.segments[2];
    expect(third?.dashOffset).toBeCloseTo(100 - (96 + 0.4), 5);
  });

  it("multiple normal slices sum their true percentages in dashOffset progression", () => {
    const data = buildDonutChartData([
      slice({ categoryKey: "cost_of_goods", amountMinor: 5000, percentageOfRevenue: 50 }),
      slice({ categoryKey: "marketing", amountMinor: 3000, percentageOfRevenue: 30 }),
      slice({ categoryKey: "payroll", amountMinor: 2000, percentageOfRevenue: 20 }),
    ]);
    expect(data.segments).toHaveLength(3);
    expect(data.segments[0]?.dashOffset).toBe(100);
    expect(data.segments[1]?.dashOffset).toBe(50);
    expect(data.segments[2]?.dashOffset).toBe(20);
  });

  it("produces an aria-label summarizing every non-zero slice", () => {
    const data = buildDonutChartData([
      slice({ categoryKey: "cost_of_goods", label: "Cost of Goods", amountMinor: 5000, percentageOfRevenue: 50 }),
    ]);
    expect(data.ariaLabel).toContain("Cost of Goods");
    expect(data.ariaLabel.toLowerCase()).toContain("donut");
  });
});
