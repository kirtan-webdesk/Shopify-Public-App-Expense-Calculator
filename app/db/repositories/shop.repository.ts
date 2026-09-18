import { Op, type Transaction } from "sequelize";
import { ShopModel } from "~/db/models/shop.model";
import { ExpenseRuleModel } from "~/db/models/expense-rule.model";
import { CalculationModel } from "~/db/models/calculation.model";
import { CalculationLineItemModel } from "~/db/models/calculation-line-item.model";
import { WebhookEventModel } from "~/db/models/webhook-event.model";
import { createShopContext, type ShopContext } from "~/db/repositories/shop-context";

// shop.repository — the ONE exception to "every function takes a ShopContext
// as its first argument" (ADR-0003). The shop table IS the tenant root; a
// ShopContext cannot exist before a shop row does. This is the resolution
// point: everything downstream (routes, webhook handlers) gets its
// ShopContext FROM this repository, never constructs one itself.

/**
 * `transaction` (ADR-0010 fix, found live, G1.5-revision): optional, and
 * MUST be passed when this is called from inside an already-open
 * transaction/savepoint (e.g. shop-redact.service.ts, invoked from
 * claimAndProcessOne's outer transaction) — omitting it there makes
 * Sequelize acquire a SECOND connection for this standalone query while the
 * caller's transaction is still holding the pool's only connection
 * (pool.max:1, ADR-0010), which blocks on `acquire: 30000` and times out
 * ("Operation timeout"). Confirmed live: a seeded shop/redact webhook_event
 * row failed with exactly this error before this fix, despite
 * handleShopRedact already threading the transaction into hardDeleteShop
 * and recordComplianceOutcome — this call was the one remaining gap.
 * webhook-inbox.service.ts's call (no outer transaction open at that point,
 * ack-and-enqueue happens before any claim) is unaffected either way and is
 * left without a transaction argument.
 */
export async function findShopContextByDomain(
  shopDomain: string,
  transaction?: Transaction,
): Promise<ShopContext | null> {
  const shop = await ShopModel.findOne({ where: { shopDomain }, transaction });
  if (!shop) return null;
  return createShopContext(shop.id, shop.shopDomain);
}

/**
 * Called on token-exchange install. Idempotent: a reinstall of a shop that
 * still has a row (uninstalled but not yet redacted) clears uninstalled_at
 * rather than creating a duplicate (ADR-0008 step 2).
 */
export async function upsertInstalledShop(shopDomain: string): Promise<ShopContext> {
  const existing = await ShopModel.findOne({ where: { shopDomain } });
  if (existing) {
    if (existing.uninstalledAt !== null) {
      existing.uninstalledAt = null;
      await existing.save();
    }
    return createShopContext(existing.id, existing.shopDomain);
  }
  const created = await ShopModel.create({ shopDomain });
  return createShopContext(created.id, created.shopDomain);
}

/**
 * ADR-0008 step 1: app/uninstalled sets uninstalled_at and RETAINS rules +
 * history (a ~48h reinstall window). Session deletion is a separate call —
 * see app/services/compliance/app-uninstalled.service.ts — because sessions
 * are library-owned (ADR-0007) and this repository never touches
 * shopify_sessions.
 *
 * BUG-4 fix: accepts the CALLER's transaction rather than opening its own —
 * same pattern as hardDeleteShop (shop/redact). The drain worker
 * (app/workers/drain-worker.ts) calls this from inside claimAndProcessOne's
 * savepoint transaction, so if the session-deletion step that follows this
 * call throws, the savepoint rolls back and this update is undone with it —
 * no more half-committed uninstalled_at with a session-deletion failure
 * retrying forever against a shop that already looks uninstalled.
 */
export async function markShopUninstalled(
  shopDomain: string,
  transaction: Transaction,
): Promise<void> {
  await ShopModel.update(
    { uninstalledAt: new Date() },
    { where: { shopDomain }, transaction },
  );
}

/**
 * ADR-0008 §5: shops past the sweeper window, for the 45-day safety sweep.
 *
 * `limit` (ADR-0009 D3): bounds the page size so a large backlog is
 * processed across multiple cron ticks rather than one unbounded query/loop.
 * Ordered oldest-uninstalled-first, same "oldest-first" convention the
 * webhook_event drain query uses, so the longest-overdue shops are always
 * the ones a bounded page picks up first.
 */
export async function findShopsUninstalledBefore(
  cutoff: Date,
  limit?: number,
): Promise<ShopContext[]> {
  const shops = await ShopModel.findAll({
    where: { uninstalledAt: { [Op.ne]: null, [Op.lt]: cutoff } },
    order: [["uninstalledAt", "ASC"]],
    limit,
  });
  return shops.map((s) => createShopContext(s.id, s.shopDomain));
}

export interface DeletedRowCounts {
  readonly webhook_event: number;
  readonly calculation_line_item: number;
  readonly calculation: number;
  readonly expense_rule: number;
  readonly shop: number;
}

/**
 * shop/redact deletion topology (data-model.md §5). Hard-deletes every row
 * belonging to the shop, in dependency order, EXCLUDING the currently-
 * executing webhook_event row (ordering note, ADR-0002/§5 — that row is
 * marked processed_at by the caller after this transaction commits, not
 * deleted mid-transaction). Row counts are captured and returned so the
 * caller can write the compliance_audit_log row with asserted counts rather
 * than trusting the ON DELETE CASCADE silently (constraint #11).
 *
 * Session-row deletion is NOT done here — sessions are library-owned
 * (ADR-0007) and are deleted by the caller via the sessionStorage API, with
 * its own count folded into the same audit record.
 *
 * excludeWebhookEventId: the webhook_event.id of the delivery currently
 * being processed (so the redact handler doesn't delete the row it is
 * executing from mid-transaction — see ADR-0002's own consequence).
 */
// Accepts the CALLER's transaction rather than opening its own. The drain
// worker (app/workers/drain-worker.ts) claims the redact webhook_event row
// via claimAndProcessOne, which holds one transaction for the whole claim +
// handle + stamp cycle (ADR-0002) — the deletion below runs inside that same
// transaction so the processed_at stamp and the deletion are atomic.
export async function hardDeleteShop(
  ctx: ShopContext,
  excludeWebhookEventId: string,
  transaction: Transaction,
): Promise<DeletedRowCounts> {
  const cliCount = await CalculationLineItemModel.destroy({
    where: { shopId: ctx.shopId },
    transaction,
  });
  const calcCount = await CalculationModel.destroy({
    where: { shopId: ctx.shopId },
    transaction,
  });
  const ruleCount = await ExpenseRuleModel.destroy({
    where: { shopId: ctx.shopId },
    transaction,
  });
  const webhookCount = await WebhookEventModel.destroy({
    where: { shopId: ctx.shopId, id: { [Op.ne]: excludeWebhookEventId } },
    transaction,
  });
  const shopCount = await ShopModel.destroy({
    where: { id: ctx.shopId },
    transaction,
  });

  return {
    webhook_event: webhookCount,
    calculation_line_item: cliCount,
    calculation: calcCount,
    expense_rule: ruleCount,
    shop: shopCount,
  };
}
