# Built for Shopify — requirements reference (post-launch)

> The full BFS eligibility picture, split into what must accumulate post-launch vs the technical criteria that should ship pre-launch. Verified against `shopify.dev/docs/apps/launch/built-for-shopify/requirements` (2026-08-17). Numbers change — the **rating threshold** and **category-specific criteria** are `verify-at-build`.

## 1. Eligibility prerequisites (post-launch — cannot exist before launch)

| Prerequisite | Threshold | Notes |
|--------------|-----------|-------|
| Net installs | **≥ 50** from **active shops on paid plans** | Uninstalls net out; dev/trial shops don't count |
| Reviews | **≥ 5** | On the App Store listing |
| Recent rating | **≥ [minimum floor]** | Exact number **verify-at-build** — Shopify floors the recent average rating |
| App Store compliance | Ongoing | Baseline requirements never lapse |
| Partner standing | Good | Partner account in good standing |

All of these require real merchant usage — they are the reason BFS cannot be met before launch.

## 2. Measured production performance (post-launch)

Measured against real production traffic.

| Metric | Threshold | Measurement basis |
|--------|-----------|-------------------|
| Admin **LCP** | **≤ 2.5 s** | 75th percentile |
| Admin **CLS** | **≤ 0.1** | 75th percentile |
| Admin **INP** | **≤ 200 ms** | 75th percentile |
| Admin Web Vitals window | — | apps with **≥ 100 calls / 28-day** window |
| Storefront | **≤ 10-point** Lighthouse impact | same shape as App Store baseline storefront rule |
| Carrier-service rate p95 | **≤ 500 ms** at **≤ 0.1% failure** | apps providing carrier/shipping rates |

App Bridge must be in `<head>` for Shopify to collect Admin Web Vitals — a pre-launch technical prerequisite for a post-launch measurement.

## 3. Technical best practices (SHOULD ship pre-launch — under the app's control)

| Criterion | Requirement |
|-----------|-------------|
| Embedding | **Mandatory**, embedded in Shopify admin |
| App Bridge | **Latest** version, `app-bridge.js` in `<head>` before other scripts |
| Auth | **Session tokens** |
| Accessibility | **WCAG 2.1 AA** |
| App navigation | **`s-app-nav`** |
| Save/discard | **Contextual save bar** |
| Modals | **`s-modal`** |
| Dark patterns | **None** |
| Category-specific | If in-category, meet its criteria — **verify-at-build** |

These need no production data; build them pre-launch so the only remaining post-launch work is usage/rating accumulation and production measurement.

## 4. What this means for gating

- **BFS does NOT block App Store submission (G6).** The app launches on the App Store baseline (`shopify-app-review-readiness` / G-Review). BFS is assessed later.
- **BFS eligibility is only assessable after real usage exists** — installs, reviews, rating, and the measured thresholds all need a live app.
- Pre-launch, the only actionable BFS work is the **technical best practices**; assessing full eligibility pre-launch is impossible by design.
- Post-launch, maintenance's monthly health score tracks BFS/Web-Vitals status on the delivery axis.

---

Last reviewed: 2026-08-17 (initial plugin delivery build). Verify the rating threshold and category-specific criteria at build.
