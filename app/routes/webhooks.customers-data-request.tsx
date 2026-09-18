import type { Route } from "./+types/webhooks.customers-data-request";
import { authenticate } from "~/shopify.server";
import { ackAndEnqueueWebhook } from "~/services/webhook-inbox.service";

// webhooks/customers-data-request — mandatory GDPR compliance webhook,
// declared via compliance_topics in shopify.app.toml. See
// app/services/compliance/customers-data-request.service.ts for the real
// handler logic (drained asynchronously) and its documented KNOWN GAP around
// delivery transport.
export async function action({ request }: Route.ActionArgs) {
  const { topic, shop, payload, webhookId } = await authenticate.webhook(request);

  await ackAndEnqueueWebhook({
    webhookId,
    shopDomain: shop,
    topic: topic as "customers/data_request",
    payload: payload as Record<string, unknown>,
  });

  return new Response(null, { status: 200 });
}
