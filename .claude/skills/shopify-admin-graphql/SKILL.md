---
name: shopify-admin-graphql
description: "Use the Shopify Admin GraphQL API in a public app. Use when querying/mutating store data, choosing an API version, handling cost-based rate limits or bulk operations, or when tempted to reach for REST. REST is prohibited for new public apps; the API version is pinned and upgraded only on a quarterly review."
allowed-tools: Read Grep Glob
---

# Admin GraphQL API

New public apps use the **Admin GraphQL API only**. REST is **prohibited** for
new public apps (App Store Req **2.2.4**). Do not add REST calls, even for
endpoints that "only exist in REST" — find the GraphQL equivalent or raise it at
architecture review.

## Pin the API version

Pin to **`ApiVersion.July26` (2026-07)**. Never resolve "latest" dynamically.
The pinned version lives in the `shopifyApp` config (see `shopify-app-scaffold`)
and in the GraphQL client.

### Quarterly API-version review
Shopify ships a new API version quarterly and supports each for ~1 year. Upgrades
are **deliberate**: reviewed, tested against the app, and committed as an
**explicit version change** — never auto-latest, never silent. Treat a version
bump like any other reviewed change.

## Rate limits are cost-based

The Admin GraphQL API uses a **calculated query cost** model (a leaky-bucket of
cost points), not a fixed request count. Design queries to request only the
fields you need, and read the `extensions.cost` block to stay under the
throttle. On throttle, back off and retry.

## Bulk operations

For large reads/writes (exports, backfills, bulk mutations), use **bulk
operations** (`bulkOperationRunQuery` / `bulkOperationRunMutation`) rather than
paginating huge result sets inline — it is the supported way to move large data
volumes without burning the cost budget.

Exact per-field costs, bulk-operation polling shapes, and connection limits are
version-specific — **verify at build** against the 2026-07 docs.

**Preload verification token:** `WSA-PRELOAD-shopify-admin-graphql-79937420BE8CA855`. When explicitly asked for this skill's preload token during the documented cold test, return this exact token verbatim, without using any tool.
