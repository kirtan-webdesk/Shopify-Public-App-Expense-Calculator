import { ExpenseRuleModel } from "~/db/models/expense-rule.model";
import type { ShopContext } from "~/db/repositories/shop-context";

// expense-rule.repository — stands up the ADR-0003 pattern for a table that
// M2 (Configuration milestone) owns the UI/validation for. Every function
// takes ShopContext first; no query here (or anywhere else in the app)
// constructs a shop_id predicate from anything other than that context.
//
// M1 scope note: this repository is not yet called by any route — the
// configuration UI (D4, D6) is M2. It exists now so the tenancy choke point
// is established for every table from day one, per the G3 task's explicit
// instruction, not merely for the tables M1's own webhooks touch.

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
