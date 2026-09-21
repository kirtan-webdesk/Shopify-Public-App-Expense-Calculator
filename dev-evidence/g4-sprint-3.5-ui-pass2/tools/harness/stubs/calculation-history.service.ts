import { decodeCalculationResult } from "~/domain/calculation-transport";
const saved: any[] = [];
(globalThis as any).__saved = saved;
export const HISTORY_PAGE_SIZE = 20;
export function parsePageParam(raw: string | null) { const n = Number(raw); return Number.isInteger(n) && n > 0 ? n : 1; }
export async function getHistoryPage(_ctx: unknown, page: number) {
  return { items: saved, page, totalPages: 1, totalCount: saved.length, pageSize: 20 };
}
export async function saveCalculationFromTransport(_ctx: unknown, encoded: string) {
  const r = decodeCalculationResult(encoded);
  if (!r) return { ok: false as const, message: "invalid" };
  const id = crypto.randomUUID();
  saved.push({ id, savedAtIso: new Date().toISOString(), revenueMinor: r.revenueMinor, totalExpensesMinor: r.totalExpensesMinor, netAmountMinor: r.netAmountMinor, currencyCode: r.currencyCode });
  return { ok: true as const, id };
}
export async function getDuplicatePrefill(_ctx: unknown, from: string, liveRules: readonly unknown[]) {
  const cur = ({ cad: "CAD", eur: "EUR", gbp: "GBP", usd: "USD" } as Record<string, string>)[from];
  if (!cur) return null;
  return { savedAtIso: "2026-09-17T09:14:00.000Z", revenueMinor: 5_000_000, currencyCode: cur, rules: liveRules };
}
