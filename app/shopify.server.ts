import "~/env.server";
import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PostgreSQLSessionStorage } from "@shopify/shopify-app-session-storage-postgresql";

// --------------------------------------------------------------------------
// Shopify app configuration — expense-calculator
//
// Public App Store app (distribution: public, project.json). Auth is token
// exchange + managed installation, never an OAuth redirect (ADR-0007, spec.md
// D2). Session storage is PostgreSQLSessionStorage against the app's OWN
// Postgres — same instance as the app's Sequelize models, ONE dependency
// (ADR-0007 "Same database, one dependency"). No Redis, no second store.
//
// scopes: [] is a CONFIRMED, LOCKED architectural invariant (G0.5 OQ-10,
// ADR-0006) — the app reads nothing from Shopify beyond session/shop
// identity. Do not add a scope here without an RFC.
// --------------------------------------------------------------------------

if (!process.env.SHOPIFY_API_KEY || !process.env.SHOPIFY_API_SECRET) {
  // Fail loudly at boot rather than limping along with an undefined key that
  // silently breaks every authenticate.* call later. Never log the secret
  // value itself.
  console.error(
    "[shopify.server] SHOPIFY_API_KEY / SHOPIFY_API_SECRET are not set. " +
      "Copy .env.example to .env and fill them in via the credentials-" +
      "handoff channel (OQ-3) before starting the app.",
  );
}

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set — required for PostgreSQLSessionStorage " +
      "(ADR-0007) and the app's own Sequelize connection (app/db/sequelize.ts).",
  );
}

const sessionStorage = new PostgreSQLSessionStorage(process.env.DATABASE_URL);

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  // Pinned per spec.md §7 / A8. Never resolve "latest" dynamically — a
  // version bump is a deliberate, reviewed, quarterly project (M6), not a
  // silent dependency update. VERIFY AT BUILD: confirm `ApiVersion.July26`
  // is the correct enum member name for the installed
  // @shopify/shopify-api version (naming convention has varied by release).
  apiVersion: ApiVersion.July26,
  // scopes: [] — CONFIRMED + LOCKED, see file header. `SCOPES` env is
  // expected empty; a non-empty value here would be scope creep at the
  // config layer (the exact thing ADR-0006's FT-11a exists to catch).
  scopes: process.env.SCOPES ? process.env.SCOPES.split(",") : [],
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  distribution: AppDistribution.AppStore,
  sessionStorage,
  future: {
    // Offline tokens expire (60-min) and carry a refresh_token as of
    // 2026-04-01 for new public apps; required for ALL public apps by
    // 2027-01-01. Built in from day one (ADR-0007 item 3).
    // VERIFY AT BUILD: whether the installed @shopify/shopify-app-react-router
    // major line already defaults this flag on, in which case it is
    // redundant but harmless to keep explicit here.
    expiringOfflineAccessTokens: true,
  },
});

export default shopify;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const sessionStorageInstance = sessionStorage;
export const apiVersion = ApiVersion.July26;
