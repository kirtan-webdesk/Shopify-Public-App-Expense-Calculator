import { describe, expect, it } from "vitest";
import { formatRuleApplied, formatSavedAt } from "~/domain/presentation";
import { isUuid } from "~/domain/ids";

describe("formatSavedAt", () => {
  it("formats a UTC timestamp like the G2 mockup, with an explicit zone", () => {
    expect(formatSavedAt("2026-09-17T09:14:00.000Z")).toBe("Sep 17, 2026, 9:14 AM UTC");
  });

  it("uses 12 for midnight and noon and pads minutes", () => {
    expect(formatSavedAt("2026-01-05T00:05:00.000Z")).toBe("Jan 5, 2026, 12:05 AM UTC");
    expect(formatSavedAt("2026-01-05T12:00:00.000Z")).toBe("Jan 5, 2026, 12:00 PM UTC");
    expect(formatSavedAt("2026-12-31T23:59:59.000Z")).toBe("Dec 31, 2026, 11:59 PM UTC");
  });

  it("is independent of the host timezone (always UTC)", () => {
    // 2026-09-17T23:30Z is still Sep 17 in UTC even where local time is Sep 18.
    expect(formatSavedAt("2026-09-17T23:30:00.000Z")).toBe("Sep 17, 2026, 11:30 PM UTC");
  });

  it("returns a placeholder rather than throwing on garbage", () => {
    expect(formatSavedAt("not a date")).toBe("—");
  });
});

describe("formatRuleApplied", () => {
  it("describes each rule type from the rule's own values", () => {
    expect(
      formatRuleApplied({ ruleType: "percentage", rateBasisPoints: 3250, fixedAmountMinor: null, formulaKey: null }),
    ).toBe("32.50% of revenue");
    expect(
      formatRuleApplied({ ruleType: "fixed", rateBasisPoints: null, fixedAmountMinor: 45_000, formulaKey: null }),
    ).toBe("450.00 fixed");
    expect(
      formatRuleApplied({
        ruleType: "formula",
        rateBasisPoints: null,
        fixedAmountMinor: null,
        formulaKey: "tiered_by_revenue_band",
      }),
    ).toBe("Formula: tiered_by_revenue_band");
  });
});

describe("isUuid", () => {
  it("accepts a UUID and rejects everything else without a database round trip", () => {
    expect(isUuid("3f2b8c1e-9a4d-4e0b-8f6a-1c2d3e4f5a6b")).toBe(true);
    expect(isUuid("3F2B8C1E-9A4D-4E0B-8F6A-1C2D3E4F5A6B")).toBe(true);
    expect(isUuid("")).toBe(false);
    expect(isUuid(null)).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid("1")).toBe(false);
    expect(isUuid("3f2b8c1e-9a4d-4e0b-8f6a-1c2d3e4f5a6b'; DROP TABLE calculation;--")).toBe(false);
    expect(isUuid("../../etc/passwd")).toBe(false);
  });
});
