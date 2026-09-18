import type { Route } from "./+types/webhooks.shop-redact";
import { authenticate } from "~/shopify.server";
import { ackAndEnqueueWebhook } from "~/services/webhook-inbox.service";

// webhooks/shop-redact — mandatory GDPR compliance webhook, declared via
// compliance_topics in shopify.app.toml. The one webhook with real deletion
// work (data-model.md §5, ADR-0008 step 3) — see
// app/services/compliance/shop-redact.service.ts, drained asynchronously by
// app/workers/drain-worker.ts. This route itself does nothing beyond
// HMAC-verify, ack, and enqueue (ADR-0002 item 2) — a multi-table delete has
// no business running inside a 5-second delivery budget.
export async function action({ request }: Route.ActionArgs) {
  const { topic, shop, payload, webhookId } = await authenticate.webhook(request);

  await ackAndEnqueueWebhook({
    webhookId,
    shopDomain: shop,
    topic: topic as "shop/redact",
    payload: payload as Record<string, unknown>,
  });

  return new Response(null, { status: 200 });
}
