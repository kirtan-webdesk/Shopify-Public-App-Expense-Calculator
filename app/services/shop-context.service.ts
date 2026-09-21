import { ensureShopContext } from "~/db/repositories/shop.repository";
import type { ShopContext } from "~/db/repositories/shop-context";

/**
 * requireShopContext — THE choke point every authenticated /app route uses to
 * obtain its ShopContext (G4-sprint-3.2, P1 fix).
 *
 * Under Shopify managed installation + token exchange, /auth/* is never
 * visited and no `shop` row is created by any install hook, so a valid
 * session can arrive for a shop that has no row yet (or whose row was
 * soft-marked uninstalled). This resolves the row — creating or reactivating
 * it idempotently and race-safely (see ensureShopContext) — so the old
 * "Shop record not found for this session" 404 cannot occur for an
 * authenticated session.
 *
 * Tenancy (ADR-0003): the parameter is the authenticated SESSION (the
 * `session` returned by `authenticate.admin`), never a bare string, so a
 * request parameter / query / form value cannot be passed here by accident.
 * Routes must call it as `requireShopContext(session)` and must not call
 * findShopContextByDomain themselves (enforced by
 * tests/architecture/shop-context-choke-point.test.ts).
 *
 * Do not call from inside an open transaction (pool.max:1, ADR-0010).
 */
export async function requireShopContext(session: { readonly shop: string }): Promise<ShopContext> {
  return ensureShopContext(session.shop);
}
