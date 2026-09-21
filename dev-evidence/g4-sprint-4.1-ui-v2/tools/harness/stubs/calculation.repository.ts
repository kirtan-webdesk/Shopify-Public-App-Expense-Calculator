// In-memory stand-in for the calculation repository (harness only). The REAL history/rules/calculation
// SERVICES run on top of it; only Sequelize is replaced. It mimics the tenant-scoped, append-only behaviour.
type Calc = { id: string; shopId: string; revenueMinor: string; currencyCode: string; totalExpensesMinor: string; netAmountMinor: string; engineVersion: string; createdAt: Date };
type Line = { calculationId: string; shopId: string; categoryKey: string; categoryLabelAtSave: string; ruleTypeAtSave: string; rateBasisPointsAtSave: number | null; fixedAmountMinorAtSave: string | null; formulaKeyAtSave: string | null; computedAmountMinor: string; sortOrder: number };
const calcs: Calc[] = [];
const lines: Line[] = [];
(globalThis as any).__calcs = calcs;
export async function countCalculationsForShop(ctx: any) { return calcs.filter((c) => c.shopId === ctx.shopId).length; }
export async function listCalculationsForShop(ctx: any, limit = 20, offset = 0) {
  return calcs.filter((c) => c.shopId === ctx.shopId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1)).slice(offset, offset + limit);
}
export async function findCalculationWithLineItems(ctx: any, id: string) {
  const calculation = calcs.find((c) => c.shopId === ctx.shopId && c.id === id);
  if (!calculation) return null;
  return { calculation, lineItems: lines.filter((l) => l.calculationId === id).sort((a, b) => a.sortOrder - b.sortOrder) };
}
export async function insertCalculationSnapshot(ctx: any, result: any) {
  const id = crypto.randomUUID();
  const createdAt = new Date(((globalThis as any).__now ?? Date.now()) + calcs.length * 60000);
  calcs.push({ id, shopId: ctx.shopId, revenueMinor: String(result.revenueMinor), currencyCode: result.currencyCode, totalExpensesMinor: String(result.totalExpensesMinor), netAmountMinor: String(result.netAmountMinor), engineVersion: result.engineVersion, createdAt });
  for (const li of result.lineItems) lines.push({ calculationId: id, shopId: ctx.shopId, categoryKey: li.categoryKey, categoryLabelAtSave: li.categoryLabel, ruleTypeAtSave: li.ruleType, rateBasisPointsAtSave: li.rateBasisPoints, fixedAmountMinorAtSave: li.fixedAmountMinor === null ? null : String(li.fixedAmountMinor), formulaKeyAtSave: li.formulaKey, computedAmountMinor: String(li.computedAmountMinor), sortOrder: li.sortOrder });
  return { id, createdAt };
}
