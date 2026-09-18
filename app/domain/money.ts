// Money as integer minor units end-to-end (ADR-0005). This module is the
// minimal type/helper surface that M1's schema and repositories bind to; the
// full calculation engine (rounding + largest-remainder reconciliation over
// a rule set) is M3 scope (D7, S3.1) and is NOT built here.
//
// The one invariant enforced at M1: nothing outside this module should treat
// money as a raw `number` without going through the branded type, so a raw
// float can never silently reach a money-typed column or parameter
// (FT-13a/FT-13b, gated at G5/M3 — the branded type exists now so the
// convention is established from the first commit, not retrofitted).

declare const MINOR_UNITS_BRAND: unique symbol;

/** An integer count of currency minor units (e.g. cents). Never a float. */
export type MinorUnits = number & { readonly [MINOR_UNITS_BRAND]: true };

export function toMinorUnits(value: number): MinorUnits {
  if (!Number.isInteger(value)) {
    throw new TypeError(
      `toMinorUnits: ${value} is not an integer minor-units amount. ` +
        "Money must never be represented as a float (ADR-0005).",
    );
  }
  return value as MinorUnits;
}

export function isMinorUnits(value: unknown): value is MinorUnits {
  return typeof value === "number" && Number.isInteger(value);
}

/** Integer basis points (1% = 100bp). Never a float rate. */
export type BasisPoints = number & { readonly __basisPointsBrand: true };

export function toBasisPoints(value: number): BasisPoints {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(
      `toBasisPoints: ${value} must be a non-negative integer (ADR-0005).`,
    );
  }
  return value as BasisPoints;
}

const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;

export function isValidCurrencyCode(value: string): boolean {
  return CURRENCY_CODE_PATTERN.test(value);
}
