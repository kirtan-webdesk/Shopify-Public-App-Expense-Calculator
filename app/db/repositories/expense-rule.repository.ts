import type { Transaction } from "sequelize";
import { ExpenseRuleModel } from "~/db/models/expense-rule.model";
import type { ShopContext } from "~/db/repositories/shop-context";
import type { RuleType } from "~/domain/rule-types";
import { sequelize } from "~/db/sequelize";

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
 * Creates or updates the ONE rule row for (shop, category) — matches the
 * `uq_expense_rule_shop_category` unique constraint (data-model.md §4.2:
 * "one configured rule per category per shop", not a history of versions).
 * Does not use Sequelize's `upsert()` (which performs an ON CONFLICT on the
 * PRIMARY KEY, not this table's actual uniqueness constraint) — instead an
 * explicit find-then-create-or-update inside the caller's transaction, so
 * concurrent saves for the same shop serialize through the row lock rather
 * than racing on a conflict target that isn't the row's identity column.
 */
export async function upsertExpenseRule(
  ctx: ShopContext,
  input: UpsertExpenseRuleInput,
  transaction: Transaction,
): Promise<ExpenseRuleModel> {
  const existing = await ExpenseRuleModel.findOne({
    where: { shopId: ctx.shopId, categoryKey: input.categoryKey },
    transaction,
    lock: transaction.LOCK.UPDATE,
  });

  if (existing) {
    existing.ruleType = input.ruleType;
    existing.rateBasisPoints = input.rateBasisPoints;
    existing.fixedAmountMinor = input.fixedAmountMinor === null ? null : String(input.fixedAmountMinor);
    existing.formulaKey = input.formulaKey;
    existing.enabled = input.enabled;
    await existing.save({ transaction });
    return existing;
  }

  return ExpenseRuleModel.create(
    {
      shopId: ctx.shopId,
      categoryKey: input.categoryKey,
      ruleType: input.ruleType,
      rateBasisPoints: input.rateBasisPoints,
      fixedAmountMinor: input.fixedAmountMinor === null ? null : String(input.fixedAmountMinor),
      formulaKey: input.formulaKey,
      enabled: input.enabled,
    },
    { transaction },
  );
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
 * Replaces every category's rule for this shop in one transaction — the
 * calculator's "Save" action persists all 10 rows together rather than one
 * request per row, so a partial save (e.g. rows 1-6 written, row 7 fails
 * validation) can never leave the shop's configuration half-updated.
 */
export async function replaceExpenseRulesForShop(
  ctx: ShopContext,
  inputs: readonly UpsertExpenseRuleInput[],
): Promise<void> {
  await sequelize.transaction(async (transaction) => {
    for (const input of inputs) {
      await upsertExpenseRule(ctx, input, transaction);
    }
  });
}
