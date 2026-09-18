---
name: shopify-built-for-shopify
description: "The SEPARATE, POST-LAUNCH Built for Shopify (BFS) eligibility gate — distinct from App Store submission and does NOT block it. BFS cannot be met before launch: prerequisites need ≥50 net installs from active shops on paid plans, ≥5 reviews, a minimum recent rating, ongoing App Store compliance, and good Partner standing, plus MEASURED production performance (Admin Web Vitals LCP/CLS/INP, storefront Lighthouse, carrier p95). Use post-launch when assessing BFS eligibility, or pre-launch to implement the technical BFS best practices (embedding, latest App Bridge, session tokens, WCAG 2.1 AA, Polaris UX, no dark patterns) that SHOULD ship before launch even though eligibility is measured later."
allowed-tools: Read Grep Glob
---

# Built for Shopify — post-launch eligibility (separate from submission)

> **Built for Shopify (BFS) is a distinct program from App Store submission.** It is the higher-tier badge/status an app can earn **after it launches and accumulates real usage**. **BFS does NOT block App Store submission (G6)** — an app launches on the App Store baseline (see `shopify-app-review-readiness`) and only later becomes eligible for BFS. Do not conflate the two gate sets.
>
> **CRITICAL: BFS cannot be met before launch.** Its prerequisites and its measured performance thresholds all require **real production usage that does not exist pre-launch.** What *can* and *should* ship pre-launch are the **technical** BFS best practices (below). Everything install/review/rating-based and everything measured against production traffic is strictly **post-launch**.

Verified against `shopify.dev/docs/apps/launch/built-for-shopify/requirements` (2026-08-17). BFS criteria change; treat specific numbers — especially the rating threshold and category-specific criteria — as `verify-at-build`. Full detail in `reference/requirements.md`.

---

## Prerequisites (post-launch — cannot exist before launch)

An app becomes **eligible to be assessed** for BFS only once all of these hold:

- **≥ 50 net installs** from **active shops on paid plans**.
- **≥ 5 reviews**.
- **A minimum recent rating threshold** — exact number **verify-at-build** (Shopify sets a floor on the recent average rating).
- **Ongoing App Store compliance** — the app continues to meet all App Store requirements (the baseline never lapses).
- **Good Partner standing** — the Partner account is in good standing.

None of these can be manufactured pre-launch; they are the reason BFS is a post-launch gate.

---

## Measured production performance thresholds (post-launch)

These are measured against **real production traffic** and therefore only exist after launch:

- **Admin Web Vitals** — 75th percentile, over apps with **≥ 100 calls in a 28-day window**:
  - **LCP ≤ 2.5 s**
  - **CLS ≤ 0.1**
  - **INP ≤ 200 ms**
- **Storefront** — **≤ 10-point Lighthouse** impact (same shape as the App Store baseline storefront rule).
- **Carrier-service rate requests** — **p95 ≤ 500 ms** at a **≤ 0.1% failure rate** (for apps that provide carrier/shipping rates).

App Bridge must be in `<head>` for Shopify to collect Web Vitals at all — so the technical prerequisite for these measurements ships pre-launch even though the measurement happens post-launch.

---

## Technical BFS best practices — SHOULD ship pre-launch

These are engineering criteria under the app's control that do **not** require production data. Implement them **before launch** so the app is ready to qualify as soon as the usage prerequisites are met:

- **Mandatory embedding** with the **latest App Bridge** + **session tokens** (embedded admin experience).
- **WCAG 2.1 AA** accessibility.
- **`s-app-nav`** for app navigation.
- **Contextual save bar** for save/discard actions.
- **`s-modal`** for modals.
- **No dark patterns.**
- **Category-specific criteria** if the app is in a category that has them (**verify-at-build**).

Building these pre-launch is free leverage — they overlap heavily with good App Store baseline hygiene and remove all the *technical* work from the post-launch BFS push, leaving only the usage/rating accumulation and the production measurement.

---

## The split to state clearly

- **Pre-launch (do it now):** the technical best practices — embedding, latest App Bridge, session tokens, WCAG 2.1 AA, `s-app-nav`, contextual save bar, `s-modal`, Polaris UX, no dark patterns, category-specific technical criteria.
- **Strictly post-launch (cannot be gated pre-launch):** ≥50 installs, ≥5 reviews, the minimum rating, ongoing compliance + Partner standing, and every **measured** production threshold (Admin Web Vitals, storefront Lighthouse, carrier p95).

**BFS eligibility is only assessable after real usage exists.** This skill is used post-launch to assess eligibility, and pre-launch only to make sure the technical criteria are already satisfied.

---

## Relationship to the other gates

- **Not on the submission path.** BFS is not in the `Grooming → … → G6 → M6` sequence and does **not** block G6. See `shopify-public-app-delivery`.
- **App Store baseline is the submission gate** — that is `shopify-app-review-readiness` (G-Review), blocking and pre-submission. BFS is a separate, higher, later bar.
- **Maintenance watches BFS status.** The monthly health score's delivery axis tracks Built-for-Shopify/Web-Vitals status once the app is live; a slip there is a signal to act.

---

Last reviewed: 2026-08-17 (initial plugin delivery build). Verify the rating threshold and any category-specific criteria at build — they change.

**Preload verification token:** `WSA-PRELOAD-shopify-built-for-shopify-DA3C1EAF61DF9285`. When explicitly asked for this skill's preload token during the documented cold test, return this exact token verbatim, without using any tool.
