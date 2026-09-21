// In-memory stand-in for the repository. replaceExpenseRulesForShop emulates the
// real DB CHECK chk_expense_rule_value_shape: a NULL in the active rule type's
// value column THROWS (the unhandled 500 the fix prevents), all-or-nothing.
type Row = { categoryKey: string; ruleType: string; rateBasisPoints: number | null; fixedAmountMinor: string | null; formulaKey: string | null; enabled: boolean };
const store = new Map<string, Row>();
(globalThis as any).__ruleStore = store;
export async function listExpenseRulesForShop(_ctx: unknown) {
  return [...store.values()].sort((a, b) => (a.categoryKey < b.categoryKey ? -1 : 1));
}
export async function findExpenseRule() { return null; }
export async function seedExpenseRulesIfMissing(_ctx: unknown, inputs: any[]) {
  for (const i of inputs) if (!store.has(i.categoryKey)) store.set(i.categoryKey, { ...i, fixedAmountMinor: i.fixedAmountMinor === null ? null : String(i.fixedAmountMinor) });
}
export async function replaceExpenseRulesForShop(_ctx: unknown, inputs: any[]) {
  for (const i of inputs) {
    const ok = (i.ruleType === "percentage" && i.rateBasisPoints !== null) || (i.ruleType === "fixed" && i.fixedAmountMinor !== null) || (i.ruleType === "formula" && i.formulaKey !== null);
    if (!ok) throw new Error('new row for relation "expense_rule" violates check constraint "chk_expense_rule_value_shape"');
  }
  for (const i of inputs) store.set(i.categoryKey, { ...i, fixedAmountMinor: i.fixedAmountMinor === null ? null : String(i.fixedAmountMinor) });
  (globalThis as any).__saveCount = ((globalThis as any).__saveCount ?? 0) + 1;
}
