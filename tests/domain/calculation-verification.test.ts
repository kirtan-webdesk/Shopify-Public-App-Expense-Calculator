import { describe, expect, it } from "vitest";
import { recomputeAndVerifyClaimedResult } from "~/domain/calculation-verification";
import { decodeCalculationResult } from "~/domain/calculation-transport";
import { ENGINE_VERSION } from "~/domain/expense-engine";
import { buildDefaultResult, encodeDefaultResult, tamperTransport } from "../helpers/calc-fixtures";

// The save path must never persist client-supplied amounts. These tests pin
// the contract of app/domain/calculation-verification.ts: a transported
// payload is only a claim about INPUTS; it is accepted iff the engine's own
// recomputation reproduces the claimed amounts, and what is accepted is the
// engine's recomputed result.

function claimedFrom(encoded: string) {
  const decoded = decodeCalculationResult(encoded);
  if (!decoded) throw new Error("fixture failed to decode");
  return decoded;
}

describe("recomputeAndVerifyClaimedResult", () => {
  it("accepts an honest payload and returns the engine's recomputed result", () => {
    const honest = buildDefaultResult();
    const verified = recomputeAndVerifyClaimedResult(claimedFrom(encodeDefaultResult()));
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.result.totalExpensesMinor).toBe(honest.totalExpensesMinor);
    expect(verified.result.netAmountMinor).toBe(honest.netAmountMinor);
    expect(verified.result.engineVersion).toBe(ENGINE_VERSION);
    expect(verified.result.lineItems.map((li) => li.computedAmountMinor)).toEqual(
      honest.lineItems.map((li) => li.computedAmountMinor),
    );
  });

  it("persists the engine's own engine version, not the payload's claim", () => {
    const stale = tamperTransport(encodeDefaultResult(), (p) => {
      p.ev = "expense-engine@0.0.1-forged";
    });
    const verified = recomputeAndVerifyClaimedResult(claimedFrom(stale));
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.result.engineVersion).toBe(ENGINE_VERSION);
  });

  it("rejects a tampered line-item amount (mismatch)", () => {
    const tampered = tamperTransport(encodeDefaultResult(), (p) => {
      const li = p.li as Array<{ amt: number }>;
      li[0]!.amt = li[0]!.amt + 1;
    });
    const verified = recomputeAndVerifyClaimedResult(claimedFrom(tampered));
    expect(verified.ok).toBe(false);
    if (verified.ok) return;
    expect(verified.reason).toBe("mismatch");
  });

  it("rejects a tampered total (mismatch) even when every line item is honest", () => {
    const tampered = tamperTransport(encodeDefaultResult(), (p) => {
      p.t = (p.t as number) - 1000;
    });
    const verified = recomputeAndVerifyClaimedResult(claimedFrom(tampered));
    expect(verified.ok).toBe(false);
    if (verified.ok) return;
    expect(verified.reason).toBe("mismatch");
  });

  it("rejects a tampered net figure (mismatch)", () => {
    const tampered = tamperTransport(encodeDefaultResult(), (p) => {
      p.n = (p.n as number) + 1;
    });
    const verified = recomputeAndVerifyClaimedResult(claimedFrom(tampered));
    expect(verified.ok).toBe(false);
  });

  it("rejects a tampered rate: amounts no longer match the engine's output for that rate", () => {
    const tampered = tamperTransport(encodeDefaultResult(), (p) => {
      const li = p.li as Array<{ rbp?: number }>;
      li[0]!.rbp = 1; // claims 0.01% but keeps the amount computed for 32.5%
    });
    const verified = recomputeAndVerifyClaimedResult(claimedFrom(tampered));
    expect(verified.ok).toBe(false);
    if (verified.ok) return;
    expect(verified.reason).toBe("mismatch");
  });

  it("rejects a tampered revenue (mismatch)", () => {
    const tampered = tamperTransport(encodeDefaultResult(), (p) => {
      p.r = 1;
    });
    const verified = recomputeAndVerifyClaimedResult(claimedFrom(tampered));
    expect(verified.ok).toBe(false);
  });

  it("rejects an unsupported currency code as invalid input", () => {
    const tampered = tamperTransport(encodeDefaultResult(), (p) => {
      p.c = "XXX";
    });
    const verified = recomputeAndVerifyClaimedResult(claimedFrom(tampered));
    expect(verified.ok).toBe(false);
    if (verified.ok) return;
    expect(verified.reason).toBe("invalid_input");
  });

  it("rejects revenue above the calculator's sanity ceiling as invalid input", () => {
    const tampered = tamperTransport(encodeDefaultResult(), (p) => {
      p.r = 999_999_999_999 + 1;
    });
    const verified = recomputeAndVerifyClaimedResult(claimedFrom(tampered));
    expect(verified.ok).toBe(false);
    if (verified.ok) return;
    expect(verified.reason).toBe("invalid_input");
  });

  it("rejects a duplicated category (one line item per category)", () => {
    const tampered = tamperTransport(encodeDefaultResult(), (p) => {
      const li = p.li as unknown[];
      li.push(structuredClone(li[0]));
    });
    const verified = recomputeAndVerifyClaimedResult(claimedFrom(tampered));
    expect(verified.ok).toBe(false);
    if (verified.ok) return;
    expect(verified.reason).toBe("invalid_input");
  });

  it("rejects a percentage rule with no rate as invalid input", () => {
    const tampered = tamperTransport(encodeDefaultResult(), (p) => {
      const li = p.li as Array<Record<string, unknown>>;
      delete li[0]!.rbp;
    });
    const verified = recomputeAndVerifyClaimedResult(claimedFrom(tampered));
    expect(verified.ok).toBe(false);
    if (verified.ok) return;
    expect(verified.reason).toBe("invalid_input");
  });

  it("rejects an unknown formula key as invalid input", () => {
    const tampered = tamperTransport(encodeDefaultResult(), (p) => {
      const li = p.li as Array<Record<string, unknown>>;
      li[0]!.rt = "m";
      delete li[0]!.rbp;
      li[0]!.fk = "eval_this";
    });
    const verified = recomputeAndVerifyClaimedResult(claimedFrom(tampered));
    expect(verified.ok).toBe(false);
    if (verified.ok) return;
    expect(verified.reason).toBe("invalid_input");
  });

  it("does not carry stray values from a rule's inactive columns into the persisted result", () => {
    const withStray = tamperTransport(encodeDefaultResult(), (p) => {
      const li = p.li as Array<Record<string, unknown>>;
      li[0]!.fam = 999_999; // a percentage rule claiming a stray fixed amount
      li[0]!.fk = "tiered_by_revenue_band";
    });
    const verified = recomputeAndVerifyClaimedResult(claimedFrom(withStray));
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    const first = verified.result.lineItems[0]!;
    expect(first.ruleType).toBe("percentage");
    expect(first.fixedAmountMinor).toBeNull();
    expect(first.formulaKey).toBeNull();
  });

  it("accepts an all-disabled calculation (zero line items, zero total)", () => {
    const empty = tamperTransport(encodeDefaultResult(), (p) => {
      p.li = [];
      p.t = 0;
      p.n = p.r;
    });
    const verified = recomputeAndVerifyClaimedResult(claimedFrom(empty));
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.result.lineItems).toHaveLength(0);
    expect(verified.result.totalExpensesMinor).toBe(0);
  });
});
