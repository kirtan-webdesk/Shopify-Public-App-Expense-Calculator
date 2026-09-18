import type { Route } from "./+types/webhooks.app-uninstalled";
import { authenticate } from "~/shopify.server";
import { ackAndEnqueueWebhook } from "~/services/webhook-inbox.service";
import { getRawWebhookTopic } from "~/services/webhook-topic.service";

// webhooks/app-uninstalled — declared via [[webhooks.subscriptions]] in
// shopify.app.toml (ADR-0006: no runtime registration mutation). NOT nested
// under the app layout route (see app/routes.ts). authenticate.webhook
// verifies HMAC and returns 401 automatically on failure; `session` may be
// undefined here (the shop may already be mid-uninstall) — this handler
// never depends on it, only on the verified `shop` domain from the payload.
//
// Per ADR-0002: this route does exactly one thing — insert into the durable
// inbox and ack. The real work (mark shop.uninstalled_at, delete sessions —
// ADR-0008 step 1) runs asynchronously in the drain worker
// (app/workers/drain-worker.ts), never in this request.
export async function action({ request }: Route.ActionArgs) {
  const { shop, payload, webhookId } = await authenticate.webhook(request);
  // BUG-1 fix — use the literal wire-format topic (X-Shopify-Topic header),
  // never authenticate.webhook()'s internally-normalized `topic` field. See
  // app/services/webhook-topic.service.ts for the full explanation.
  const topic = getRawWebhookTopic(request, "app/uninstalled");

  await ackAndEnqueueWebhook({
    webhookId,
    shopDomain: shop,
    topic,
    payload: payload as Record<string, unknown>,
  });

  // Minimal 2xx body, never echoing merchant/customer data (WebDesk
  // hardening policy — not a Shopify requirement, ADR-0002 item 6).
  return new Response(null, { status: 200 });
}
