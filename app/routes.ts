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
//   healthz      -> no auth, static, no store data
//
// Webhook routes are declared as top-level `route()` entries, sibling to —
// never nested inside — the `layout("routes/app.tsx", ...)` block below, so
// they never pick up authenticate.admin or any app-layout concern.
// --------------------------------------------------------------------------

export default [
  route("healthz", "routes/healthz.tsx"),

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
    route("results", "routes/app.results.tsx"),
    route("history", "routes/app.history.tsx"),
    route("history/:id", "routes/app.history.$id.tsx"),
  ]),
] satisfies RouteConfig;
