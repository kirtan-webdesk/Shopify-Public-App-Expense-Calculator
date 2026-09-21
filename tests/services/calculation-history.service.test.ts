import { describe, expect, it, vi } from "vitest";

// The service module imports the calculation repository, which imports the
// Sequelize connection (and throws without DATABASE_URL). This file tests
// only the service's pure functions, so the repository is replaced with a
// stub BEFORE the service is imported — no database is touched here. The
// DB-backed behaviour (tenancy, immutability, atomicity, pagination) is
// covered by tests/db/calculation-history.db.test.ts.
vi.mock("~/db/repositories/calculation.repository", () => ({
  countCalculationsForShop: vi.fn(),
  findCalculationWithLineItems: vi.fn(),
  insertCalculationSnapshot: vi.fn(),
  listCalculationsForShop: vi.fn(),
}));

import {
  buildDuplicatePrefill,
  getDuplicatePrefill,
  getSavedCalculation,
  HISTORY_PAGE_SIZE,
  parsePageParam,
  saveCalculationFromTransport,
  type SavedCalculationView,
} from "~/services/calculation-history.service";
import * as repository from "~/db/repositories/calculation.repository";
import { buildDefaultResult, encodeDefaultResult, tamperTransport } from "../helpers/calc-fixtures";

const ctx = { shopId: "00000000-0000-4000-8000-000000000001", shopDomain: "a.myshopify.com" };

describe("parsePageParam", () => {
  it("returns a positive integer page and defaults everything else to 1", () => {
    expect(parsePageParam("3")).toBe(3);
    expect(parsePageParam("1")).toBe(1);
    expect(parsePageParam(null)).toBe(1);
    expect(parsePageParam("")).toBe(1);
    expect(parsePageParam("0")).toBe(1);
    expect(parsePageParam("-2")).toBe(1);
    expect(parsePageParam("2.5")).toBe(1);
    expect(parsePageParam("abc")).toBe(1);
    expect(parsePageParam("1e3")).toBe(1);
    expect(parsePageParam("9999999999999")).toBe(1);
  });

  it("uses a page size of 20", () => {
    expect(HISTORY_PAGE_SIZE).toBe(20);
  });
});

describe("saveCalculationFromTransport (no database — repository stubbed)", () => {
  it("persists the engine's recomputed result for an honest payload", async () => {
    vi.mocked(repository.insertCalculationSnapshot).mockReset();
    vi.mocked(repository.insertCalculationSnapshot).mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      createdAt: new Date(),
    });

    const outcome = await saveCalculationFromTransport(ctx, encodeDefaultResult());
    expect(outcome).toEqual({ ok: true, id: "11111111-1111-4111-8111-111111111111" });

    expect(repository.insertCalculationSnapshot).toHaveBeenCalledTimes(1);
    const [calledCtx, calledResult] = vi.mocked(repository.insertCalculationSnapshot).mock.calls[0]!;
    expect(calledCtx).toBe(ctx);
    expect(calledResult.totalExpensesMinor).toBe(buildDefaultResult().totalExpensesMinor);
  });

  it("never reaches the repository for a tampered, malformed, empty, or oversized payload", async () => {
    vi.mocked(repository.insertCalculationSnapshot).mockReset();

    const tampered = tamperTransport(encodeDefaultResult(), (p) => {
      (p.li as Array<{ amt: number }>)[0]!.amt += 5;
    });
    for (const bad of [tampered, "", "not-base64-json", "A".repeat(20_000)]) {
      const outcome = await saveCalculationFromTransport(ctx, bad);
      expect(outcome.ok).toBe(false);
    }
    expect(repository.insertCalculationSnapshot).not.toHaveBeenCalled();
  });
});

describe("getSavedCalculation", () => {
  it("returns null for a malformed id without querying at all", async () => {
    vi.mocked(repository.findCalculationWithLineItems).mockReset();
    expect(await getSavedCalculation(ctx, "not-a-uuid")).toBeNull();
    expect(await getSavedCalculation(ctx, "")).toBeNull();
    expect(repository.findCalculationWithLineItems).not.toHaveBeenCalled();
  });

  it("returns null when the repository finds nothing (nonexistent or other shop)", async () => {
    vi.mocked(repository.findCalculationWithLineItems).mockReset();
    vi.mocked(repository.findCalculationWithLineItems).mockResolvedValue(null);
    expect(await getSavedCalculation(ctx, "3f2b8c1e-9a4d-4e0b-8f6a-1c2d3e4f5a6b")).toBeNull();
    expect(repository.findCalculationWithLineItems).toHaveBeenCalledTimes(1);
  });
});

describe("buildDuplicatePrefill (G2-revision v2, J6: revenue + currency ONLY)", () => {
  function savedWith(result = buildDefaultResult(5_000_000, "CAD")): SavedCalculationView {
    return {
      id: "3f2b8c1e-9a4d-4e0b-8f6a-1c2d3e4f5a6b",
      savedAtIso: "2026-09-17T09:14:00.000Z",
      engineVersion: result.engineVersion,
      result,
    };
  }

  it("carries the id, save time, revenue and currency from the snapshot", () => {
    const prefill = buildDuplicatePrefill(savedWith());
    expect(prefill).toEqual({
      id: "3f2b8c1e-9a4d-4e0b-8f6a-1c2d3e4f5a6b",
      savedAtIso: "2026-09-17T09:14:00.000Z",
      revenueMinor: 5_000_000,
      currencyCode: "CAD",
    });
  });

  it("carries NO rule value from the snapshot (no rules, rates, amounts or formulas leave it)", () => {
    const prefill = buildDuplicatePrefill(savedWith()) as unknown as Record<string, unknown>;
    expect(Object.keys(prefill).sort()).toEqual(["currencyCode", "id", "revenueMinor", "savedAtIso"]);
    const serialised = JSON.stringify(prefill);
    expect(serialised).not.toMatch(/rateBasisPoints|fixedAmountMinor|formulaKey|ruleType|lineItems/);
  });

  it("getDuplicatePrefill is tenant-scoped and never touches the expense-rule repository", async () => {
    vi.mocked(repository.findCalculationWithLineItems).mockReset();
    vi.mocked(repository.findCalculationWithLineItems).mockResolvedValue(null);
    expect(await getDuplicatePrefill(ctx, "3f2b8c1e-9a4d-4e0b-8f6a-1c2d3e4f5a6b")).toBeNull();
    expect(await getDuplicatePrefill(ctx, "not-a-uuid")).toBeNull();
    expect(repository.findCalculationWithLineItems).toHaveBeenCalledTimes(1);
    expect(vi.mocked(repository.findCalculationWithLineItems).mock.calls[0]![0]).toBe(ctx);
  });
});
