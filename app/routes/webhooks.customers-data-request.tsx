import type { Route } from "./+types/webhooks.customers-data-request";
import { authenticate } from "~/shopify.server";
import { ackAndEnqueueWebhook } from "~/services/webhook-inbox.service";
import { getRawWebhookTopic } from "~/services/webhook-topic.service";

// webhooks/customers-data-request — mandatory GDPR compliance webhook,
// declared via compliance_topics in shopify.app.toml. See
// app/services/compliance/customers-data-request.service.ts for the real
// handler logic (drained asynchronously) and its documented KNOWN GAP around
// delivery transport.
export async function action({ request }: Route.ActionArgs) {
  const { shop, payload, webhookId } = await authenticate.webhook(request);
  // BUG-1 fix — use the literal wire-format topic (X-Shopify-Topic header),
  // never authenticate.webhook()'s internally-normalized `topic` field. See
  // app/services/webhook-topic.service.ts for the full explanation.
  const topic = getRawWebhookTopic(request, "customers/data_request");

  await ackAndEnqueueWebhook({
    webhookId,
    shopDomain: shop,
    topic,
    payload: payload as Record<string, unknown>,
  });

  return new Response(null, { status: 200 });
}
