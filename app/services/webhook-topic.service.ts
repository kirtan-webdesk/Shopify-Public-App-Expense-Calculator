import type { WebhookTopic } from "~/db/models/webhook-event.model";

/**
 * BUG-1 FIX (G4-sprint-1.1 live evidence, dev-evidence/g4-sprint-1.1-live-evidence/00-SUMMARY.md §4
 * "Defect A"): @shopify/shopify-api's `authenticate.webhook()` returns a
 * `topic` field that has already been run through the library's internal
 * `topicForStorage()` transform (`topic.toUpperCase().replace(/\/|\./g,
 * '_')` — confirmed by reading
 * node_modules/@shopify/shopify-api/lib/webhooks/validate.ts and registry.ts
 * directly, version 15.0.0) — e.g. `"shop/redact"` becomes `"SHOP_REDACT"`.
 * That normalized form exists purely for the library's own internal handler
 * registry lookup keys.
 *
 * webhook_event.topic and compliance_audit_log.topic both carry a DB CHECK
 * constraint on the literal slash/dot-separated topic string
 * (decisions/data-model.md §4.5, §4.6), and the WebhookTopic TS type
 * (app/db/models/webhook-event.model.ts) is defined in terms of that same
 * literal form. The four webhook routes previously passed
 * `authenticate.webhook()`'s normalized `topic` straight through with only a
 * type-level cast (`topic as "shop/redact"`) and no runtime translation,
 * which type-checked cleanly but inserted the wrong runtime string and
 * tripped the CHECK constraint on every real HTTP delivery (confirmed 500 on
 * all 4 routes in the live evidence run).
 *
 * Resolution (per the human-approved fix instruction: pick ONE canonical
 * representation end-to-end, don't leave two floating around): this
 * app never uses `authenticate.webhook()`'s returned `topic` field. Instead
 * every route reads the topic from the raw `X-Shopify-Topic` request header
 * directly — Shopify sends the literal, un-normalized topic string on the
 * wire (confirmed against the same library source:
 * `ShopifyHeader.Topic = 'X-Shopify-Topic'` in lib/types.ts, read verbatim
 * by validate.ts before topicForStorage() ever touches it). That raw header
 * value is exactly the literal form the schema, the TS type, and every
 * comparison in this codebase (COMPLIANCE_TOPICS, handleShopRedact's
 * `topic: "shop/redact"`, etc.) already expect — one canonical literal
 * representation, used from HTTP ingestion through to the DB row, with the
 * library's normalized form never touching storage or a constraint.
 *
 * `authenticate.webhook(request)` MUST still be called and MUST still
 * succeed (HMAC verification, 401 on failure) before this is trusted — this
 * helper does not verify anything on its own, it only extracts the literal
 * topic string from an already-authenticated request. The `expectedTopic`
 * parameter is defense-in-depth: each webhook route is wired to exactly one
 * topic in shopify.app.toml, so a mismatch here means either a
 * misconfigured subscription or a request routed to the wrong handler —
 * either way, fail loud (400) rather than silently enqueue a topic value
 * that would only be caught later, at the DB constraint, inside the async
 * drain worker where a 500 has no HTTP caller left to see it.
 */
export function getRawWebhookTopic(request: Request, expectedTopic: WebhookTopic): WebhookTopic {
  const raw = request.headers.get("X-Shopify-Topic");

  if (raw !== expectedTopic) {
    throw new Response(null, { status: 400 });
  }

  return expectedTopic;
}
