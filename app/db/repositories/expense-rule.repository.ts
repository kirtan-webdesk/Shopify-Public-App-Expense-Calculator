import type { Transaction } from "sequelize";
import { ExpenseRuleModel } from "~/db/models/expense-rule.model";
import type { ShopContext } from "~/db/repositories/shop-context";
import type { RuleType } from "~/domain/rule-types";

// expense-rule.repository — stands up the ADR-0003 pattern for a table that
// M2 (Configuration milestone) owns the UI/validation for. Every function
// takes ShopContext first; no query here (or anywhere else in the app)
// constructs a shop_id predicate from anything other than that context.

export async function listExpenseRulesForShop(ctx: ShopContext) {
  return ExpenseRuleModel.findAll({
    where: { shopId: ctx.shopId },
    order: [["categoryKey", "ASC"]],
  });
}

export async function findExpenseRule(ctx: ShopContext, categoryKey: string) {
  return ExpenseRuleModel.findOne({
    where: { shopId: ctx.shopId, categoryKey },
  });
}

export interface UpsertExpenseRuleInput {
  readonly categoryKey: string;
  readonly ruleType: RuleType;
  readonly rateBasisPoints: number | null;
  readonly fixedAmountMinor: number | null;
  readonly formulaKey: string | null;
  readonly enabled: boolean;
}

/**
 * Seeds the given rules for this shop WITHOUT ever overwriting or failing on
 * a row that already exists: one multi-row `INSERT ... ON CONFLICT DO NOTHING`
 * (Sequelize `bulkCreate({ ignoreDuplicates: true })`) against the real
 * `uq_expense_rule_shop_category` unique constraint.
 *
 * Why this and not `replaceExpenseRulesForShop` for first-load seeding: two
 * first-ever requests for a fresh shop on DIFFERENT serverless instances can
 * both read "no rules yet" and then both insert the same
 * (shop_id, category_key) rows. With a plain INSERT the loser hit the unique
 * constraint, its transaction threw, and the merchant saw an error on first
 * load; with find-then-update it would have overwritten anything the winner
 * (or the merchant) had already customised. INSERT-IGNORE keeps whichever
 * rows got there first, untouched, and no unique violation can escape.
 * The caller re-reads afterwards to get the rows that actually exist.
 *
 * Transactions: a single INSERT statement is atomic on its own, so no
 * transaction is opened here (nothing to thread, and nothing that could
 * acquire a second connection under pool.max:1). If a caller ever needs this
 * inside a larger unit of work, pass its `transaction` and this uses it.
 */
export async function seedExpenseRulesIfMissing(
  ctx: ShopContext,
  inputs: readonly UpsertExpenseRuleInput[],
  transaction?: Transaction,
): Promise<void> {
  if (inputs.length === 0) return;
  await ExpenseRuleModel.bulkCreate(
    inputs.map((input) => ({
      shopId: ctx.shopId,
      categoryKey: input.categoryKey,
      ruleType: input.ruleType,
      rateBasisPoints: input.rateBasisPoints,
      fixedAmountMinor: input.fixedAmountMinor === null ? null : String(input.fixedAmountMinor),
      formulaKey: input.formulaKey,
      enabled: input.enabled,
    })),
    { ignoreDuplicates: true, ...(transaction ? { transaction } : {}) },
  );
}

/**
 * Saves every category's rule for this shop as ONE conflict-safe statement —
 * the calculator's "Save" action persists all rows together, so a partial save
 * (e.g. rows 1-6 written, row 7 not) can never leave the shop's configuration
 * half-updated.
 *
 * It is a single multi-row `INSERT ... ON CONFLICT (shop_id, category_key) DO
 * UPDATE` against the real `uq_expense_rule_shop_category` constraint, not a
 * find-then-create/update loop. Why: the first Save for a shop on TWO
 * instances/tabs at once (both see "no row yet", both create) hit that unique
 * constraint in the loser, whose request then failed with an unhandled error.
 * With ON CONFLICT DO UPDATE the loser simply updates the row the winner just
 * inserted (last write wins per row, which is the intended "one configured
 * rule per category" semantics), and no unique violation can escape.
 *
 * Connections: one statement is atomic on its own, so no transaction is opened
 * here — nothing that could take a second connection under `pool.max: 1`
 * (app/db/sequelize.ts). If a caller ever needs this inside a larger unit of
 * work it can pass its own `transaction`. Rows are written in a fixed
 * (category_key) order so two concurrent saves lock rows in the same order
 * and cannot deadlock each other.
 *
 * Every value column is written on every row (the inactive rule types as
 * NULL), so an existing row that switches rule type still satisfies
 * `chk_expense_rule_value_shape`. `created_at` is only set on insert.
 */
export async function replaceExpenseRulesForShop(
  ctx: ShopContext,
  inputs: readonly UpsertExpenseRuleInput[],
  transaction?: Transaction,
): Promise<void> {
  if (inputs.length === 0) return;
  const ordered = [...inputs].sort((a, b) => (a.categoryKey < b.categoryKey ? -1 : a.categoryKey > b.categoryKey ? 1 : 0));
  await ExpenseRuleModel.bulkCreate(
    ordered.map((input) => ({
      shopId: ctx.shopId,
      categoryKey: input.categoryKey,
      ruleType: input.ruleType,
      rateBasisPoints: input.rateBasisPoints,
      fixedAmountMinor: input.fixedAmountMinor === null ? null : String(input.fixedAmountMinor),
      formulaKey: input.formulaKey,
      enabled: input.enabled,
    })),
    {
      conflictAttributes: ["shopId", "categoryKey"],
      updateOnDuplicate: ["ruleType", "rateBasisPoints", "fixedAmountMinor", "formulaKey", "enabled", "updatedAt"],
      ...(transaction ? { transaction } : {}),
    },
  );
}
