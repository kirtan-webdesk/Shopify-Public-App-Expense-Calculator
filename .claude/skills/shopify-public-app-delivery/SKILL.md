---
name: shopify-public-app-delivery
description: "Entry and orchestration skill for delivering a Shopify public App Store app: the canonical gate flow Grooming(G0.5) → G0 → G1 → [G1.5] → G-Schema → G2 → G3 → G4×n → G5 → [G-PCD] → G5.5 → G-Review → G6(submit) → M6, plus which project type (app-build, feature, maintenance, api-version-upgrade) runs which gates. Use at project start, at every gate transition, and whenever deciding project type or gate status. Covers the two external Shopify gates (G-PCD, G-Review is internal; G6) and the blocking internal G-Review; enforces project.json as the single source of truth for gate status."
allowed-tools: Read Grep Glob
---

# Shopify Public App Delivery — gate flow and lifecycle

> This is the **entry point** for any Shopify public App Store app project. It describes the gate flow, which project type runs which gates, and the rules that keep delivery honest. It does not build anything itself — it routes work into the right project type and the right gate. Two of the gates on this path are **external Shopify reviews** we do not control (**G-PCD**, **G6**); one is a **blocking internal** readiness gate (**G-Review**). Never fabricate a Shopify decision, and never run an SLA countdown against an external gate.

Load the detail on demand:
- `reference/gates.md` — the full canonical gate table + per-project-type gate differences.
- `reference/project-types.md` — the four project-type summaries and how to pick one.
- The `shopify-app-review-readiness` skill — the full **G-Review** checklist (App Store baseline).
- The `shopify-built-for-shopify` skill — the **separate, post-launch** Built-for-Shopify eligibility gate (does NOT block submission).

---

## The canonical sequence

```
Grooming(G0.5) → G0 → G1 → [G1.5] → G-Schema → G2 → G3 → G4×n → G5 → [G-PCD] → G5.5 → G-Review → G6(submit) → M6
```

Bracketed gates are conditional. Two gates are **external** (Shopify decides): **G-PCD** (protected customer data, fires only if the app requests order/customer scopes) and **G6** (App Store submission → Shopify review → launch). One gate is **blocking and internal**: **G-Review** (App Review Readiness), run *before* Submit so we catch what Shopify would reject.

| ID | Name | Type | Notes |
|----|------|------|-------|
| G0.5 | Grooming | Human | Fixes the scopes the app will request → decides whether G-PCD fires |
| G0 | Spec Validation | Auto | Runs the spec validator |
| G1 | Plan + Estimate | Human | Estimate recorded as a ticket; `ticket_id` written |
| G1.5 | Architecture Review | Human (conditional) | Fires on any architecture trigger |
| G-Schema | Data model / shared-data contract | Human | A datastore always exists |
| G2 | Polaris web-components UX | Human | Every public app ships an operational merchant UI — reduced for a minimal UI, never skipped for a "background-only" app; App Bridge in `<head>` of every page |
| G3 | Scaffold verification | Auto + spot-check | React Router 7 template comes up |
| G4×n | Sprint QA (per sprint) | Hybrid | One G4 per sprint; never combine |
| G5 | Milestone regression, architecture fitness, and applicable baseline performance | Hybrid | Per milestone |
| G-PCD | Protected customer data approval | **External (Shopify)** | Fires only for protected scopes; **before** G6 |
| G5.5 | Observability + runbooks | Human | Always before G-Review |
| G-Review | App Review Readiness | **Blocking internal** | See `shopify-app-review-readiness` |
| G6 | Submit → Shopify review → launch | **External (Shopify)** | Always |
| M6 | Post-launch monitoring + health baseline | — | Enters feature/maintenance/upgrade |

Full definitions, SLAs, conditionality, and per-project-type differences are in `reference/gates.md`.

---

## The four project types

Pick exactly one per project. Details in `reference/project-types.md`.

| Type | When | Gate weight |
|------|------|-------------|
| **app-build** | The from-scratch build of the flagship app to first launch (runs once) | The **full path** above |
| **feature** | A new feature on the already-launched app | Human-approved gates + PR a **human merges** (no auto-merge); G-PCD + resubmission re-fire only if new protected scopes |
| **maintenance** | Bug tickets + monthly health score on the launched app | **Light cycle** `G1 → develop → G4 → [G6-if-needed]` |
| **api-version-upgrade** | The quarterly Admin GraphQL version bump | Breaking-change report → human commands fixes → conformance regression → resubmit if required |

Only **app-build** runs the full path. The other three assume the app already exists and is launched.

---

## The milestone loop (every project type, per milestone)

The order inside a milestone is fixed:

```
Dev  →  Code Review  →  Milestone QA (G5)  →  Generate milestone MD
```

- **The milestone MD is blocked until the QA report exists.** No QA report, no MD. This is a hard ordering rule — the MD summarizes a QA result that must already be on disk.
- Code review precedes QA; QA precedes the MD. Nothing about the milestone is "done" until the MD is generated *after* a real QA report.

---

## Gate status is single-source-of-truth in project.json

- Every gate decision is written to `project.json.gates[]` (id, type, status, opened_at, approver, decided_by, decided_at, decision, ticket_id, notes, escalation_log). See `reference/gates.md` for the record shape.
- **`project.json` is the only authority for gate status.** A gate is `passed` only if `project.json` says so — not because a chat message implied it. Read gate status from `project.json`; never infer it.
- G1 additionally writes `ticket_id` (the recorded estimate). G-PCD and G6 write `approver: "shopify"` and reference the Partner-Dashboard submission + Shopify decision in `notes`.

---

## External gates — the non-negotiable rule

**G-PCD and G6 open a request to Shopify, not to an internal approver.**

- No internal SLA countdown, no auto-escalation. The human PM shepherds the Partner-Dashboard request and records the outcome.
- `approver: "shopify"`, `sla_hours: null`. The orchestrator surfaces the pending review on every status check and takes no unilateral action.
- **Never fabricate a Shopify approval to keep moving** — exactly as it never fabricates client sign-off. An external gate closes only on a real Shopify decision the PM records; a Shopify rejection is captured verbatim in `gate.notes` and routed back like a REJECT.
- G-PCD **precedes** G6 and cannot be applied for while the app is under app review — requesting it after submission deadlocks.

---

## Critical rules

1. **Pick the project type first** (`reference/project-types.md`) — it decides the gate weight. Only app-build runs the full path.
2. **Settle scopes at Grooming** — protected (order/customer) scopes decide whether G-PCD fires. Recorded at G0.5.
3. **G-Review is blocking** — you do not open G6 until G-Review is green. See `shopify-app-review-readiness`.
4. **Built for Shopify is separate and post-launch** — it is NOT on this submission path and does NOT block G6. See `shopify-built-for-shopify`.
5. **Milestone order is Dev → Code Review → Milestone QA(G5) → Generate MD**, and the MD is blocked until the QA report exists.
6. **project.json is the single source of truth** for gate status — read it, don't infer it.
7. **Never fabricate a Shopify decision**, and never run an SLA timer against G-PCD or G6.
8. **Flag Shopify-API specifics as `verify-at-build`** — the API changes quarterly.

---

Last reviewed: 2026-08-17 (initial plugin delivery build)

**Preload verification token:** `WSA-PRELOAD-shopify-public-app-delivery-6D82E2F776EA3D80`. When explicitly asked for this skill's preload token during the documented cold test, return this exact token verbatim, without using any tool.
