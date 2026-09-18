import { claimAndProcessOne } from "~/db/repositories/webhook-event.repository";
import { handleAppUninstalled } from "~/services/compliance/app-uninstalled.service";
import { handleCustomersDataRequest } from "~/services/compliance/customers-data-request.service";
import { handleCustomersRedact } from "~/services/compliance/customers-redact.service";
import { handleShopRedact } from "~/services/compliance/shop-redact.service";
import type { Transaction } from "sequelize";
import type { ClaimedWebhookEvent } from "~/db/repositories/webhook-event.repository";

// In-process drain worker (ADR-0002/ADR-0001) — an interval loop inside the
// SAME long-running Node process, not a separate service. Dispatches by
// topic to the appropriate compliance handler. Bootstrapped once per process
// from app/workers/bootstrap.server.ts.

async function dispatch(row: ClaimedWebhookEvent, transaction: Transaction): Promise<void> {
  switch (row.topic) {
    case "app/uninstalled":
      // BUG-4 fix: pass the shared savepoint transaction, same as
      // handleShopRedact below — see app-uninstalled.service.ts.
      await handleAppUninstalled(row.shopDomain, transaction);
      return;
    case "customers/data_request":
      await handleCustomersDataRequest(row.shopDomain, row.webhookId);
      return;
    case "customers/redact":
      await handleCustomersRedact(row.shopDomain, row.webhookId);
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

/** Drains at most one row per call — the interval cadence is the throttle. */
export async function drainOnce(): Promise<void> {
  const result = await claimAndProcessOne(dispatch);
  if (result.claimed && !result.succeeded) {
    console.error(
      "[drain-worker] a webhook_event row failed processing and was left " +
        "unprocessed for retry; see its last_error column. Repeated " +
        "failures against the same row should page (ADR-0002 alert: " +
        "'inbox rows unprocessed > 15 min, or attempts at cap').",
    );
  }
}

/** Drains the whole current backlog, one row at a time, for use at boot. */
export async function drainBacklog(maxIterations = 500): Promise<void> {
  for (let i = 0; i < maxIterations; i += 1) {
    const result = await claimAndProcessOne(dispatch);
    if (!result.claimed) return;
  }
}
