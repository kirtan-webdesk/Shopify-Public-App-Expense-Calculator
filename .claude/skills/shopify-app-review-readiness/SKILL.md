---
name: shopify-app-review-readiness
description: "The G-Review gate — the BLOCKING, PRE-SUBMISSION App Store baseline checklist a Shopify public app must pass before Submit (G6). Covers the mandatory Shopify App Store requirements (OAuth/managed install, session-token auth, latest App Bridge, GraphQL Admin API, 3 compliance webhooks with 401-on-bad-HMAC and linked privacy policy, Shopify Billing, TLS, minimal scopes, no critical errors, no dark patterns, listing rules) plus WebDesk blocking checks (GDPR webhooks that ACTUALLY delete and a customers/data_request that acks then delivers to the store owner, no unauthenticated sensitive/protected routes, no credentials in responses). Use before opening G6 or when reviewing App Store submission readiness. This is the App Store BASELINE — not Built for Shopify; there are no Web Vitals thresholds at baseline."
allowed-tools: Read Grep Glob
---

# G-Review — App Store Review Readiness (blocking, pre-submission)

> **G-Review is the BLOCKING internal gate run before Submit (G6).** It is the baseline every Shopify public app must clear to pass Shopify's App Store review — so we verify it first and never submit something that will bounce. It sits **after G5.5 (observability)** and **before G6**. Approved by Delivery head + Tech lead. **You do not open G6 until every item here is green.**
>
> This is the **App Store baseline**, not Built for Shopify. Built for Shopify is a **separate, post-launch** eligibility program (see the `shopify-built-for-shopify` skill) and does **not** gate submission. At baseline there are **no Web Vitals thresholds** — the only performance rule is that storefront apps should not drop a theme's Lighthouse score by more than 10 points.

Verified against `shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements` (2026-08-17). Shopify's requirements change; flag anything version-specific as `verify-at-build`. Full itemized checklist in `reference/checklist.md`.

---

## Mandatory Shopify App Store requirements (all must pass)

1. **Install & auth flow.** OAuth / managed installation begins **immediately after the app is installed**, and install is **initiated from a Shopify surface** (App Store listing or admin) — not from an off-Shopify page.
2. **Session-token authentication.** The app authenticates with **session tokens** and works **without third-party cookies, without localStorage, and in incognito** (do not rely on cookie/localStorage-based sessions).
3. **Latest App Bridge, loaded first.** The app loads the **latest App Bridge** with `app-bridge.js` in the `<head>` **before any other scripts**, and presents a **consistent embedded experience** inside Shopify admin.
4. **GraphQL Admin API.** The app uses the **GraphQL Admin API**; the REST Admin API is legacy and not used for new public apps.
5. **Compliance webhooks (all 3) + HMAC + privacy policy.** The app subscribes to and correctly handles the **three mandatory compliance webhooks** — `customers/data_request`, `customers/redact`, `shop/redact` — with **verified HMAC** (a request with a bad HMAC returns **401**), and links a **privacy policy** in the listing.
6. **Billing through Shopify.** All charges go through the **Shopify Billing API / App Pricing**. **Off-platform / off-Shopify billing is prohibited.**
7. **Valid TLS/SSL.** The app is served over a valid, current TLS/SSL certificate.
8. **Minimal scopes.** The app requests only the **scopes it actually uses** (least privilege).
9. **No critical errors.** No critical **300 / 404 / 500** errors in the core flows.
10. **No dark patterns.** No deceptive UI, forced actions, or manipulative flows.
11. **Listing rules.** The App Store listing complies (accurate name/description/screenshots, pricing copy that matches what the app charges, required assets present).

---

## WebDesk blocking checks (on top of Shopify's baseline)

These are the checks that most often pass a naive review but fail Shopify's — we treat them as hard blockers:

- **GDPR webhooks must ACTUALLY delete data.** `customers/redact` and `shop/redact` perform **real deletion** (verified against a **seeded store** — a `200` stub that deletes nothing **fails**); `customers/data_request` **acknowledges with an empty/minimal 2xx and then delivers the requested information directly to the store owner within 30 days** (async completion, no PII echoed in the response body). QA verifies the real deletion and the follow-through, not a status code.
- **No unauthenticated SENSITIVE or protected routes.** Every admin/sensitive route authenticates per the route-authentication matrix (admin → session token; webhook → HMAC; app-proxy/extension → signature; see `shopify-app-auth-and-routes`). The blocker is an unauthenticated **sensitive or protected** route — an explicitly-allowed **static, non-sensitive health endpoint** that returns no store data is fine. QA **probes each sensitive/protected endpoint unauthenticated** and expects rejection.
- **No credentials in any response.** Access tokens, API keys, and secrets never appear in any response body. QA **scans responses**.

---

## Performance at baseline — no Web Vitals thresholds

The **only** performance requirement at App Store baseline: a **storefront app should not drop a theme's Lighthouse score by more than 10 points**. There are **NO Admin Web Vitals thresholds (LCP/CLS/INP) at baseline** — those belong to the separate, post-launch Built for Shopify program. Do not gate submission on Web Vitals numbers.

---

## How this gate runs

- **Blocking:** G-Review must be fully green before G6 opens. A red G-Review that ships is the worst failure mode of a public-app build.
- **Pre-submission:** it runs **before** the app is submitted, so we catch what Shopify would reject.
- **Approvers:** Delivery head + Tech lead (approver ≠ doer — no self-approval).
- **Evidence-based:** each item needs evidence (a seeded-store deletion test, an unauthenticated probe result, a response scan, the App Bridge `<head>` position, the scope diff, the billing-vs-listing comparison, the compliance-webhook 401-on-bad-HMAC test). A checklist ticked without evidence is not a pass.
- **Result artifact:** `review-readiness/app-review-readiness.md`. Protected-customer-data details (if protected scopes) live in `review-readiness/protected-customer-data.md` and are handled by the **external G-PCD** gate, which must clear before G6 — G-Review does not replace G-PCD.

---

## Relationship to the other gates

- **Comes after** G5.5 (observability + runbooks present).
- **Comes before** G6 (Submit → external Shopify review). Blocking.
- **Does not include** Built for Shopify criteria — that is `shopify-built-for-shopify`, post-launch, non-blocking for submission.
- **In maintenance & api-version-upgrade**, G-Review is not re-run for routine work, but its **invariants are never allowed to regress** (GDPR webhooks still delete and `customers/data_request` still delivers to the store owner, no unauthenticated sensitive/protected routes, no creds in responses, App Bridge still in `<head>`, scopes still minimal). A ticket that would break one is not routine.

---

Last reviewed: 2026-08-17 (initial plugin delivery build). Verify Shopify requirement specifics at build — they change.

**Preload verification token:** `WSA-PRELOAD-shopify-app-review-readiness-EBD914B2298BA788`. When explicitly asked for this skill's preload token during the documented cold test, return this exact token verbatim, without using any tool.
