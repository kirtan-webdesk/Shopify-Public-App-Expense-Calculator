import { describe, expect, it } from "vitest";
import { CATEGORY_COLORS, FALLBACK_CATEGORY_COLOR } from "~/domain/donut-chart";
import { EXPENSE_CATEGORIES } from "~/domain/expense-categories";

// G2-revision v2, J8: every chart colour must be at least 3:1 against white
// (WCAG 2.1 1.4.11 non-text contrast; the v1 palette had colours below that -
// QA finding p4). The ratio is COMPUTED here from the WCAG relative-luminance
// definition, not asserted from a hand calculation.

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string): number {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`not a 6-digit hex colour: ${hex}`);
  const [r, g, b] = [m[1]!, m[2]!, m[3]!].map((h) => channel(parseInt(h, 16)));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
export function contrastOnWhite(hex: string): number {
  return (luminance("#FFFFFF") + 0.05) / (luminance(hex) + 0.05);
}

describe("chart palette (J8)", () => {
  it("the contrast helper matches known WCAG reference values", () => {
    expect(contrastOnWhite("#000000")).toBeCloseTo(21, 5);
    expect(contrastOnWhite("#FFFFFF")).toBeCloseTo(1, 5);
    expect(contrastOnWhite("#767676")).toBeGreaterThan(4.5); // the classic AA grey
    expect(contrastOnWhite("#777777")).toBeLessThan(4.5);
  });

  it("has a colour for every one of the 10 categories, no more", () => {
    expect(Object.keys(CATEGORY_COLORS).sort()).toEqual(EXPENSE_CATEGORIES.map((c) => c.key).sort());
  });

  it.each(Object.entries(CATEGORY_COLORS))("%s (%s) is at least 3:1 on white", (_key, color) => {
    expect(contrastOnWhite(color)).toBeGreaterThanOrEqual(3);
  });

  it("the fallback colour is at least 3:1 on white too", () => {
    expect(contrastOnWhite(FALLBACK_CATEGORY_COLOR)).toBeGreaterThanOrEqual(3);
  });

  it("every category colour is distinct (a legend swatch identifies one category)", () => {
    const colors = Object.values(CATEGORY_COLORS).map((c) => c.toLowerCase());
    expect(new Set(colors).size).toBe(colors.length);
  });

  it("the v1 colours that were below 3:1 are gone", () => {
    const v1Weak = ["#EEC200", "#47C1BF", "#50B83C", "#F49342"];
    const now = Object.values(CATEGORY_COLORS).map((c) => c.toUpperCase());
    for (const weak of v1Weak) {
      expect(contrastOnWhite(weak), `${weak} was expected to be a failing v1 colour`).toBeLessThan(3);
      expect(now).not.toContain(weak);
    }
  });
});
