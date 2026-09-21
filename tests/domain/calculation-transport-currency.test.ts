import { describe, expect, it } from "vitest";
import { calculateExpenses } from "~/domain/expense-engine";
import { decodeCalculationResult, encodeCalculationResult } from "~/domain/calculation-transport";
import { formatMoney } from "~/domain/presentation";

// A crafted or corrupted ?d= must not reach Intl.NumberFormat with a currency
// it cannot format — that throws a RangeError and would crash the Results page.

function withCurrency(currency: unknown): string {
  const base = calculateExpenses({ revenueMinor: 100_000, currencyCode: "USD", rules: [] });
  const payload = JSON.parse(Buffer.from(encodeCalculationResult(base), "base64url").toString("utf8"));
  payload.c = currency;
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

describe("calculation-transport currency validation", () => {
  it("decodes each supported currency", () => {
    for (const code of ["USD", "CAD", "EUR", "GBP"]) {
      expect(decodeCalculationResult(withCurrency(code))?.currencyCode).toBe(code);
    }
  });

  it("returns null for an unsupported or malformed currency code instead of a result that would crash formatting", () => {
    for (const bad of ["JPY", "usd", "US", "USDX", "", "  ", "$$$", "ZZZ", "<script>", 5, null, {}]) {
      expect(decodeCalculationResult(withCurrency(bad))).toBeNull();
    }
  });

  it("documents the crash the validation prevents: Intl.NumberFormat throws on a malformed code", () => {
    expect(() => formatMoney(100, "not-a-code")).toThrow(RangeError);
    // ...and every value that decodes is formattable.
    for (const code of ["USD", "CAD", "EUR", "GBP"]) {
      const decoded = decodeCalculationResult(withCurrency(code));
      expect(decoded).not.toBeNull();
      expect(() => formatMoney(decoded!.revenueMinor, decoded!.currencyCode)).not.toThrow();
    }
  });
});
