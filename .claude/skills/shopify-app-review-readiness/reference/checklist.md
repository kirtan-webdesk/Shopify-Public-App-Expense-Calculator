# G-Review — itemized App Store readiness checklist

> The evidence-backed checklist for the blocking, pre-submission G-Review gate. CONFIRM requires **every** box green **with evidence**. Verified against `shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements` (2026-08-17); Shopify's requirements change — treat version-specific specifics as `verify-at-build`.

## A. Install & authentication

- [ ] **OAuth / managed install fires immediately after install** — evidence: install flow recording; no dead-end after install.
- [ ] **Install initiated from a Shopify surface** (App Store listing or admin), not an off-Shopify page.
- [ ] **Session-token auth** — the app uses session tokens; works with **third-party cookies blocked, no localStorage dependence, and in incognito**. Evidence: an incognito / cookies-blocked run.
- [ ] **No unauthenticated sensitive/protected routes** (WebDesk blocker) — every admin/sensitive route authenticates per the route-authentication matrix (admin → session token; webhook → HMAC; app-proxy/extension → signature); an explicitly-allowed static, non-sensitive health endpoint returning no store data is fine. Evidence: unauthenticated probe per sensitive/protected endpoint → all rejected.
- [ ] **No credentials in responses** (WebDesk blocker) — no access tokens, API keys, or secrets in any response body. Evidence: response scan.

## B. Embedding & API

- [ ] **Latest App Bridge, `app-bridge.js` in `<head>` before other scripts** — evidence: rendered `<head>` shows App Bridge first.
- [ ] **Consistent embedded experience** inside Shopify admin.
- [ ] **GraphQL Admin API** used (REST Admin API is legacy; not used for new public apps).

## C. Compliance webhooks & privacy

- [ ] **All 3 mandatory compliance webhooks subscribed** — `customers/data_request`, `customers/redact`, `shop/redact`.
- [ ] **HMAC verified; bad HMAC → 401** — evidence: a request with an invalid HMAC returns 401.
- [ ] **GDPR webhooks ACTUALLY delete data** (WebDesk blocker) — `customers/redact` + `shop/redact` perform real deletion; `customers/data_request` **acks with an empty/minimal 2xx then delivers the requested information directly to the store owner within 30 days** (async, no PII in the response body). Evidence: seeded-store test proving deletion (a 200 stub that deletes nothing **fails**) + the data-request delivery path.
- [ ] **Privacy policy linked** in the listing.

## D. Billing

- [ ] **Billing via Shopify Billing API / App Pricing** — no off-platform billing.
- [ ] **Billing matches the listing** — App Pricing plans equal the listing's pricing copy and what the app actually charges.
- [ ] **Usage models self-enforce** — App Pricing has no usage cap, so any usage component ships a per-merchant spend-limit guard and a Historical-API reconciliation job.

## E. Security & correctness

- [ ] **Valid TLS/SSL** certificate, current.
- [ ] **Minimal / least-privilege scopes** — no scope requested that the app doesn't use. Evidence: scope-vs-usage diff.
- [ ] **No critical 300 / 404 / 500 errors** in core flows.
- [ ] **No dark patterns** — no deceptive, forced, or manipulative UI.

## F. Listing

- [ ] **Listing rules met** — accurate name, description, screenshots; required assets present; pricing copy accurate.

## G. Performance (baseline only)

- [ ] **Storefront apps: no Lighthouse drop > 10 points** on the theme. **NO Admin Web Vitals thresholds at baseline** — LCP/CLS/INP thresholds are Built for Shopify (post-launch), not App Store submission. Do not gate submission on Web Vitals numbers.

---

## Approval

- Approvers: **Delivery head + Tech lead** (approver ≠ doer).
- Result written to `review-readiness/app-review-readiness.md`.
- **Blocking:** do not open G6 until all boxes are green.
- Protected-customer-data handling (if protected scopes) is the **separate external G-PCD** gate (`review-readiness/protected-customer-data.md`), which must clear before G6 — G-Review does not replace it.

---

Last reviewed: 2026-08-17 (initial plugin delivery build).
