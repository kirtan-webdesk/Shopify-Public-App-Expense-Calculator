// healthz — the one intentionally unauthenticated route (route-auth matrix,
// shopify-app-auth-and-routes skill). Static body only. No store data, no
// shop identifiers, no Shopify auth call. Used by the hosting platform's
// health-check-gated rolling deploys (ADR-0001 requirement #4).

export async function loader() {
  return new Response("ok", {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}
