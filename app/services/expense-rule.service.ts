// expense-rule.service — M2 business logic. Routes/actions stay thin (parse
// request, call service, respond); the service owns default-seeding,
// validation orchestration, and the shape translation between DB rows and
// domain types. Only repositories (app/db/repositories/*) touch Sequelize
// models — this file imports the repository, never the model (ADR-0003,
// enforced by eslint no-restricted-imports + tests/architecture/
// repository-boundary.test.ts).

import { EXPENSE_CATEGORIES, type ExpenseCategoryKey } from "~/domain/expense-categories";
import { DEFAULT_EXPENSE_RULES } from "~/domain/expense-rule-defaults";
import {
  hasAnyFieldError,
  validateExpenseRuleRow,
  validateCurrencyCode,
  validateRevenueMinor,
  type ExpenseRuleFieldErrors,
  type ExpenseRuleFormInput,
} from "~/domain/expense-rule-validation";
import type { RuleType } from "~/domain/rule-types";
import type { ExpenseRuleModel } from "~/db/models/expense-rule.model";
import {
  listExpenseRulesForShop,
  replaceExpenseRulesForShop,
  type UpsertExpenseRuleInput,
} from "~/db/repositories/expense-rule.repository";
import type { ShopContext } from "~/db/repositories/shop-context";

export interface ExpenseRuleView {
  readonly categoryKey: ExpenseCategoryKey;
  readonly categoryLabel: string;
  readonly sortOrder: number;
  readonly enabled: boolean;
  readonly ruleType: RuleType;
  readonly rateBasisPoints: number | null;
  readonly fixedAmountMinor: number | null;
  readonly formulaKey: string | null;
}

function toView(row: ExpenseRuleModel): ExpenseRuleView {
  const category = EXPENSE_CATEGORIES.find((c) => c.key === row.categoryKey);
  return {
    categoryKey: row.categoryKey as ExpenseCategoryKey,
    categoryLabel: category?.label ?? row.categoryKey,
    sortOrder: category?.sortOrder ?? 999,
    enabled: row.enabled,
    ruleType: row.ruleType,
    rateBasisPoints: row.rateBasisPoints,
    fixedAmountMinor: row.fixedAmountMinor === null ? null : Number(row.fixedAmountMinor),
    formulaKey: row.formulaKey,
  };
}

function defaultsAsView(): readonly ExpenseRuleView[] {
  return DEFAULT_EXPENSE_RULES.map((d) => {
    const category = EXPENSE_CATEGORIES.find((c) => c.key === d.categoryKey)!;
    return {
      categoryKey: d.categoryKey,
      categoryLabel: category.label,
      sortOrder: category.sortOrder,
      enabled: true,
      ruleType: d.ruleType,
      rateBasisPoints: d.rateBasisPoints,
      fixedAmountMinor: d.fixedAmountMinor,
      formulaKey: d.formulaKey,
    };
  });
}

/**
 * Returns this shop's configured expense rules, one per fixed category, in
 * category sort order. If the shop has NO rules configured yet, seeds the
 * PLACEHOLDER defaults (app/domain/expense-rule-defaults.ts) once and
 * returns the newly-created rows — this is the "seeded defaults load on
 * install" behaviour from S2.1, implemented lazily on first calculator load
 * rather than hooked into the install webhook path (a deliberate scope
 * decision for this sprint — see the developer handoff for the reasoning).
 */
export async function getOrSeedExpenseRules(ctx: ShopContext): Promise<readonly ExpenseRuleView[]> {
  const existing = await listExpenseRulesForShop(ctx);
  if (existing.length > 0) {
    const byCategory = new Map(existing.map((r) => [r.categoryKey, toView(r)]));
    // A shop may have a partial rule set (e.g. a category added to
    // EXPENSE_CATEGORIES after this shop's rules were seeded) — fill any
    // gap with that category's placeholder default so the UI always shows
    // exactly EXPENSE_CATEGORIES.length rows, never fewer.
    return EXPENSE_CATEGORIES.map((c) => byCategory.get(c.key) ?? defaultsAsView().find((d) => d.categoryKey === c.key)!);
  }

  const seedInputs: UpsertExpenseRuleInput[] = DEFAULT_EXPENSE_RULES.map((d) => ({
    categoryKey: d.categoryKey,
    ruleType: d.ruleType,
    rateBasisPoints: d.rateBasisPoints,
    fixedAmountMinor: d.fixedAmountMinor,
    formulaKey: d.formulaKey,
    enabled: true,
  }));
  await replaceExpenseRulesForShop(ctx, seedInputs);
  const seeded = await listExpenseRulesForShop(ctx);
  return seeded.map(toView).sort((a, b) => a.sortOrder - b.sortOrder);
}

export interface SaveExpenseRulesResult {
  readonly ok: boolean;
  readonly fieldErrors: Readonly<Record<string, ExpenseRuleFieldErrors>>;
}

/**
 * Validates and persists a full set of rule edits (one row per category)
 * server-side. ALWAYS re-validates regardless of what client-side
 * validation already showed (S2.2: "no write path bypasses server
 * validation") — the action calling this must never skip straight to
 * replaceExpenseRulesForShop on the strength of a client-side check alone.
 */
export async function saveExpenseRules(
  ctx: ShopContext,
  rows: readonly ExpenseRuleFormInput[],
): Promise<SaveExpenseRulesResult> {
  const fieldErrors: Record<string, ExpenseRuleFieldErrors> = {};
  for (const row of rows) {
    const errors = validateExpenseRuleRow(row);
    if (hasAnyFieldError(errors)) {
      fieldErrors[row.categoryKey] = errors;
    }
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  const inputs: UpsertExpenseRuleInput[] = rows.map((row) => ({
    categoryKey: row.categoryKey,
    ruleType: row.ruleType as RuleType,
    rateBasisPoints: row.ruleType === "percentage" ? row.rateBasisPoints : null,
    fixedAmountMinor: row.ruleType === "fixed" ? row.fixedAmountMinor : null,
    formulaKey: row.ruleType === "formula" ? row.formulaKey : null,
    enabled: row.enabled,
  }));
  await replaceExpenseRulesForShop(ctx, inputs);
  return { ok: true, fieldErrors: {} };
}

export { validateRevenueMinor, validateCurrencyCode };
