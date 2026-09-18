import type { Transaction } from "sequelize";
import { markShopUninstalled } from "~/db/repositories/shop.repository";
import { sessionStorageInstance } from "~/shopify.server";

// app/uninstalled handler (ADR-0008 step 1). Invoked by the drain worker
// after it claims the webhook_event row (see app/workers/drain-worker.ts),
// inside the same savepoint transaction handleShopRedact uses.
//
// BUG-4 fix: previously called sessionStorageInstance.deleteSessions(ids)
// unconditionally with no length guard — the same defect class BUG-2 fixed
// in shop-redact.service.ts. deleteSessions([]) is a Postgres syntax error
// in @shopify/shopify-app-session-storage-postgresql (confirmed live in
// BUG-2's evidence), not a harmless no-op, and this is the NORMAL case here:
// most shops uninstall with zero live sessions. QA additionally flagged this
// handler was dispatched without the shared claim transaction, so
// markShopUninstalled could commit independently before deleteSessions([])
// threw, leaving uninstalled_at set with no way to unwind it and the
// webhook_event row retrying forever. Now handleAppUninstalled takes the
// caller's transaction and passes it to markShopUninstalled (same pattern as
// hardDeleteShop for shop/redact) — a thrown session-deletion error rolls
// back the savepoint, undoing markShopUninstalled with it, so a real failure
// still leaves nothing half-committed. Session deletion itself stays outside
// the DB transaction (the library manages its own connection — ADR-0007), so
// a throw from it still propagates up through this async function and is
// what triggers the savepoint rollback.
//
// Retains the shop's rules and calculation history (~48h reinstall window,
// ADR-0008) — this handler does NOT delete app data. Only shop/redact does.
export async function handleAppUninstalled(
  shopDomain: string,
  transaction: Transaction,
): Promise<void> {
  await markShopUninstalled(shopDomain, transaction);
  // The access token is dead the moment the app is uninstalled — leaving
  // session rows around is stale credential material (ADR-0007 step 5).
  const sessions = await sessionStorageInstance.findSessionsByShop(shopDomain);
  if (sessions.length > 0) {
    await sessionStorageInstance.deleteSessions(sessions.map((s) => s.id));
  }
}
