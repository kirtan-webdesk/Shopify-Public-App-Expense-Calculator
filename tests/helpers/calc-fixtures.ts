import { DEFAULT_EXPENSE_RULES } from "~/domain/expense-rule-defaults";
import { calculateExpenses, type EngineResult } from "~/domain/expense-engine";
import { encodeCalculationResult } from "~/domain/calculation-transport";

// Shared fixtures for the M4 tests: a real engine result built from the
// placeholder default rules, and its transport encoding (what the Results
// page hands the Save action).

export function buildDefaultResult(revenueMinor = 5_000_000, currencyCode = "USD"): EngineResult {
  return calculateExpenses({
    revenueMinor,
    currencyCode,
    rules: DEFAULT_EXPENSE_RULES.map((r) => ({
      categoryKey: r.categoryKey,
      enabled: true,
      ruleType: r.ruleType,
      rateBasisPoints: r.rateBasisPoints,
      fixedAmountMinor: r.fixedAmountMinor,
      formulaKey: r.formulaKey,
    })),
  });
}

export function encodeDefaultResult(revenueMinor = 5_000_000, currencyCode = "USD"): string {
  return encodeCalculationResult(buildDefaultResult(revenueMinor, currencyCode));
}

/** Re-encodes a transport string after applying `mutate` to its decoded JSON
 * payload — simulates a tampered `d` parameter. */
export function tamperTransport(encoded: string, mutate: (payload: Record<string, unknown>) => void): string {
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Record<string, unknown>;
  mutate(payload);
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}
