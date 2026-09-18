// Live-evidence script for the BUG (logged in project.json, G4-sprint-2.1
// finding) fix: app/db/repositories/shop.repository.ts's
// upsertInstalledShop() could not create a brand-new shop row because
// ShopModel.installedAt (app/db/models/shop.model.ts) had no client-side
// `defaultValue`, only a DB-side `DEFAULT now()`. See
// dev-evidence/g4-sprint-2.1-m2-m3/00-SUMMARY.md for the original finding.
//
// APPROVED FIX (human-authorized, this sprint): add
// `defaultValue: DataTypes.NOW` to ShopModel.installedAt, matching the
// migration's `TIMESTAMPTZ NOT NULL DEFAULT now()` exactly (verified against
// db/migrations/20260918120000-initial-schema.cjs before writing the fix).
//
// NOT part of the permanent vitest suite (same convention as every other
// dev-evidence live script in this repo — vitest.config.ts deliberately
// excludes DB integration; no DATABASE_URL secret in CI). Run manually via
// vite-node against a real Postgres (Neon, via .env's DATABASE_URL — value
// never printed), output captured to 00-live-evidence-output.log.
//
// Run: npx vite-node -c vitest.config.ts dev-evidence/g4-sprint-2.2-shop-install-fix/live-evidence.ts
//
// Exercises, against the REAL database (not mocks), using the REAL
// production code path (no SQL-insert workaround, unlike the prior sprint's
// evidence script which had to bypass this exact defect):
//   1. upsertInstalledShop() on a GENUINELY FRESH shop domain (randomUUID
//      per run, never reused from any prior evidence run in this repo) —
//      the brand-new-install path that was broken.
//   2. installed_at is set, non-null, and is a real recent timestamp (not a
//      client-supplied "now" duplicated elsewhere — it comes from the
//      model's own DataTypes.NOW default, i.e. from Sequelize/Postgres,
//      confirmed by reading the row back with a fresh, independent query).
//   3. Idempotent reinstall path (ADR-0008 step 2): calling
//      upsertInstalledShop() again for the same domain does not create a
//      second row and does not change installed_at.
//   4. Whatever normally happens right after install: PostgreSQLSessionStorage
//      session persistence for that same fresh shop domain (the library-owned
//      half of auth.$.tsx's loader — authenticate.admin's token-exchange
//      handshake stores a session — exercised here directly against the same
//      sessionStorage instance app/shopify.server.ts wires up, since a real
//      authenticate.admin() call needs a live Shopify session-token JWT this
//      script cannot fabricate) followed by the app-side upsertInstalledShop()
//      call, mirroring auth.$.tsx's loader body line for line, and confirms
//      both rows (shopify_sessions + shop) exist and agree on the shop domain
//      afterward.
//   5. Cleanup — deletes everything it created (both the shop row and the
//      session row) so this script is safe to re-run and leaves no residue
//      in the shared dev database.

import { randomUUID } from "node:crypto";
import { QueryTypes } from "sequelize";
import { sequelize } from "~/db/sequelize";
import { upsertInstalledShop } from "~/db/repositories/shop.repository";
import { sessionStorageInstance } from "~/shopify.server";
import { Session } from "@shopify/shopify-api";

function log(section: string, data: unknown) {
  console.log(`\n=== ${section} ===`);
  console.log(typeof data === "string" ? data : JSON.stringify(data, null, 2));
}

async function main() {
  // Genuinely fresh — randomUUID per run, never a domain reused from any
  // prior evidence run (g4-sprint-1.1-live-evidence*, g4-sprint-2.1-m2-m3,
  // or this run's own prior attempts). This is exactly the property whose
  // absence let the original defect go undetected for three prior rounds.
  const shopDomain = `bugfix-shop-install-${randomUUID()}.myshopify.com`;
  log("0. Fresh test shop domain (never used before)", shopDomain);

  // --- 1. Brand-new install via the REAL repository function -------------
  const beforeCall = new Date();
  const ctx1 = await upsertInstalledShop(shopDomain);
  const afterCall = new Date();
  log("1. upsertInstalledShop() result (fresh domain)", ctx1);

  if (!ctx1.shopId || ctx1.shopDomain !== shopDomain) {
    throw new Error("upsertInstalledShop did not return a valid ShopContext for a fresh domain");
  }

  // --- 2. Independently read the row back, confirm installed_at ----------
  const rows = await sequelize.query(
    `SELECT id, shop_domain, installed_at, uninstalled_at, created_at, updated_at
     FROM shop WHERE shop_domain = :shopDomain;`,
    { replacements: { shopDomain }, type: QueryTypes.SELECT },
  );
  log("2. Independent row read-back", rows);

  if (rows.length !== 1) {
    throw new Error(`Expected exactly 1 shop row, found ${rows.length}`);
  }
  const row = rows[0] as {
    id: string;
    shop_domain: string;
    installed_at: Date;
    uninstalled_at: Date | null;
    created_at: Date;
    updated_at: Date;
  };
  if (row.installed_at === null || row.installed_at === undefined) {
    throw new Error("installed_at is null/undefined — the defect is NOT fixed");
  }
  const installedAtMs = new Date(row.installed_at).getTime();
  // installed_at must be a real "now", bounded by the call's own wall-clock
  // window (with small slack for clock skew between this process and the
  // Postgres server) — not some fixed epoch, not null-coerced.
  const withinWindow =
    installedAtMs >= beforeCall.getTime() - 5000 && installedAtMs <= afterCall.getTime() + 5000;
  log("2a. installed_at within expected wall-clock window", {
    installed_at: row.installed_at,
    beforeCall,
    afterCall,
    withinWindow,
  });
  if (!withinWindow) {
    throw new Error("installed_at is not a plausible 'now' value for this call");
  }
  if (row.uninstalled_at !== null) {
    throw new Error("uninstalled_at should be null on a fresh install");
  }

  // --- 3. Idempotent reinstall — same domain, no duplicate row -----------
  const ctx2 = await upsertInstalledShop(shopDomain);
  const rowsAfterReinstall = await sequelize.query(
    `SELECT id, installed_at FROM shop WHERE shop_domain = :shopDomain;`,
    { replacements: { shopDomain }, type: QueryTypes.SELECT },
  );
  log("3. Reinstall (same domain) result + row count", {
    ctx2,
    rowCount: rowsAfterReinstall.length,
  });
  if (rowsAfterReinstall.length !== 1) {
    throw new Error("Reinstall created a duplicate shop row (ADR-0008 step 2 violated)");
  }
  if (ctx2.shopId !== ctx1.shopId) {
    throw new Error("Reinstall returned a different shopId — should resolve the same row");
  }
  const rowAfterReinstall = rowsAfterReinstall[0] as { id: string; installed_at: Date };
  if (new Date(rowAfterReinstall.installed_at).getTime() !== installedAtMs) {
    throw new Error("Reinstall changed installed_at — it should be untouched on an existing row");
  }

  // --- 4. What normally happens right after install: session storage -----
  // Mirrors app/routes/auth.$.tsx's loader body: authenticate.admin(request)
  // (library-owned — its token-exchange handshake calls
  // sessionStorage.storeSession() internally) followed by
  // upsertInstalledShop(session.shop). A real authenticate.admin() call
  // needs a live Shopify session-token JWT this script cannot fabricate, so
  // this step exercises the SAME sessionStorage instance
  // app/shopify.server.ts wires up (PostgreSQLSessionStorage against the
  // same DATABASE_URL, ADR-0007) directly with a realistic offline Session,
  // for a SECOND fresh domain — proving the fix doesn't only work in
  // isolation but composes correctly with the session-storage half of a
  // real install.
  const shopDomain2 = `bugfix-shop-install-session-${randomUUID()}.myshopify.com`;
  const offlineSessionId = `offline_${shopDomain2}`;
  const session = new Session({
    id: offlineSessionId,
    shop: shopDomain2,
    state: "n/a",
    isOnline: false,
    scope: "",
    accessToken: "shpat_evidence-run-fake-token-not-a-real-secret",
  });
  const stored = await sessionStorageInstance.storeSession(session);
  log("4a. sessionStorage.storeSession() result", { stored, shopDomain2 });
  if (!stored) {
    throw new Error("sessionStorage.storeSession() returned false");
  }

  const ctx3 = await upsertInstalledShop(session.shop);
  log("4b. upsertInstalledShop() called with session.shop (auth.$.tsx's exact call shape)", ctx3);

  const sessionRows = await sequelize.query(
    `SELECT id, shop FROM shopify_sessions WHERE shop = :shopDomain2;`,
    { replacements: { shopDomain2 }, type: QueryTypes.SELECT },
  );
  const shopRows2 = await sequelize.query(
    `SELECT id, shop_domain, installed_at FROM shop WHERE shop_domain = :shopDomain2;`,
    { replacements: { shopDomain2 }, type: QueryTypes.SELECT },
  );
  log("4c. Independent confirmation: session row + shop row both exist and agree", {
    sessionRows,
    shopRows2,
  });
  if (sessionRows.length !== 1) {
    throw new Error("Expected exactly 1 shopify_sessions row for the fresh domain");
  }
  if (shopRows2.length !== 1) {
    throw new Error("Expected exactly 1 shop row for the fresh domain (post-install step)");
  }
  const shopRow2 = shopRows2[0] as { installed_at: Date | null };
  if (shopRow2.installed_at === null) {
    throw new Error("installed_at is null on the post-session-storage install path");
  }

  // --- 5. Cleanup — leave the shared dev database exactly as found -------
  await sequelize.query(`DELETE FROM shop WHERE shop_domain IN (:d1, :d2);`, {
    replacements: { d1: shopDomain, d2: shopDomain2 },
  });
  await sessionStorageInstance.deleteSession(offlineSessionId);

  const residualShopRows = await sequelize.query(
    `SELECT count(*)::int AS c FROM shop WHERE shop_domain IN (:d1, :d2);`,
    { replacements: { d1: shopDomain, d2: shopDomain2 }, type: QueryTypes.SELECT },
  );
  const residualSessionRows = await sequelize.query(
    `SELECT count(*)::int AS c FROM shopify_sessions WHERE shop = :d2;`,
    { replacements: { d2: shopDomain2 }, type: QueryTypes.SELECT },
  );
  log("5. Cleanup confirmation (expect c:0 both)", { residualShopRows, residualSessionRows });
  if ((residualShopRows[0] as { c: number }).c !== 0) {
    throw new Error("Cleanup failed to remove seeded shop rows");
  }
  if ((residualSessionRows[0] as { c: number }).c !== 0) {
    throw new Error("Cleanup failed to remove seeded session row");
  }

  log("RESULT", "ALL CHECKS PASSED — fresh-domain install, idempotent reinstall, and the " +
    "post-install session-storage + shop-row sequence all work end-to-end. Cleanup verified.");

  await sequelize.close();
}

main()
  .then(() => {
    console.log("\nEXIT:0");
    process.exit(0);
  })
  .catch((err) => {
    console.error("\nEXIT:1", err);
    process.exit(1);
  });
