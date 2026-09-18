import type { Transaction } from "sequelize";
import { findShopContextByDomain, hardDeleteShop } from "~/db/repositories/shop.repository";
import { recordComplianceOutcome } from "~/db/repositories/compliance-audit-log.repository";
import { sessionStorageInstance } from "~/shopify.server";

/**
 * shop/redact — data-model.md §5, ADR-0008 step 3. The one compliance
 * handler with real deletion work. Runs inside the drain worker's claim
 * transaction (passed in) so the deletion, the audit row, and the
 * processed_at stamp the caller applies afterward are all atomic with the
 * claim.
 *
 * Deletion topology, in order: calculation_line_item -> calculation ->
 * expense_rule -> webhook_event (excluding the currently-executing row,
 * ordering note ADR-0002/§5) -> session rows via the session-storage
 * library's own API (its own count, not our SQL — ADR-0007) -> shop itself.
 * Row counts are captured and asserted into compliance_audit_log rather than
 * trusting the ON DELETE CASCADE silently (constraint #11).
 *
 * Already-redacted edge case (data-model.md §4.5): if no shop row exists for
 * this domain (a genuine second, distinct shop/redact delivery arriving
 * after a first successful redaction already removed it), this is a no_op,
 * not an error — acks 2xx and writes a no_op audit row.
 */
export async function handleShopRedact(
  shopDomain: string,
  webhookId: string,
  currentWebhookEventId: string,
  transaction: Transaction,
): Promise<void> {
  const ctx = await findShopContextByDomain(shopDomain);

  if (!ctx) {
    await recordComplianceOutcome(
      {
        shopDomain,
        webhookId,
        topic: "shop/redact",
        outcome: "no_op",
        reason: "shop already redacted — no shop row exists for this domain",
      },
      transaction,
    );
    return;
  }

  const rowCounts = await hardDeleteShop(ctx, currentWebhookEventId, transaction);

  // Session rows: the library's own API and its own count (ADR-0007 — no app
  // SQL ever touches shopify_sessions). Not part of the same DB transaction
  // (the library manages its own connection), so this runs after the app-
  // table deletion commits logic below is finalized by the caller; if this
  // step fails after the transaction's deletes are queued but not yet
  // committed by the caller, the whole claim transaction still rolls back
  // together (see app/workers/drain-worker.ts), so a partial delete is not
  // left committed.
  const sessions = await sessionStorageInstance.findSessionsByShop(shopDomain);
  await sessionStorageInstance.deleteSessions(sessions.map((s) => s.id));

  await recordComplianceOutcome(
    {
      shopDomain,
      webhookId,
      topic: "shop/redact",
      outcome: "completed",
      deletedRowCounts: { ...rowCounts, shopify_sessions: sessions.length },
    },
    transaction,
  );
}
