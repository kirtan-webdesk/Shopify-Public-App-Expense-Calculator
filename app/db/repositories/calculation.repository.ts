import { CalculationModel } from "~/db/models/calculation.model";
import { CalculationLineItemModel } from "~/db/models/calculation-line-item.model";
import type { ShopContext } from "~/db/repositories/shop-context";
import type { EngineResult } from "~/domain/expense-engine";
import { sequelize } from "~/db/sequelize";

// calculation.repository — the ADR-0003 pattern for the append-only history
// tables (D10 save, D11 history/detail).
//
// Deliberately exposes NO update() and NO delete() for either model:
// calculations are append-only by design (data-model.md §4.3/§4.4), enforced
// here at the repository boundary AND at the database layer (BEFORE UPDATE
// trigger). Deletion happens only through the shop/redact cascade
// (shop.repository.ts hardDeleteShop), never through a normal-operation path.
//
// FT-14b: nothing in this file imports or references the expense_rule model.
// A saved calculation's line items carry their own by-value copy of the rule
// applied (typed *_at_save columns), so the history read path has no join
// path back to live configuration to accidentally take.

const MAX_PAGE_SIZE = 100;

export async function countCalculationsForShop(ctx: ShopContext): Promise<number> {
  return CalculationModel.count({ where: { shopId: ctx.shopId } });
}

/**
 * Newest first. `id` is a deterministic tie-breaker so two rows sharing a
 * created_at can never swap pages between requests.
 */
export async function listCalculationsForShop(
  ctx: ShopContext,
  limit = 20,
  offset = 0,
) {
  return CalculationModel.findAll({
    where: { shopId: ctx.shopId },
    order: [
      ["createdAt", "DESC"],
      ["id", "DESC"],
    ],
    limit: Math.min(Math.max(1, Math.trunc(limit)), MAX_PAGE_SIZE),
    offset: Math.max(0, Math.trunc(offset)),
  });
}

/**
 * Tenant-scoped by-id read. Both predicates (`shop_id` AND `id`) are applied
 * together: another shop's id and a nonexistent id are indistinguishable —
 * both return null — so the caller cannot leak existence.
 */
export async function findCalculationWithLineItems(
  ctx: ShopContext,
  calculationId: string,
) {
  const calculation = await CalculationModel.findOne({
    where: { shopId: ctx.shopId, id: calculationId },
  });
  if (!calculation) return null;

  const lineItems = await CalculationLineItemModel.findAll({
    where: { shopId: ctx.shopId, calculationId },
    order: [["sortOrder", "ASC"]],
  });

  return { calculation, lineItems };
}

export interface InsertedCalculation {
  readonly id: string;
  readonly createdAt: Date;
}

/**
 * Persists a calculation and its per-category line items as ONE atomic unit:
 * one `calculation` row plus one `calculation_line_item` row per applied
 * category, inside a single transaction. Either every row lands or none do.
 *
 * Snapshot BY VALUE: each line item copies the rule as applied (rule type,
 * rate / fixed amount / formula key), the category's label and sort order at
 * save time, and the computed amount into its own typed columns, plus a JSONB
 * audit copy. There is no foreign key and no read of `expense_rule` anywhere
 * here — editing live rules afterwards cannot change these rows (D11).
 *
 * POOL SAFETY (ADR-0010, pool.max: 1): every statement inside the callback
 * passes `{ transaction }`. A statement issued without it would acquire a
 * second pooled connection while this transaction holds the only one and
 * block on `acquire` until timeout (the exact deadlock class found twice in
 * an earlier round). There is deliberately no other query in this function
 * body — the ShopContext was resolved before it was called.
 *
 * The DEFERRED reconciliation trigger (sum(line items) = total_expenses_minor)
 * is checked by Postgres at commit; if it (or any CHECK constraint) fails,
 * the commit/statement throws, the managed transaction rolls back, and zero
 * rows remain. The caller (calculation-history.service.ts) has already
 * recomputed and verified the figures, so the trigger is a backstop rather
 * than the only check.
 */
export async function insertCalculationSnapshot(
  ctx: ShopContext,
  result: EngineResult,
): Promise<InsertedCalculation> {
  return sequelize.transaction(async (transaction) => {
    const calculation = await CalculationModel.create(
      {
        shopId: ctx.shopId,
        revenueMinor: String(result.revenueMinor),
        currencyCode: result.currencyCode,
        totalExpensesMinor: String(result.totalExpensesMinor),
        netAmountMinor: String(result.netAmountMinor),
        engineVersion: result.engineVersion,
      },
      { transaction },
    );

    if (result.lineItems.length > 0) {
      await CalculationLineItemModel.bulkCreate(
        result.lineItems.map((li) => ({
          calculationId: calculation.id,
          shopId: ctx.shopId,
          categoryKey: li.categoryKey,
          categoryLabelAtSave: li.categoryLabel,
          ruleTypeAtSave: li.ruleType,
          rateBasisPointsAtSave: li.rateBasisPoints,
          fixedAmountMinorAtSave: li.fixedAmountMinor === null ? null : String(li.fixedAmountMinor),
          formulaKeyAtSave: li.formulaKey,
          ruleSnapshot: {
            categoryKey: li.categoryKey,
            enabled: true,
            ruleType: li.ruleType,
            rateBasisPoints: li.rateBasisPoints,
            fixedAmountMinor: li.fixedAmountMinor,
            formulaKey: li.formulaKey,
          },
          computedAmountMinor: String(li.computedAmountMinor),
          sortOrder: li.sortOrder,
          createdAt: calculation.createdAt,
        })),
        { transaction },
      );
    }

    return { id: calculation.id, createdAt: calculation.createdAt };
  });
}
