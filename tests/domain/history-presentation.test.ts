import { describe, expect, it } from "vitest";
import {
  currencyOptionLabel,
  currencySymbol,
  formatMoney,
  formatRuleApplied,
  formatSavedAt,
  trimDecimalZeros,
} from "~/domain/presentation";
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
  const pct = (bp: number) =>
    formatRuleApplied({ ruleType: "percentage", rateBasisPoints: bp, fixedAmountMinor: null, formulaKey: null });
  const fixed = (minor: number, currency?: string) =>
    formatRuleApplied({ ruleType: "fixed", rateBasisPoints: null, fixedAmountMinor: minor, formulaKey: null }, currency);

  it("describes a percentage rule without insignificant trailing zeros (matches the G2 mockup)", () => {
    expect(pct(3250)).toBe("32.5% of revenue");
    expect(pct(800)).toBe("8% of revenue");
    expect(pct(290)).toBe("2.9% of revenue");
    expect(pct(1234)).toBe("12.34% of revenue");
    expect(pct(0)).toBe("0% of revenue");
  });

  it("gives a fixed amount its currency symbol when the calculation currency is known", () => {
    expect(fixed(45_000, "USD")).toBe("$450.00 fixed");
    expect(fixed(45_000, "CAD")).toBe("$450.00 fixed");
    expect(fixed(45_000, "EUR")).toBe("€450.00 fixed");
    expect(fixed(45_000, "GBP")).toBe("£450.00 fixed");
    expect(fixed(45_000)).toBe("450.00 fixed"); // legacy call without a currency: bare number
  });

  it("shows a formula's merchant-facing label, falling back to the stored key for an unknown one", () => {
    const formula = (formulaKey: string) =>
      formatRuleApplied({ ruleType: "formula", rateBasisPoints: null, fixedAmountMinor: null, formulaKey });
    expect(formula("tiered_by_revenue_band")).toBe("Formula: Tiered by revenue band");
    expect(formula("retired_formula_key")).toBe("Formula: retired_formula_key");
  });
});

describe("currencySymbol / currencyOptionLabel / trimDecimalZeros", () => {
  it("follows the selected currency instead of a hardcoded dollar sign", () => {
    expect(currencySymbol("USD")).toBe("$");
    expect(currencySymbol("EUR")).toBe("€");
    expect(currencySymbol("GBP")).toBe("£");
    expect(currencySymbol("NOPE")).toBe("NOPE"); // never throws on an unknown code
    expect(formatMoney(45_000, "EUR").startsWith(currencySymbol("EUR"))).toBe(true);
  });

  it("labels the currency picker options like the mockup", () => {
    expect(currencyOptionLabel("USD")).toBe("USD — US Dollar");
    expect(currencyOptionLabel("GBP")).toBe("GBP — British Pound");
    expect(currencyOptionLabel("XYZ")).toBe("XYZ");
  });

  it("trims trailing zeros only from well-formed 2-decimal numbers", () => {
    expect(trimDecimalZeros("32.50")).toBe("32.5");
    expect(trimDecimalZeros("8.00")).toBe("8");
    expect(trimDecimalZeros("2.9")).toBe("2.9");
    expect(trimDecimalZeros("")).toBe("");
    expect(trimDecimalZeros("abc")).toBe("abc");
    expect(trimDecimalZeros("1.234")).toBe("1.234");
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
