import type { Route } from "./+types/webhooks.customers-redact";
import { authenticate } from "~/shopify.server";
import { ackAndEnqueueWebhook } from "~/services/webhook-inbox.service";

// webhooks/customers-redact — mandatory GDPR compliance webhook, declared
// via compliance_topics in shopify.app.toml. See
// app/services/compliance/customers-redact.service.ts for the real handler
// (a documented, logged no-op with a stated reason — the app stores no
// customer-identified data — drained asynchronously, not a stub).
export async function action({ request }: Route.ActionArgs) {
  const { topic, shop, payload, webhookId } = await authenticate.webhook(request);

  await ackAndEnqueueWebhook({
    webhookId,
    shopDomain: shop,
    topic: topic as "customers/redact",
    payload: payload as Record<string, unknown>,
  });

  return new Response(null, { status: 200 });
}
