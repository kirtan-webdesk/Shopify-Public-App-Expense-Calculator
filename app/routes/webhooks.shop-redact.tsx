import type { Route } from "./+types/webhooks.shop-redact";
import { authenticate } from "~/shopify.server";
import { ackAndEnqueueWebhook } from "~/services/webhook-inbox.service";
import { getRawWebhookTopic } from "~/services/webhook-topic.service";

// webhooks/shop-redact — mandatory GDPR compliance webhook, declared via
// compliance_topics in shopify.app.toml. The one webhook with real deletion
// work (data-model.md §5, ADR-0008 step 3) — see
// app/services/compliance/shop-redact.service.ts, drained asynchronously by
// app/workers/drain-worker.ts. This route itself does nothing beyond
// HMAC-verify, ack, and enqueue (ADR-0002 item 2) — a multi-table delete has
// no business running inside a 5-second delivery budget.
export async function action({ request }: Route.ActionArgs) {
  const { shop, payload, webhookId } = await authenticate.webhook(request);
  // BUG-1 fix — use the literal wire-format topic (X-Shopify-Topic header),
  // never authenticate.webhook()'s internally-normalized `topic` field. See
  // app/services/webhook-topic.service.ts for the full explanation.
  const topic = getRawWebhookTopic(request, "shop/redact");

  await ackAndEnqueueWebhook({
    webhookId,
    shopDomain: shop,
    topic,
    payload: payload as Record<string, unknown>,
  });

  return new Response(null, { status: 200 });
}
