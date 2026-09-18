import { CalculationModel } from "~/db/models/calculation.model";
import { CalculationLineItemModel } from "~/db/models/calculation-line-item.model";
import type { ShopContext } from "~/db/repositories/shop-context";

// calculation.repository — stands up the ADR-0003 pattern for the
// append-only history tables. M1 scope note: the save/history UI (D10, D11)
// is M4 — this repository is not yet called by any route. Deliberately
// exposes NO update() method for either model: calculations are append-only
// by design (data-model.md §4.3/§4.4), enforced here at the repository
// boundary AND at the database layer (BEFORE UPDATE trigger).

export async function listCalculationsForShop(
  ctx: ShopContext,
  limit = 20,
  offset = 0,
) {
  return CalculationModel.findAll({
    where: { shopId: ctx.shopId },
    order: [["createdAt", "DESC"]],
    limit,
    offset,
  });
}

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
