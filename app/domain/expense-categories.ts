// The 10 predefined expense categories (spec.md D5). A code constant, not a
// database table — decided and reasoned at G-Schema
// (decisions/data-model.md §2, "Option B — a code constant (recommended)").
//
// `category_key` is guaranteed stable BY CONSTRUCTION: no id to renumber, no
// seed migration, no environment drift. The DB CHECK constraints on
// `expense_rule.category_key` / `calculation_line_item.category_key` in
// db/migrations/20260918120000-initial-schema.cjs are the runtime backstop —
// if this list ever changes, that CHECK constraint is the reminder that it's
// a migration, not a config edit (A4 — merchants cannot create categories).

export interface ExpenseCategoryDefinition {
  readonly key: string;
  readonly label: string;
  readonly sortOrder: number;
}

export const EXPENSE_CATEGORIES = [
  { key: "cost_of_goods", label: "Cost of Goods", sortOrder: 0 },
  { key: "marketing", label: "Marketing", sortOrder: 1 },
  { key: "platform_fees", label: "Platform Fees", sortOrder: 2 },
  { key: "payment_processing", label: "Payment Processing", sortOrder: 3 },
  { key: "shipping", label: "Shipping", sortOrder: 4 },
  { key: "apps_software", label: "Apps/Software", sortOrder: 5 },
  { key: "payroll", label: "Payroll", sortOrder: 6 },
  { key: "overhead", label: "Overhead", sortOrder: 7 },
  { key: "taxes", label: "Taxes", sortOrder: 8 },
  { key: "misc", label: "Misc", sortOrder: 9 },
] as const satisfies readonly ExpenseCategoryDefinition[];

export type ExpenseCategoryKey = (typeof EXPENSE_CATEGORIES)[number]["key"];

const CATEGORY_KEY_SET: ReadonlySet<string> = new Set(
  EXPENSE_CATEGORIES.map((c) => c.key),
);

export function isExpenseCategoryKey(
  value: string,
): value is ExpenseCategoryKey {
  return CATEGORY_KEY_SET.has(value);
}

export function getExpenseCategory(
  key: ExpenseCategoryKey,
): ExpenseCategoryDefinition {
  const found = EXPENSE_CATEGORIES.find((c) => c.key === key);
  if (!found) {
    throw new Error(`Unknown expense category key: ${key}`);
  }
  return found;
}
