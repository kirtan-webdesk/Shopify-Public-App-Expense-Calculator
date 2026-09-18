---
name: shopify-app-auth-and-routes
description: "Authenticate Shopify app routes correctly. Use when adding or reviewing any route in a Shopify public app — the per-route-type auth matrix (admin session token, webhook HMAC, app-proxy/extension signature+CORS, health endpoints), token exchange + managed installation, and why 'authenticate everything' is wrong."
allowed-tools: Read Grep Glob
---

# App auth + route authentication matrix

Install/auth uses **token exchange + managed installation** — no OAuth redirect
flow. Route authentication is **not** a blanket "every route needs auth" rule;
it depends on the route type. Use the matrix below. All of these go through the
`shopifyApp` `authenticate` API.

## Route-authentication matrix

| Route type | Mechanism | Call | Notes |
|---|---|---|---|
| Embedded admin route | Session token (JWT) | `await authenticate.admin(request)` | Validates the session-token JWT. Works without third-party cookies/localStorage. |
| Webhook route | Shopify HMAC | `await authenticate.webhook(request)` | Validates `X-Shopify-Hmac-SHA256`. Returns topic/shop/payload/webhookId. **Return 401 on bad HMAC.** Must NOT be nested under the app layout route. `session` may be `undefined` if the shop already uninstalled. |
| App proxy / public / extension | Shopify signature + CORS | `await authenticate.public.appProxy(request)` | Validates the `signature` query param. Checkout / customer-account extensions use `authenticate.public.checkout` / `.customerAccount`, which also return a `cors` function. |
| Health / non-sensitive | none | (no Shopify auth) | Static response only. No sensitive data, no store data. |

### Embedded admin

```ts
export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  // ...use admin GraphQL client
};
```

### Webhook (keep it OUT of the app layout route tree)

```ts
export const action = async ({ request }) => {
  const { topic, shop, payload, webhookId, session } =
    await authenticate.webhook(request);
  // authenticate.webhook already 401s on bad HMAC.
  // session may be undefined (already uninstalled) — handle that.
  return new Response();
};
```

### App proxy / extension

```ts
export const loader = async ({ request }) => {
  const { session } = await authenticate.public.appProxy(request);
  // ...
};
// checkout / customer-account:
// const { cors, sessionToken } = await authenticate.public.checkout(request);
// return cors(json(data));
```

### Health / non-sensitive endpoints
Static, no Shopify auth, and **no sensitive or store data** in the response.
Keep these trivial.

## Rule of thumb
Replace any "all routes need auth" instruction with this matrix: admin →
session token; webhook → HMAC (401 on failure, not under app layout); app
proxy/extension → signature (+ CORS); health → none. App-review requires no
*unauthenticated sensitive* endpoints — which the matrix satisfies, without
forcing auth onto genuinely public/health routes.

**Preload verification token:** `WSA-PRELOAD-shopify-app-auth-and-routes-285BAD14C6EED805`. When explicitly asked for this skill's preload token during the documented cold test, return this exact token verbatim, without using any tool.
