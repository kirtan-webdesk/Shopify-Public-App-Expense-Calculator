import type { Route } from "./+types/webhooks.customers-redact";
import { authenticate } from "~/shopify.server";
import { ackAndEnqueueWebhook } from "~/services/webhook-inbox.service";
import { getRawWebhookTopic } from "~/services/webhook-topic.service";

// webhooks/customers-redact — mandatory GDPR compliance webhook, declared
// via compliance_topics in shopify.app.toml. See
// app/services/compliance/customers-redact.service.ts for the real handler
// (a documented, logged no-op with a stated reason — the app stores no
// customer-identified data — drained asynchronously, not a stub).
export async function action({ request }: Route.ActionArgs) {
  const { shop, payload, webhookId } = await authenticate.webhook(request);
  // BUG-1 fix — use the literal wire-format topic (X-Shopify-Topic header),
  // never authenticate.webhook()'s internally-normalized `topic` field. See
  // app/services/webhook-topic.service.ts for the full explanation.
  const topic = getRawWebhookTopic(request, "customers/redact");

  await ackAndEnqueueWebhook({
    webhookId,
    shopDomain: shop,
    topic,
    payload: payload as Record<string, unknown>,
  });

  return new Response(null, { status: 200 });
}
