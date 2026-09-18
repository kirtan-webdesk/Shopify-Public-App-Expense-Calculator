import type { Route } from "./+types/auth.$";
import { authenticate } from "~/shopify.server";
import { upsertInstalledShop } from "~/db/repositories/shop.repository";

// auth/* — token exchange + managed installation (ADR-0007, no OAuth
// redirect flow). authenticate.admin handles the full token-exchange
// handshake; on a fresh install this is also where the app's own `shop` row
// is created/reactivated (ADR-0008 step 2 — reinstall before redaction
// clears uninstalled_at rather than creating a duplicate row).
export async function loader({ request }: Route.LoaderArgs) {
  const { session } = await authenticate.admin(request);
  await upsertInstalledShop(session.shop);
  return null;
}
