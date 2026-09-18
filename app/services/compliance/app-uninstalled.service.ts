import { markShopUninstalled } from "~/db/repositories/shop.repository";
import { sessionStorageInstance } from "~/shopify.server";

// app/uninstalled handler (ADR-0008 step 1). Invoked by the drain worker
// after it claims the webhook_event row (see app/workers/drain-worker.ts).
// Session deletion goes through the library's own API (ADR-0007 — sessions
// are library-owned, no app SQL ever touches shopify_sessions), which is why
// this handler — unlike shop-redact.service.ts — does not need the shared
// claim transaction: markShopUninstalled and session deletion are each
// independently idempotent, so a crash between the two just means a safe
// redelivery re-runs both.
//
// Retains the shop's rules and calculation history (~48h reinstall window,
// ADR-0008) — this handler does NOT delete app data. Only shop/redact does.
export async function handleAppUninstalled(shopDomain: string): Promise<void> {
  await markShopUninstalled(shopDomain);
  // The access token is dead the moment the app is uninstalled — leaving
  // session rows around is stale credential material (ADR-0007 step 5).
  await sessionStorageInstance.deleteSessions(
    (await sessionStorageInstance.findSessionsByShop(shopDomain)).map((s) => s.id),
  );
}
