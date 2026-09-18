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
const DEFAULT_SWEEP_LIMIT = Number(process.env.CRON_SWEEP_LIMIT || 50);

export interface SweepBudget {
  /** Page size for findShopsUninstalledBefore — ADR-0009 D3: bounded so a
   * large backlog resumes on the next tick instead of one invocation trying
   * to process everything. Defaults to CRON_SWEEP_LIMIT / 50. */
  readonly limit?: number;
  /** Wall-clock budget for the loop below. Defaults to unbounded (existing
   * behaviour) when omitted — only the cron tick (ADR-0009 D3/D4) passes a
   * real budget; the 45-day window has 30+ days of slack either way. */
  readonly budgetMs?: number;
}

export interface SweepOutcome {
  readonly consideredCount: number;
  readonly deletedCount: number;
  readonly failedCount: number;
  /** true if there is very likely more work waiting for the next tick —
   * either the budget ran out mid-page, or the page came back full (meaning
   * there may be shops beyond this page's limit). */
  readonly resumable: boolean;
}

/**
 * 45-day safety sweeper (ADR-0008 §5). Hard-deletes any shop with
 * uninstalled_at older than the window, REGARDLESS of whether shop/redact
 * ever arrived — the failure mode this exists to close (R2: a lost/never-
 * delivered shop/redact silently retaining shop data indefinitely).
 *
 * ADR-0009 D3/D4: now LIMIT- and wall-clock-budget-bounded so a large
 * backlog resumes on the next cron tick rather than one invocation trying to
 * process everything (irrelevant in practice at this app's volume, but the
 * mechanism must not assume otherwise). The per-shop body inside the loop —
 * including BUG-5's try/catch isolation — is UNCHANGED from the
 * ADR-0002/ADR-0008-era version; only the bounding around the loop is new.
 *
 * A sweeper firing is an ALERT, not a routine event — logged loudly here;
 * wiring that log into a real alert channel is G5.5 (observability +
 * runbooks) scope, not built in this scaffold.
 */
export async function runSweeper(budget: SweepBudget = {}): Promise<SweepOutcome> {
  const limit = budget.limit ?? DEFAULT_SWEEP_LIMIT;
  const budgetMs = budget.budgetMs ?? Number.POSITIVE_INFINITY;
  const startedAt = Date.now();

  const cutoff = new Date(Date.now() - SWEEPER_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const shops = await findShopsUninstalledBefore(cutoff, limit);

  let consideredCount = 0;
  let deletedCount = 0;
  let failedCount = 0;
  let resumable = shops.length >= limit;

  for (const ctx of shops) {
    if (Date.now() - startedAt >= budgetMs) {
      // Budget exhausted before this (already-limited) page finished — leave
      // the rest for the next tick (ADR-0009 D4). The 45-day window has
      // 30+ days of slack, so "resume next tick" costs nothing in compliance
      // terms.
      resumable = true;
      break;
    }
    consideredCount += 1;

    // BUG-5 fix: each shop's work is isolated in its own try/catch so one
    // shop's failure (e.g. a future defect, a transient DB error) cannot
    // abort the whole sweep pass for every OTHER eligible shop — QA traced
    // that an uncaught throw here previously propagated out of runSweeper()
    // entirely, defeating ADR-0008 R2's purpose as the last-resort GDPR
    // guarantee for every shop in the same pass, not just the one that
    // triggered it. Logged loudly (still an ALERT-worthy event) and the
    // loop moves on to the next shop rather than stopping.
    try {
      await sequelize.transaction(async (transaction: Transaction) => {
        // The sweeper has no "currently executing webhook_event row" to
        // exclude — unlike shop-redact.service.ts, which runs FROM a claimed
        // inbox row. Pass a value that matches no id.
        const rowCounts = await hardDeleteShop(ctx, "00000000-0000-0000-0000-000000000000", transaction);

        // BUG-5 fix: same empty-array guard as BUG-2 (shop-redact.service.ts)
        // and BUG-4 (app-uninstalled.service.ts). deleteSessions([]) is a
        // Postgres syntax error in
        // @shopify/shopify-app-session-storage-postgresql, not a no-op — and
        // for the sweeper this is the NORMAL case, not an edge case: every
        // shop this query selects (uninstalled_at older than the window) has
        // already had app/uninstalled clear its sessions, so
        // findSessionsByShop almost always returns [] here.
        const sessions = await sessionStorageInstance.findSessionsByShop(ctx.shopDomain);
        if (sessions.length > 0) {
          await sessionStorageInstance.deleteSessions(sessions.map((s) => s.id));
        }

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

      deletedCount += 1;
      console.warn(
        `[sweeper] ALERT: shop ${ctx.shopDomain} was hard-deleted by the 45-day ` +
          "safety sweeper — this means shop/redact was never successfully " +
          "processed for it. Investigate the missed delivery (ADR-0008 R2).",
      );
    } catch (err) {
      failedCount += 1;
      console.error(
        `[sweeper] ALERT: failed to hard-delete shop ${ctx.shopDomain} during the ` +
          "45-day safety sweep — this shop was NOT deleted and will be retried " +
          "on the next sweep pass. Other shops in this pass are unaffected. " +
          "Investigate immediately (ADR-0008 R2).",
        err,
      );
    }
  }

  return { consideredCount, deletedCount, failedCount, resumable };
}

/** webhook_event retention pruning (data-model.md §4.5). UNCHANGED by
 * ADR-0009 (D3 step 3: "Prune — runWebhookEventPruning(), unchanged") — a
 * single indexed DELETE, cheap enough on every cron tick that it does not
 * need its own LIMIT/budget bounding the way the sweeper does. Previously
 * rode the sweeper's own setInterval cadence; now called directly by the
 * cron tick (app/routes/api.cron.tick.tsx) as its own step. */
export async function runWebhookEventPruning(): Promise<void> {
  const cutoff = new Date(
    Date.now() - WEBHOOK_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
  await prunedProcessedOlderThan(cutoff);
}
