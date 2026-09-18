import type { Route } from "./+types/webhooks.shop-redact";
import { authenticate } from "~/shopify.server";
import { ackAndEnqueueWebhook } from "~/services/webhook-inbox.service";
import { getRawWebhookTopic } from "~/services/webhook-topic.service";
import { scheduleAfterResponse } from "~/workers/after-response.server";
import { continueDrainAfterResponse } from "~/workers/drain-worker";

// webhooks/shop-redact — mandatory GDPR compliance webhook, declared via
// compliance_topics in shopify.app.toml. The one webhook with real deletion
// work (data-model.md §5, ADR-0008 step 3) — see
// app/services/compliance/shop-redact.service.ts, drained by
// app/workers/drain-worker.ts. This route itself does nothing beyond
// HMAC-verify, ack, enqueue, and (ADR-0009 D2) schedule a best-effort
// post-response drain continuation — a multi-table delete has no business
// running inside a 5-second delivery budget. The scheduleAfterResponse call
// below is explicitly allowed to fail/not run (ADR-0009 D2); the slow-tier
// cron (/api/cron/tick) is the actual guarantee, not this line.
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

  scheduleAfterResponse(continueDrainAfterResponse);

  return new Response(null, { status: 200 });
}
