import { Op, Transaction, UniqueConstraintError } from "sequelize";
import { sequelize } from "~/db/sequelize";
import { WebhookEventModel, type WebhookTopic } from "~/db/models/webhook-event.model";

// webhook-event.repository — the durable inbox (ADR-0002). This is the
// ONLY place that touches the webhook_event table; the webhook routes and
// the drain worker both go through it.

export interface InsertWebhookEventInput {
  readonly webhookId: string;
  readonly shopId: string;
  readonly shopDomain: string;
  readonly topic: WebhookTopic;
  readonly payload: Record<string, unknown>;
}

export type InsertWebhookEventResult =
  | { readonly inserted: true; readonly id: string }
  | { readonly inserted: false; readonly reason: "duplicate" };

/**
 * Insert the delivery. Dedup is the unique index on webhook_id
 * (X-Shopify-Webhook-Id) — a replayed delivery hits the DB constraint and is
 * swallowed here as a no-op, still returning success to the caller so the
 * webhook route can ack 2xx either way (ADR-0002 item 3).
 */
export async function insertWebhookEvent(
  input: InsertWebhookEventInput,
): Promise<InsertWebhookEventResult> {
  try {
    const row = await WebhookEventModel.create({
      webhookId: input.webhookId,
      shopId: input.shopId,
      shopDomain: input.shopDomain,
      topic: input.topic,
      payload: input.payload,
      receivedAt: new Date(),
      processedAt: null,
      attempts: 0,
      lastError: null,
    });
    return { inserted: true, id: row.id };
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      return { inserted: false, reason: "duplicate" };
    }
    throw err;
  }
}

export interface ClaimedWebhookEvent {
  readonly id: string;
  readonly webhookId: string;
  readonly shopId: string;
  readonly shopDomain: string;
  readonly topic: WebhookTopic;
  readonly payload: Record<string, unknown>;
  readonly attempts: number;
}

/**
 * Claim, process, and stamp exactly one unprocessed row — `SELECT ... FOR
 * UPDATE SKIP LOCKED` per ADR-0002. The claim and the final row update run
 * on an OUTER transaction; the handler runs inside a nested transaction
 * (a Postgres SAVEPOINT via Sequelize's `{ transaction: outerTxn }` nesting)
 * so a handler failure rolls back ONLY the handler's own writes (e.g. a
 * partially-completed shop/redact delete) while the outer transaction still
 * commits the attempts/last_error bookkeeping. Without this split, a thrown
 * handler error would either lose the failure record (outer rollback) or
 * silently commit a partial multi-table delete (outer commit swallowing the
 * error) — neither is acceptable for the one handler that deletes rows.
 *
 * Returns null if there was nothing to claim. On handler success, marks
 * processed_at. On handler failure, records attempts/last_error instead and
 * lets the row remain for a later retry pass — the row is never deleted on
 * failure, so it stays visible for the "attempts at cap" alert (ADR-0002).
 */
export async function claimAndProcessOne(
  handler: (row: ClaimedWebhookEvent, transaction: Transaction) => Promise<void>,
): Promise<{ claimed: false } | { claimed: true; succeeded: boolean }> {
  return sequelize.transaction(async (outerTransaction) => {
    const row = await WebhookEventModel.findOne({
      where: { processedAt: null },
      order: [["receivedAt", "ASC"]],
      lock: Transaction.LOCK.UPDATE,
      skipLocked: true,
      transaction: outerTransaction,
    });

    if (!row) return { claimed: false };

    const claimed: ClaimedWebhookEvent = {
      id: row.id,
      webhookId: row.webhookId,
      shopId: row.shopId,
      shopDomain: row.shopDomain,
      topic: row.topic,
      payload: row.payload,
      attempts: row.attempts,
    };

    try {
      // { transaction: outerTransaction } makes this a nested transaction
      // (a Postgres SAVEPOINT) — see the function doc comment above.
      await sequelize.transaction(
        { transaction: outerTransaction },
        async (savepointTransaction: Transaction) => {
          await handler(claimed, savepointTransaction);
          row.processedAt = new Date();
          await row.save({ transaction: savepointTransaction });
        },
      );
      return { claimed: true, succeeded: true };
    } catch (err) {
      // The savepoint rolled back at the DATABASE level, but the in-memory
      // `row` instance may still hold the processedAt value the handler
      // block set before failing (JS object mutation isn't undone by a SQL
      // ROLLBACK TO SAVEPOINT). Reset it explicitly so this save doesn't
      // accidentally persist a processed_at that was never actually
      // committed.
      row.processedAt = null;
      row.attempts += 1;
      row.lastError = err instanceof Error ? err.message : String(err);
      await row.save({ transaction: outerTransaction });
      return { claimed: true, succeeded: false };
    }
  });
}

/** Retention pruning (data-model.md §4.5) — processed rows older than the window. */
export async function prunedProcessedOlderThan(cutoff: Date): Promise<number> {
  return WebhookEventModel.destroy({
    where: { processedAt: { [Op.ne]: null, [Op.lt]: cutoff } },
  });
}
