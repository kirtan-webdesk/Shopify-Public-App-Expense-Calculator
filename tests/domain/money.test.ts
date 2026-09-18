import { describe, expect, it } from "vitest";
import {
  isMinorUnits,
  isValidCurrencyCode,
  roundHalfAwayFromZero,
  toBasisPoints,
  toMinorUnits,
  toMinorUnitsFromBigInt,
} from "~/domain/money";

describe("money (ADR-0005 — integer minor units, never a float)", () => {
  it("toMinorUnits accepts an integer", () => {
    expect(toMinorUnits(1250)).toBe(1250);
  });

  it("toMinorUnits rejects a non-integer (the exact bug class ADR-0005 exists to prevent)", () => {
    expect(() => toMinorUnits(12.5)).toThrow(TypeError);
  });

  it("isMinorUnits distinguishes integers from floats", () => {
    expect(isMinorUnits(100)).toBe(true);
    expect(isMinorUnits(100.5)).toBe(false);
  });

  it("toBasisPoints rejects negative values", () => {
    expect(() => toBasisPoints(-1)).toThrow(TypeError);
  });

  it("toBasisPoints rejects non-integers", () => {
    expect(() => toBasisPoints(15.5)).toThrow(TypeError);
  });

  it("isValidCurrencyCode enforces the same pattern as the DB CHECK constraint", () => {
    expect(isValidCurrencyCode("USD")).toBe(true);
    expect(isValidCurrencyCode("usd")).toBe(false);
    expect(isValidCurrencyCode("US")).toBe(false);
    expect(isValidCurrencyCode("DOLLAR")).toBe(false);
  });
});

describe("roundHalfAwayFromZero (ADR-0005 item 3 — the documented rounding policy)", () => {
  it("rounds down below the half mark", () => {
    expect(roundHalfAwayFromZero(24999n, 10000n)).toBe(2n);
  });

  it("rounds up at exactly the half mark (away from zero)", () => {
    expect(roundHalfAwayFromZero(25000n, 10000n)).toBe(3n);
  });

  it("rounds up above the half mark", () => {
    expect(roundHalfAwayFromZero(25001n, 10000n)).toBe(3n);
  });

  it("handles an exact division with no remainder", () => {
    expect(roundHalfAwayFromZero(30000n, 10000n)).toBe(3n);
  });

  it("handles zero", () => {
    expect(roundHalfAwayFromZero(0n, 10000n)).toBe(0n);
  });

  it("rejects a non-positive denominator", () => {
    expect(() => roundHalfAwayFromZero(100n, 0n)).toThrow(RangeError);
    expect(() => roundHalfAwayFromZero(100n, -1n)).toThrow(RangeError);
  });

  it("rejects a negative numerator (this app's money/rates are never negative)", () => {
    expect(() => roundHalfAwayFromZero(-1n, 10000n)).toThrow(RangeError);
  });
});

describe("toMinorUnitsFromBigInt", () => {
  it("converts an exact BigInt to the branded MinorUnits number type", () => {
    expect(toMinorUnitsFromBigInt(12500n)).toBe(12500);
  });

  it("throws rather than silently losing precision beyond MAX_SAFE_INTEGER", () => {
    expect(() => toMinorUnitsFromBigInt(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toThrow(RangeError);
  });
});
