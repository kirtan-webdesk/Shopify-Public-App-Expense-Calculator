import { claimAndProcessOne } from "~/db/repositories/webhook-event.repository";
import { handleAppUninstalled } from "~/services/compliance/app-uninstalled.service";
import { handleCustomersDataRequest } from "~/services/compliance/customers-data-request.service";
import { handleCustomersRedact } from "~/services/compliance/customers-redact.service";
import { handleShopRedact } from "~/services/compliance/shop-redact.service";
import type { Transaction } from "sequelize";
import type { ClaimedWebhookEvent } from "~/db/repositories/webhook-event.repository";

// drain-worker — dispatches a claimed webhook_event row to the appropriate
// compliance handler. Originally an in-process interval-loop worker
// (ADR-0001/ADR-0002); under ADR-0009 (G1.5-revision) it is invoked by HTTP
// instead of a timer — drainOnce/drainBacklog below are UNCHANGED (ADR-0009
// D1/D7: same signatures, same bodies, kept for the "reversal is cheap" case
// noted in ADR-0009's Consequences), simply no longer auto-started anywhere.
// drainUpTo is new: the budget-bounded primitive BOTH the fast tier
// (app/workers/after-response.server.ts, via each webhook route) and the
// slow tier (app/routes/api.cron.tick.tsx) call.

async function dispatch(row: ClaimedWebhookEvent, transaction: Transaction): Promise<void> {
  switch (row.topic) {
    case "app/uninstalled":
      // BUG-4 fix: pass the shared savepoint transaction, same as
      // handleShopRedact below — see app-uninstalled.service.ts.
      await handleAppUninstalled(row.shopDomain, transaction);
      return;
    case "customers/data_request":
      // ADR-0010 fix (found live, G1.5-revision): pass the shared
      // transaction — see customers-data-request.service.ts's own comment.
      // Previously called with no transaction, which deadlocked under
      // pool.max:1 (ADR-0010) while this same claim's outer transaction
      // held the pool's one connection.
      await handleCustomersDataRequest(row.shopDomain, row.webhookId, transaction);
      return;
    case "customers/redact":
      // ADR-0010 fix (found live, G1.5-revision): same as above — see
      // customers-redact.service.ts's own comment.
      await handleCustomersRedact(row.shopDomain, row.webhookId, transaction);
      return;
    case "shop/redact":
      await handleShopRedact(row.shopDomain, row.webhookId, row.id, transaction);
      return;
    default: {
      const exhaustive: never = row.topic;
      throw new Error(`Unknown webhook topic reached the drain worker: ${exhaustive}`);
    }
  }
}

function logFailedRow(): void {
  console.error(
    "[drain-worker] a webhook_event row failed processing and was left " +
      "unprocessed for retry; see its last_error column. Repeated " +
      "failures against the same row should page (ADR-0002 alert, re-tuned " +
      "by ADR-0009 D6 to max(2 x cron interval, 30 min): 'inbox rows " +
      "unprocessed > threshold, or attempts at cap').",
  );
}

/** Drains at most one row per call — UNCHANGED (ADR-0009 D1). Not currently
 * invoked from any auto-starting site (see app/workers/bootstrap.server.ts's
 * removal note in app/entry.server.tsx) — kept so a future reversion to a
 * long-running host can reintroduce a scheduler that calls the same
 * functions without redesigning this module (ADR-0009 Consequences). */
export async function drainOnce(): Promise<void> {
  const result = await claimAndProcessOne(dispatch);
  if (result.claimed && !result.succeeded) {
    logFailedRow();
  }
}

/** Drains the whole current backlog, one row at a time — UNCHANGED
 * (ADR-0009 D1). Same "kept for a cheap reversal" reasoning as drainOnce
 * above; not currently invoked from any auto-starting site. */
export async function drainBacklog(maxIterations = 500): Promise<void> {
  for (let i = 0; i < maxIterations; i += 1) {
    const result = await claimAndProcessOne(dispatch);
    if (!result.claimed) return;
  }
}

export interface DrainBudget {
  /** Never claim more than this many rows in one call. */
  readonly maxRows: number;
  /** Stop claiming once this many milliseconds have elapsed, even if
   * maxRows and the backlog both have room left — this is what makes the
   * cron tick (ADR-0009 D4) resumable rather than duration-dependent. */
  readonly budgetMs: number;
}

export interface DrainOutcome {
  readonly drained: number;
  readonly failed: number;
  /** true only if the backlog was empty before maxRows/budgetMs was hit —
   * i.e. there was nothing left to claim, not merely "we stopped early". */
  readonly backlogExhausted: boolean;
}

/**
 * NEW (ADR-0009 D2/D3/D4) — the shared primitive behind BOTH tiers. Drains
 * oldest-first, up to `maxRows`, under a wall-clock `budgetMs`, using the
 * exact same claimAndProcessOne every other drain path uses. Never throws:
 * claimAndProcessOne already isolates a single row's handler failure inside
 * its own try/catch (records attempts/last_error, returns
 * succeeded:false) — there is no second layer of error handling to add here.
 *
 * The fast tier (app/workers/after-response.server.ts, called from each
 * webhook route via a small K=5 budget) and the slow tier
 * (app/routes/api.cron.tick.tsx, called with a larger row cap and the
 * remainder of the tick's overall budget) differ ONLY in which
 * maxRows/budgetMs they pass — this function has no opinion about which
 * tier is calling it.
 */
export async function drainUpTo({ maxRows, budgetMs }: DrainBudget): Promise<DrainOutcome> {
  const startedAt = Date.now();
  let drained = 0;
  let failed = 0;

  for (let i = 0; i < maxRows; i += 1) {
    if (Date.now() - startedAt >= budgetMs) {
      return { drained, failed, backlogExhausted: false };
    }

    const result = await claimAndProcessOne(dispatch);
    if (!result.claimed) {
      return { drained, failed, backlogExhausted: true };
    }

    drained += 1;
    if (!result.succeeded) {
      failed += 1;
      logFailedRow();
    }
  }

  return { drained, failed, backlogExhausted: false };
}

const FAST_TIER_MAX_ROWS = 5;
const FAST_TIER_BUDGET_MS = Number(process.env.FAST_TIER_DRAIN_BUDGET_MS || 4000);

/**
 * The fast tier's exact call shape (ADR-0009 D2: "up to K rows (K=5), under
 * a wall-clock budget"). Every webhook route calls this via
 * scheduleAfterResponse(continueDrainAfterResponse) — one line, per D2 —
 * never awaited, never allowed to affect the response.
 */
export async function continueDrainAfterResponse(): Promise<void> {
  await drainUpTo({ maxRows: FAST_TIER_MAX_ROWS, budgetMs: FAST_TIER_BUDGET_MS });
}
