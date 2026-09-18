import { describe, expect, it } from "vitest";
import {
  isMinorUnits,
  isValidCurrencyCode,
  toBasisPoints,
  toMinorUnits,
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
