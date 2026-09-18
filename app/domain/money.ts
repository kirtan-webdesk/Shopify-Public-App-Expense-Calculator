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

// --------------------------------------------------------------------------
// M3 additions — the calculation engine's rounding/reconciliation primitives
// (ADR-0005 items 3 and 4). Kept in this module rather than the engine
// module itself so every "a raw number became money" boundary goes through
// one place, matching the ADR-0005 discipline this file already establishes.
// --------------------------------------------------------------------------

/**
 * Round half away from zero: numerator/denominator -> nearest integer,
 * ties round away from zero. ADR-0005 item 3's documented policy, applied in
 * exact integer (BigInt) arithmetic so it is never subject to float drift.
 *
 * This app's money and rates are never negative (revenue >= 0, rates >= 0,
 * fixed amounts >= 0 — enforced by expense-rule-validation.ts before this is
 * ever called), so only the non-negative case is implemented; a negative
 * numerator throws rather than silently guessing at "away from zero" for a
 * sign this app never produces.
 */
export function roundHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new RangeError(`roundHalfAwayFromZero: denominator must be positive (got ${denominator}).`);
  }
  if (numerator < 0n) {
    throw new RangeError(
      "roundHalfAwayFromZero: negative numerator is not supported — this app's money/rate " +
        "inputs are always non-negative by validation; a negative value here means a bug " +
        "upstream, not a rounding-direction question.",
    );
  }
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  // Half-away-from-zero for a non-negative value is simply "round half up".
  return remainder * 2n >= denominator ? quotient + 1n : quotient;
}

/**
 * Converts an exact BigInt minor-units amount back into the branded
 * MinorUnits (Number) type used everywhere outside the engine's own BigInt
 * arithmetic. Throws if the value would lose precision as a JS number —
 * this app's figures are merchant-entered revenue/expense amounts, many
 * orders of magnitude below Number.MAX_SAFE_INTEGER, so this should never
 * legitimately fire; it exists as the same kind of defensive assertion
 * ADR-0005 asks for "in the engine, not just in tests".
 */
export function toMinorUnitsFromBigInt(value: bigint): MinorUnits {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError(
      `toMinorUnitsFromBigInt: ${value} exceeds Number.MAX_SAFE_INTEGER — cannot represent ` +
        "as a JS number without precision loss.",
    );
  }
  return toMinorUnits(Number(value));
}
