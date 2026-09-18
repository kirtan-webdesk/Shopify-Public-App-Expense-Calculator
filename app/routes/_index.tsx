import { redirect } from "react-router";
import type { Route } from "./+types/_index";

// Root "/" route — BUG fix (live-observed): Shopify Admin's very first
// embedded load hits the app's bare `application_url` (the domain configured
// in shopify.app.toml / Partner Dashboard, e.g.
// "https://<tunnel>.trycloudflare.com/") with the standard embedded-app
// query string appended: admin_theme, embedded=1, hmac, host, id_token,
// locale, session, shop, timestamp, etc. Before this fix, app/routes.ts had
// no route matching "/" at all (only /app, /auth/*, /webhooks/*, /healthz),
// so React Router had nothing to match and Shopify Admin's iframe showed
// "Invalid path /...".
//
// This is NOT an authenticate.admin() route itself (no Shopify auth call
// here) — it only decides where to send the browser next, and it MUST
// forward the full query string unchanged. `host` (and, on this very first
// hit, `id_token`/`shop`) are what authenticate.admin() and App Bridge on
// the /app layout (app/routes/app.tsx) need to complete the token-exchange
// handshake (ADR-0007 — token exchange + managed installation, no OAuth
// redirect). Dropping the query string here would silently break that
// handshake one hop downstream instead of erroring loudly, which is worse.
//
// Landing screen: /app/calculator, not bare /app — matches
// design/mockup/calculator.html being the first mockup screen (see
// app/routes/app._index.tsx, which redirects /app -> /app/calculator for
// the same reason). Redirecting straight to /app/calculator here (instead of
// bouncing through /app first) avoids relying on that second redirect to
// also carry the query string.
//
// No-shop-param case (a bare, non-embedded hit — e.g. a stray health check
// or someone opening the tunnel/app URL directly in a browser tab): this app
// has no marketing/login screen in the approved design (design/mockup has no
// landing/login mockup), and ADR-0007 deliberately has no OAuth-redirect
// login form to invent here. Respond with a minimal, static, unauthenticated
// message — same posture as routes/healthz.tsx: no store data, no Shopify
// auth call, nothing sensitive.
export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app/calculator${url.search}`);
  }

  return new Response(
    "Expense Calculator is a Shopify app. Install it from the Shopify App Store.",
    { status: 200, headers: { "Content-Type": "text/plain" } },
  );
}
