import { type RouteConfig, index, route } from "@react-router/dev/routes";

// --------------------------------------------------------------------------
// Route-authentication matrix (shopify-app-auth-and-routes skill — no
// deviation):
//   app.*        -> authenticate.admin (session-token JWT), under the
//                   `app` layout route
//   auth.$       -> token exchange + managed installation
//   webhooks.*   -> authenticate.webhook (HMAC, 401 on invalid) — MUST NOT
//                   be nested under the app layout route (ADR-0002 /
//                   architecture packet §3)
//   healthz      -> no auth, static-shaped, reports a cronStale boolean
//                   (ADR-0009 D6)
//   api/cron/tick -> internal shared-secret (constant-time Bearer compare,
//                   fails closed if CRON_SECRET is unset) — a 5th
//                   route-auth class, never Shopify auth, never the
//                   unauthenticated allowlist (ADR-0009 D5)
//
// Webhook routes are declared as top-level `route()` entries, sibling to —
// never nested inside — the `layout("routes/app.tsx", ...)` block below, so
// they never pick up authenticate.admin or any app-layout concern.
// --------------------------------------------------------------------------
//
// Root "/" (routes/_index.tsx) is the bare `application_url` Shopify Admin's
// iframe navigates to on the very first embedded load (before it ever knows
// about /app) — see routes/_index.tsx for the full explanation (BUG fix:
// "Invalid path /" on fresh embedded install). No Shopify auth call happens
// there; it only redirects on into /app/calculator, preserving the query
// string that authenticate.admin() and App Bridge need downstream.
// --------------------------------------------------------------------------

export default [
  index("routes/_index.tsx"),

  route("healthz", "routes/healthz.tsx"),

  // Slow-tier cron endpoint (ADR-0009 D3) — sibling to the webhook/healthz
  // routes, never nested under the app layout route (would pick up
  // authenticate.admin, which is the wrong auth class entirely for a
  // platform-triggered request).
  route("api/cron/tick", "routes/api.cron.tick.tsx"),

  route("auth/*", "routes/auth.$.tsx"),

  route("webhooks/app-uninstalled", "routes/webhooks.app-uninstalled.tsx"),
  route("webhooks/customers-data-request", "routes/webhooks.customers-data-request.tsx"),
  route("webhooks/customers-redact", "routes/webhooks.customers-redact.tsx"),
  route("webhooks/shop-redact", "routes/webhooks.shop-redact.tsx"),

  // Mounted at /app — the conventional embedded-admin path Shopify's iframe
  // navigates to (matches the "/auth" authPathPrefix convention).
  route("app", "routes/app.tsx", [
    index("routes/app._index.tsx"),
    route("calculator", "routes/app.calculator.tsx"),
    route("rules", "routes/app.rules.tsx"),
    route("results", "routes/app.results.tsx"),
    route("history", "routes/app.history.tsx"),
    route("history/:id", "routes/app.history.$id.tsx"),
  ]),
] satisfies RouteConfig;
