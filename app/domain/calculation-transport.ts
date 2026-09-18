// Transports an already-computed, NOT-YET-SAVED calculation result from the
// Calculator page's "Calculate" action to the Results page (M3 — "Calculate"
// is a live preview against current form state; M4 owns actually persisting
// a `calculation` row, which is explicitly out of scope this sprint).
//
// Why a URL-carried payload rather than server-side session state: this app
// runs on Vercel (ADR-0009) — every request can land on a different, cold
// function instance, so anything that must survive the redirect from
// POST /app/calculator to GET /app/results has to be stateless. The
// computed result is small (10 line items, a handful of fields each) and
// entirely non-sensitive (it is the merchant's own just-submitted numbers,
// already round-tripped through their own browser), so a compact,
// self-contained, base64url-encoded query parameter is the simplest correct
// mechanism — no server-side cache, no session dependency, works identically
// in dev and on serverless.
//
// This is NOT a persistence format and NOT a security boundary: it carries
// no shop identity, no auth material, and is re-validated shape-wise on
// decode (a malformed/tampered value degrades to "no calculation yet",
// never to a crash or to trusting unvalidated numbers).

import { EXPENSE_CATEGORIES, isExpenseCategoryKey } from "./expense-categories";
import type { EngineLineItem, EngineResult } from "./expense-engine";
import { isRuleType } from "./rule-types";
import { toMinorUnits } from "./money";

const RULE_TYPE_CODE = { percentage: "p", fixed: "f", formula: "m" } as const;
const CODE_TO_RULE_TYPE: Record<string, "percentage" | "fixed" | "formula"> = {
  p: "percentage",
  f: "fixed",
  m: "formula",
};

interface TransportLineItem {
  readonly k: string; // categoryKey
  readonly rt: "p" | "f" | "m";
  readonly rbp?: number;
  readonly fam?: number;
  readonly fk?: string;
  readonly amt: number;
}

interface TransportPayload {
  readonly v: 1;
  readonly ev: string;
  readonly r: number;
  readonly c: string;
  readonly t: number;
  readonly n: number;
  readonly li: readonly TransportLineItem[];
}

export function encodeCalculationResult(result: EngineResult): string {
  const payload: TransportPayload = {
    v: 1,
    ev: result.engineVersion,
    r: result.revenueMinor,
    c: result.currencyCode,
    t: result.totalExpensesMinor,
    n: result.netAmountMinor,
    li: result.lineItems.map((li) => ({
      k: li.categoryKey,
      rt: RULE_TYPE_CODE[li.ruleType],
      ...(li.rateBasisPoints !== null ? { rbp: li.rateBasisPoints } : {}),
      ...(li.fixedAmountMinor !== null ? { fam: li.fixedAmountMinor } : {}),
      ...(li.formulaKey !== null ? { fk: li.formulaKey } : {}),
      amt: li.computedAmountMinor,
    })),
  };
  const json = JSON.stringify(payload);
  return Buffer.from(json, "utf8").toString("base64url");
}

/**
 * Decodes a transport string back into an EngineResult-shaped object.
 * Returns null for anything malformed rather than throwing — the results
 * page treats null the same as "no calculation run yet" (an intentional,
 * documented UX state, not an error page).
 */
export function decodeCalculationResult(encoded: string): EngineResult | null {
  let payload: TransportPayload;
  try {
    const json = Buffer.from(encoded, "base64url").toString("utf8");
    payload = JSON.parse(json) as TransportPayload;
  } catch {
    return null;
  }

  if (!payload || payload.v !== 1 || typeof payload.ev !== "string") return null;
  if (!Number.isInteger(payload.r) || payload.r < 0) return null;
  if (typeof payload.c !== "string") return null;
  if (!Number.isInteger(payload.t) || payload.t < 0) return null;
  if (!Number.isInteger(payload.n)) return null;
  if (!Array.isArray(payload.li)) return null;

  const lineItems: EngineLineItem[] = [];
  for (const raw of payload.li) {
    if (!raw || typeof raw.k !== "string" || !isExpenseCategoryKey(raw.k)) return null;
    const ruleType = CODE_TO_RULE_TYPE[raw.rt];
    if (!ruleType || !isRuleType(ruleType)) return null;
    if (!Number.isInteger(raw.amt) || raw.amt < 0) return null;
    const category = EXPENSE_CATEGORIES.find((c) => c.key === raw.k)!;
    lineItems.push({
      categoryKey: raw.k,
      categoryLabel: category.label,
      sortOrder: category.sortOrder,
      ruleType,
      rateBasisPoints: typeof raw.rbp === "number" ? raw.rbp : null,
      fixedAmountMinor: typeof raw.fam === "number" ? raw.fam : null,
      formulaKey: typeof raw.fk === "string" ? raw.fk : null,
      computedAmountMinor: toMinorUnits(raw.amt),
    });
  }
  lineItems.sort((a, b) => a.sortOrder - b.sortOrder);

  return {
    engineVersion: payload.ev,
    revenueMinor: toMinorUnits(payload.r),
    currencyCode: payload.c,
    totalExpensesMinor: toMinorUnits(payload.t),
    netAmountMinor: toMinorUnits(payload.n),
    lineItems,
  };
}
