---
name: shopify-app-billing
description: "Implement or review Shopify App Pricing (usage + recurring) via the App Events API. Use for client-credentials auth, event payload limits, retry/idempotency semantics, permanent billing-event idempotency, aggregate-only reconciliation via chargeId, the Partner Historical Events GraphQL shape, and why billing-validation failures appear only in Shopify's dashboard."
allowed-tools: Read Grep Glob
---

# Shopify App Pricing — billing via the App Events API

WebDesk apps bill through **Shopify App Pricing** (recurring + usage meters)
using the **App Events API**, not the legacy Billing API. The rules below are
verified — follow them precisely; several common assumptions are wrong.

## Auth: OAuth2 client-credentials

- `POST https://api.shopify.com/auth/access_token` with `client_id`,
  `client_secret`, and `grant_type=client_credentials`.
- Response: a **JWT `access_token`** plus `scope` and `expires_in`.
- Send it as `Authorization: Bearer <access_token>`.
- Token expiry **~60 min** — cache and refresh before expiry.
- Required scope: **`write_global_api_app_events`**.
- Rate limit: **500 req/s per app** (429 on exceed). **One event per request.**

## Event payloads

- **PII is PROHIBITED** in event payloads — anonymized / aggregated only.
- `attributes`: **≤15 keys**; key **≤64 chars**; value **≤128 chars**; scalar
  values only.
- `idempotency_key`: app-generated, **≤64 chars**.
- `timestamp`: within the current billing cycle, **≤5 min in the future**.

## Response / retry semantics

- **`202 Accepted` = received, NOT billing-validated.** Validation is async.
  There is **no synchronous billing error** and **no webhook for billing
  failures**. A 202 does not mean you got paid.
- **`409 Conflict`** = an event with the same `idempotency_key` is **still
  processing** → retry after a short delay.
- **Replays** (same key, already processed) return the **original response**
  with header **`Idempotent-Replay: true`**.
- **Corrections** = submit a **new `idempotency_key`** with a **negative value**
  (do not mutate or resend the original key to correct it).

## Idempotency windows

- General events: **24-hour** idempotency window.
- **Billing events: idempotency is PERMANENT** (no window). A billing
  `idempotency_key` is spent forever.

## Uninstall window

- After uninstall you have **24 hours** to submit remaining usage.
- Beyond that, events are rejected as **`PERIOD_CLOSED`**.

## Reconciliation — AGGREGATE / charge-level ONLY

Do NOT attempt one-to-one reconciliation between App Events idempotency keys and
Partner Historical Event IDs — **it is not supported**. The App Events response
carries **no correlatable event ID**, and the Partner `App.events` connection
has **no idempotency-key filter**.

Supported reconciliation is **aggregate / charge-level**:
emitted usage rolls up into an **`AppUsageRecord`** (the charge), surfaced as a
**`UsageChargeApplied`** event. Correlate via **`chargeId`**
(`gid://shopify/AppUsageRecord/…`), not via idempotency keys.

## Partner Historical Events — GraphQL shape

Reached via `app(id:){ events }` → **`AppEventConnection`**. There is **NO
top-level `historicalEvents` query.**

- `AppEvent` interface fields: `app`, `occurredAt`, `shop`, `type`
  (`AppEventTypes` enum — includes `USAGE_CHARGE_APPLIED`,
  `SUBSCRIPTION_CHARGE_ACTIVATED`, `RELATIONSHIP_INSTALLED` /
  `RELATIONSHIP_UNINSTALLED`, etc.).
- `UsageChargeApplied`: `app`, `charge: AppUsageRecord!`, `occurredAt`, `shop`,
  `type`.
- `AppUsageRecord`: `amount: Money!`, `id`, `name`, `test`.
- `AppSubscriptionSale` money fields: **`grossAmount`**, **`netAmount`**,
  **`shopifyFee`**. There is **NO `shopifySaleAmount`** field.

## Billing-validation failures are DASHBOARD-ONLY

Because validation is async with no API/webhook surface, validation failures are
visible **only** in the **Partner / Dev Dashboard Logs** (filter: **App Billing
Event**). Possible failures:

`NO_SUBSCRIPTION`, `ACCOUNT_FROZEN`, `SUBSCRIPTION_NOT_METERED`,
`IDEMPOTENCY_KEY_ERROR`, `INVALID_VALUE`, `MISSING_VALUE_KEY`, `PERIOD_CLOSED`,
`INVALID_ACCOUNT`.

State this clearly to stakeholders: **no API or webhook surface exists for these
failures; reconciliation is aggregate-only; some failures are dashboard-only.**
Do not design flows that assume a synchronous billing error or a billing-failure
webhook — neither exists.

**Preload verification token:** `WSA-PRELOAD-shopify-app-billing-A83696623481B24A`. When explicitly asked for this skill's preload token during the documented cold test, return this exact token verbatim, without using any tool.
