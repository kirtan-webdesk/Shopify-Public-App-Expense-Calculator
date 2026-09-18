import { sequelize } from "~/db/sequelize";
import { Transaction } from "sequelize";
import { findShopsUninstalledBefore, hardDeleteShop } from "~/db/repositories/shop.repository";
import { recordComplianceOutcome } from "~/db/repositories/compliance-audit-log.repository";
import { sessionStorageInstance } from "~/shopify.server";
import { prunedProcessedOlderThan } from "~/db/repositories/webhook-event.repository";

const SWEEPER_WINDOW_DAYS = Number(process.env.SWEEPER_WINDOW_DAYS || 45);
const WEBHOOK_EVENT_RETENTION_DAYS = Number(
  process.env.WEBHOOK_EVENT_RETENTION_DAYS || 30,
);

/**
 * 45-day safety sweeper (ADR-0008 §5). Hard-deletes any shop with
 * uninstalled_at older than the window, REGARDLESS of whether shop/redact
 * ever arrived — the failure mode this exists to close (R2: a lost/never-
 * delivered shop/redact silently retaining shop data indefinitely).
 *
 * A sweeper firing is an ALERT, not a routine event — logged loudly here;
 * wiring that log into a real alert channel is G5.5 (observability +
 * runbooks) scope, not built in this scaffold.
 */
export async function runSweeper(): Promise<void> {
  const cutoff = new Date(Date.now() - SWEEPER_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const shops = await findShopsUninstalledBefore(cutoff);

  for (const ctx of shops) {
    await sequelize.transaction(async (transaction: Transaction) => {
      // The sweeper has no "currently executing webhook_event row" to
      // exclude — unlike shop-redact.service.ts, which runs FROM a claimed
      // inbox row. Pass a value that matches no id.
      const rowCounts = await hardDeleteShop(ctx, "00000000-0000-0000-0000-000000000000", transaction);
      const sessions = await sessionStorageInstance.findSessionsByShop(ctx.shopDomain);
      await sessionStorageInstance.deleteSessions(sessions.map((s) => s.id));

      await recordComplianceOutcome(
        {
          shopDomain: ctx.shopDomain,
          webhookId: `sweeper-${ctx.shopId}-${Date.now()}`,
          topic: "shop/redact",
          outcome: "completed",
          reason: "45-day safety sweeper — shop/redact was never observed for this shop",
          deletedRowCounts: { ...rowCounts, shopify_sessions: sessions.length },
        },
        transaction,
      );
    });

    console.warn(
      `[sweeper] ALERT: shop ${ctx.shopDomain} was hard-deleted by the 45-day ` +
        "safety sweeper — this means shop/redact was never successfully " +
        "processed for it. Investigate the missed delivery (ADR-0008 R2).",
    );
  }
}

/** webhook_event retention pruning (data-model.md §4.5) — rides the same interval. */
export async function runWebhookEventPruning(): Promise<void> {
  const cutoff = new Date(
    Date.now() - WEBHOOK_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
  await prunedProcessedOlderThan(cutoff);
}
