# Shopify dev-store smoke test (NOT executed in the build sandbox)

> **Status: written, NOT run here.** This requires a **disposable Shopify Partner
> development store**, a created app (client id/secret), and a deployed or tunnelled
> app URL. The build sandbox has none of these. **Do not run against a production
> store.** Run this in your own Partner/dev environment and record results.

## Preconditions
- A Shopify Partner account + a **development store** (disposable).
- App created in the Partner Dashboard; `SHOPIFY_API_KEY`/`SHOPIFY_API_SECRET`/`SCOPES`/`SHOPIFY_APP_URL` set.
- App running (e.g. `shopify app dev`) with a public tunnel; Postgres reachable for `PostgreSQLSessionStorage`.

## Steps to verify (record PASS/FAIL + evidence each)
1. **Install** — install the app on the dev store via managed installation; confirm an offline session row is written to Postgres.
2. **Token refresh** — with `future.expiringOfflineAccessTokens` on, wait past the offline token's 60-min expiry (or force it) and confirm the library refreshes using `refreshToken`; the stored `refreshToken`/`refreshTokenExpires` update.
3. **Embedded home** — open the app in Shopify admin; confirm it renders embedded (iframe), App Bridge loads from `app-bridge.js` (with the `shopify-api-key` meta present before it), `<s-app-nav>` shows, no CSP/frame-ancestors errors.
4. **Webhook verification** — send a webhook with a valid HMAC → app processes; send one with a bad HMAC → app returns **401**.
5. **Uninstall** — uninstall the app; confirm `app/uninstalled` handled and the session is cleaned up.
6. **Privacy webhooks** — trigger `customers/data_request`, `customers/redact`, `shop/redact`; confirm each returns a quick 2xx with an **empty/minimal body (no PII)**, `customers/redact` and `shop/redact` **actually delete** the data, and `customers/data_request` delivers data to the store owner within 30 days (async ok). Verify bad HMAC → 401 on these too.

## Reporting
Record each step, the request/response evidence, and any deviation, then feed failures back via the WebDesk pilot feedback process.

## Known issue — `shopify app dev` may require an `[events]` block on a throwaway dev-app record

Reported against beta.5 (2026-08-23), **unrelated to the plugin's subagent-registration
defect**: `shopify app dev` refused to start against a throwaway Partner dev-app record with:
```
Validation error in shopify.app.<dev-app>.toml:
[events.subscription]: Required        (CLI 4.7.0)
[events]: Required                     (CLI 4.6.0, 4.5.0)
```
Downgrading the CLI did not resolve it. Diagnosis: the local CLI's TOML schema treats
`events` as optional — the requirement comes from a **server-side specification fetch**
against the unstable App Management API for that specific dev-app record, not from the
CLI itself. Whether an Events module is genuinely registered against that app record was
not conclusively determined (Partner Dashboard showed nothing Events-related, but the
dashboard may not surface a developer-preview feature).

**Workaround — disposable development-store app records ONLY, and only if the error still
reproduces on your CLI/account:**
```toml
[events]
api_version = "unstable"
subscription = []
```
An **empty** `subscription = []` satisfies the schema without declaring a fake webhook
topic — do **not** invent a subscription just to unblock startup. Confine this block to a
**test copy** of the dev-app TOML for a throwaway store; never add it to a production
`shopify.app.toml`, and never apply it to any app record without the team's explicit
approval. Before use, re-verify the error still reproduces on your installed CLI version —
Shopify may have since default this block or changed the App Management API contract.
