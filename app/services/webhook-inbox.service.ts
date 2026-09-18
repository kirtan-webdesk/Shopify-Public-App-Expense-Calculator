import type { WebhookTopic } from "~/db/models/webhook-event.model";
import { findShopContextByDomain } from "~/db/repositories/shop.repository";
import { insertWebhookEvent } from "~/db/repositories/webhook-event.repository";
import { recordComplianceOutcome } from "~/db/repositories/compliance-audit-log.repository";

const COMPLIANCE_TOPICS = new Set<WebhookTopic>([
  "customers/data_request",
  "customers/redact",
  "shop/redact",
]);

/**
 * The ONE thing every webhook route does after HMAC verification: insert
 * the delivery into the durable inbox and return. No business logic, no
 * deletion, no external call in the request path (ADR-0002 item 2) — that
 * is what keeps ack latency to a single INSERT, comfortably inside the 1s
 * connect / 5s total delivery budget.
 *
 * shop_id is NOT NULL on webhook_event (data-model.md §4.5). All four topics
 * only ever fire for a shop that completed install, EXCEPT the documented
 * edge case: a genuine second, distinct shop/redact delivery arriving after
 * the first one already hard-deleted the shop row. In that case there is no
 * shop.id to attach — this function does NOT insert an inbox row for that
 * case; it writes the no_op compliance_audit_log row directly and returns,
 * keeping shop_id NOT NULL honest (data-model.md §4.5's documented
 * resolution).
 */
export async function ackAndEnqueueWebhook(input: {
  webhookId: string;
  shopDomain: string;
  topic: WebhookTopic;
  payload: Record<string, unknown>;
}): Promise<void> {
  const ctx = await findShopContextByDomain(input.shopDomain);

  if (!ctx) {
    if (COMPLIANCE_TOPICS.has(input.topic)) {
      await recordComplianceOutcome({
        shopDomain: input.shopDomain,
        webhookId: input.webhookId,
        topic: input.topic as "customers/data_request" | "customers/redact" | "shop/redact",
        outcome: "no_op",
        reason: "no shop row exists for this domain (already redacted, or never installed)",
      });
    }
    // app/uninstalled with no shop row is a genuine no-op too — nothing to
    // mark uninstalled. Ack either way; do not insert an orphaned inbox row.
    return;
  }

  await insertWebhookEvent({
    webhookId: input.webhookId,
    shopId: ctx.shopId,
    shopDomain: ctx.shopDomain,
    topic: input.topic,
    payload: input.payload,
  });
}
