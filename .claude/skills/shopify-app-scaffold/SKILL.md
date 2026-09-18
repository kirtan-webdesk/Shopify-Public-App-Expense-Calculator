---
name: shopify-app-scaffold
description: "Scaffold or review a Shopify public app on the official React Router template. Use when setting up @shopify/shopify-app-react-router, wiring the shopifyApp config (distribution, pinned apiVersion, authPathPrefix), CSP/document headers, App Bridge in <head>, PostgreSQL session storage, or offline-token expiry/refresh."
allowed-tools: Read Grep Glob
---

# Shopify app scaffold (React Router template)

The current official template for a Shopify public app is the **React Router**
template (`@shopify/shopify-app-react-router`). The old Remix template is
deprecated — do not start from it.

## Server entry: shopifyApp config

```ts
import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PostgreSQLSessionStorage } from "@shopify/shopify-app-session-storage-postgresql";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET!,
  apiVersion: ApiVersion.July26,          // pinned to 2026-07 — see below
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL!,
  authPathPrefix: "/auth",                // must match the auth splat route
  distribution: AppDistribution.AppStore, // public App Store app
  sessionStorage: new PostgreSQLSessionStorage(process.env.DATABASE_URL!),
  future: {
    expiringOfflineAccessTokens: true,    // see "future flags" note
  },
});

export default shopify;
export const authenticate = shopify.authenticate;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
```

### Pin the API version — never resolve "latest"
`apiVersion: ApiVersion.July26` is pinned to **2026-07 on purpose**. Do NOT
dynamically resolve the latest version. Upgrades happen through the deliberate
**quarterly API-version review** (tested, then committed as an explicit version
change). See `shopify-admin-graphql`.

### `authPathPrefix` must match a real auth route
`authPathPrefix: "/auth"` requires a matching `$`/splat auth route (e.g.
`app/routes/auth.$.tsx`) whose loader calls:

```ts
export const loader = async ({ request }) => {
  await shopify.authenticate.admin(request);
  return null;
};
```

### `future.expiringOfflineAccessTokens`
Set explicitly here. In the v2-latest major line this flag **graduated to the
default**. Verify at build which major version of
`@shopify/shopify-app-react-router` the project uses — if it is a line where
this is already default, the flag is redundant but harmless; if it is an older
line, it is required to opt in.

## Session storage: PostgreSQL (WebDesk standard) — NOT Prisma

Use `@shopify/shopify-app-session-storage-postgresql` (`PostgreSQLSessionStorage`).
This is a **documented, supported deviation** from the template default
(Prisma/SQLite). WebDesk standard = **Postgres for sessions + Sequelize for app
data**. Do NOT use Prisma.

## Document headers (CSP) — required for embedding

Export and wire `addDocumentResponseHeaders`. It adds the required CSP headers
(including `frame-ancestors`) that let the app render embedded in the Shopify
admin. Wire it in `entry.server` so every document response carries them:

```ts
// entry.server.tsx
import { addDocumentResponseHeaders } from "./shopify.server";
// ...inside handleRequest, before returning the response:
addDocumentResponseHeaders(request, responseHeaders);
```

## App Bridge meta tag ordering

The App Bridge API-key `<meta>` MUST appear **before** the App Bridge script in
`<head>`:

```html
<meta name="shopify-api-key" content="%SHOPIFY_API_KEY%">
<script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
```

In the React Router template this ordering is produced for you by
`<AppProvider embedded apiKey={apiKey}>` — keep that provider; do not hand-roll
the tags out of order. (Polaris/App-Bridge-in-`<head>` details:
`shopify-polaris-app-bridge`.)

## Offline access tokens: expiry + refresh

- Offline tokens now expire (**60-minute** expiry) and come with a
  `refresh_token`.
- The `Session` carries `refreshToken` / `refreshTokenExpires`; the library
  refreshes for you when `expiringOfflineAccessTokens` is on.
- **Required for new public apps since 2026-04-01; required for all public apps
  by 2027-01-01.** Build with expiring offline tokens from day one.

## Auth model

Token exchange + managed installation (no OAuth redirect). Route-level auth is a
matrix, not a blanket rule — see `shopify-app-auth-and-routes`.

**Preload verification token:** `WSA-PRELOAD-shopify-app-scaffold-58FD62C32C706A31`. When explicitly asked for this skill's preload token during the documented cold test, return this exact token verbatim, without using any tool.
