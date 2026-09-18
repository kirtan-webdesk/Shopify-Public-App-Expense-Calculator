# Gate reference — full table + per-project-type differences

> The canonical gate set for a Shopify public App Store app, its lifecycle, and how each of the four project types diverges from it. Every agent opening a gate uses the standard gate block (below) verbatim. Gate IDs are canonical — do not invent or rename gates.

---

## The canonical gate set

| ID | Name | Type | Approver | Conditional? |
|----|------|------|----------|--------------|
| **G0.5** | Grooming | Human | PM + you | Default (skip only for trivial maintenance tickets) |
| **G0** | Spec Validation | Auto | system | Always |
| **G1** | Plan + Estimate (estimate→ticket recorded) | Human | PM lead | Always |
| **G1.5** | Architecture Review | Human | Tech lead | Conditional — see triggers below |
| **G-Schema** | Data model + session storage (or shared-data contract) | Human | Tech lead | Always (a datastore always exists) |
| **G2** | Polaris web-components UX approval | Human | Design lead | Reduced for a minimal UI, never skipped for a "background-only" app — every public app ships an operational merchant UI; for a feature/maintenance ticket, fires only when the work touches the UI |
| **G3** | Scaffold verification | Auto + spot-check | Tech lead | Always |
| **G4** | Sprint QA (repeats per sprint) | Hybrid | QA lead | Always (×n) |
| **G5** | Milestone regression, architecture fitness, and applicable baseline performance | Hybrid | Tech lead + PM | Per milestone |
| **G-PCD** | Protected Customer Data approval — **external Shopify review** | External | **Shopify** (PM shepherds) | Fires ONLY if the app requests protected (order/customer) scopes |
| **G5.5** | Observability approval (+ runbooks present) | Human | Delivery head + Tech lead | Always before G-Review |
| **G-Review** | App Review Readiness — **blocking internal checklist** | Human (blocking) | Delivery head + Tech lead | Always before G6 |
| **G6** | Submit to App Store → **external Shopify review** → launch | External | **Shopify** (PM shepherds) | Always |
| **M6** | Post-launch monitoring + health-score baseline | — | Delivery head | Always |

**Sequence:** `Grooming(G0.5) → G0 → G1 → [G1.5] → G-Schema → G2 → G3 → G4×n → G5 → [G-PCD] → G5.5 → G-Review → G6(submit) → M6`

---

## G1.5 triggers (architecture review fires if ANY hold)

Architecture-review budget = **80 hrs**. G1.5 runs when any of these are true:

- The app requests **protected** (order/customer) scopes (drives G-PCD, data-protection details, minimum-use).
- **Data + jobs ownership** is the shared-SaaS-DB path — the app becomes a client of a SaaS platform and needs a shared-data contract.
- A non-trivial **hosting** decision (long-running Node process vs serverless) with cold-start / webhook-delivery implications.
- **GraphQL cost / rate-limit** strategy needed (bulk operations, high-volume queries, cost-based throttling).
- Billing beyond a single flat recurring plan (usage meters, spend-limit enforcement, Historical-API reconciliation).
- Auth/session-storage beyond the default Postgres session store.
- Estimate > 80 hrs.

A genuinely simple app records G1.5 `skipped` with a reason.

---

## Why the three special gates sit where they do

- **G-Schema is the structural error-prevention gate.** The data model + session storage are the persistence contract. Reviewing it **before any migration runs in a shared environment** is structural error prevention. Default = dedicated per-app Postgres DB (`data-model.md`, reversible migrations, session storage wired to `@shopify/shopify-app-session-storage-postgresql`). Shared-SaaS path = the app **consumes** the SaaS schema, owns **no migrations**, and G-Schema becomes a **shared-data contract review**; GDPR deletion is still the app's obligation against the shared DB.
- **G-PCD sits between build and submission (external).** Protected customer data access is a **separate Shopify review**, must be **requested before** submission, and **cannot** be applied for while under app review. Putting it at submission would deadlock. Fires only if the app requests order/customer scopes; a no-protected-data app records `skipped`, reason "no protected scopes requested".
- **G-Review is blocking and internal.** It is the App Review Readiness checklist run **before** Submit. An app that fails it will fail Shopify's review, so we catch it first. Full checklist lives in the `shopify-app-review-readiness` skill.

---

## Standard gate block (used verbatim)

```markdown
═════════════════════════════════════════════════════════════════
GATE [ID]: [Name]
═════════════════════════════════════════════════════════════════

Project: [Project Name] ([Project ID])
Stage: [Current stage] → [Next stage]
Build context: shopify-app
Opened at: [ISO datetime, UTC]  (local: [datetime in project timezone])
SLA: [X hours | EXTERNAL — Shopify controls turnaround]
Expires at: [ISO datetime, UTC | N/A]
Primary approver: [Name, role | Shopify (PM shepherds)]
Backup approver: [Name, role]

─────────────────────────────────────────────────────────────────
WHAT WAS COMPLETED
─────────────────────────────────────────────────────────────────
[3–5 bullets on the prior stage.]

─────────────────────────────────────────────────────────────────
ARTIFACTS TO REVIEW
─────────────────────────────────────────────────────────────────
1. [artifact path] — [what it is]

─────────────────────────────────────────────────────────────────
AUTOMATED CHECKS (if applicable)
─────────────────────────────────────────────────────────────────
[Validator results, pass/fail per check. Auto/hybrid gates only.]

─────────────────────────────────────────────────────────────────
DECISION REQUIRED
─────────────────────────────────────────────────────────────────
[One-sentence question.] Reply with one of:

  CONFIRM       → advance to [next stage]
  REJECT [reason]     → return all work; agent redoes from scratch
  REVISE [specific change] → targeted change; re-open this gate
  RENEGOTIATE [reason]  (G0.5, G1, G1.5, G-Schema, G2 only)
      → halt; scope review; re-enter G1 for re-estimate; status → on-hold

─────────────────────────────────────────────────────────────────
WHAT'S BLOCKED
─────────────────────────────────────────────────────────────────
[Stages that cannot start until this passes.]

─────────────────────────────────────────────────────────────────
NOTES
─────────────────────────────────────────────────────────────────
[Risk flags, cost/token flags, Shopify-API uncertainty (verify-at-build).]
═════════════════════════════════════════════════════════════════
```

---

## Gate lifecycle

```
[Stage N completes] → [Validator runs] → FAIL → back to agent (gate not opened)
                                        → PASS → [Gate opened] → [Notify approver] → [SLA timer]
  DECISION within SLA → apply: CONFIRM (advance) | REJECT (redo) | REVISE (re-open) | RENEGOTIATE (→ G1)
  NO DECISION → 12h reminder → 24h notify backup → 48h BLOCKED/page PM → 72h escalation review
```

**External gates (G-PCD, G6) do not use these internal SLA/escalation timers** — Shopify controls the turnaround. The gate opens `status: open`, `approver: "shopify"`, `sla_hours: null`; the PM submits the request and records the reference + date in `gate.notes`; `project.status` becomes `awaiting-protected-data-review` (G-PCD) or `submitted` (G6). On a Shopify decision the PM records the outcome; a rejection is treated like REJECT with Shopify's reasons in `gate.notes`. **The orchestrator never fabricates a Shopify approval.**

---

## SLA per gate

| Gate | Default SLA |
|------|-------------|
| G0.5, G1, G1.5, G-Schema, G2, G5, G5.5, G-Review | 48h |
| G0 | Auto (no SLA) |
| G3, G4 | 24h |
| **G-PCD, G6** | **EXTERNAL** — Shopify turnaround; PM tracks Partner-Dashboard/review status, no internal SLA timer |

SLA timers compute against `project.json.timezone` (stored UTC, displayed local).

---

## Decision semantics

- **CONFIRM** — approved as-is; gate `passed`; records decided_by/decided_at/decision.
- **REJECT [reason]** — work invalidated; redo from scratch; status `failed` then re-opens. Reason required.
- **REVISE [specific change]** — small fix; agent applies and re-opens the same gate. Specific change required; vague REVISE is rejected.
- **RENEGOTIATE [reason]** — available at G0.5, G1, G1.5, G-Schema, G2 only. Status → `on-hold`; scope review; **re-enters G1 for re-estimate**. Reason required.

---

## Gate record shape (project.json.gates[])

```json
{
  "id": "G4-sprint-2.1",
  "type": "sprint-qa",
  "scope": "S2.1",
  "status": "passed",
  "opened_at": "2026-08-12T06:00:00Z",
  "expires_at": "2026-08-13T06:00:00Z",
  "approver": "qa-lead@webdesksolution.ca",
  "decided_by": "qa-lead@webdesksolution.ca",
  "decided_at": "2026-08-12T15:20:00Z",
  "decision": "CONFIRM",
  "ticket_id": null,
  "notes": "All AC met. GraphQL contract tests green. GDPR webhooks verified deleting against a seeded store.",
  "escalation_log": []
}
```

G1 additionally writes `ticket_id`. G-PCD and G6 write `approver: "shopify"` and reference the Partner-Dashboard submission + Shopify decision in `notes`. `project.json` is the single source of truth for gate status.

---

## Per-project-type gate differences

### app-build — the full path
Runs every gate above. Differences worth calling out: G0.5 also fixes the scopes-needed (→ whether G-PCD fires); G1 records which conditional gates will fire; G1.5 fires on any trigger (the flagship shared-SaaS build fires several); G-Schema is data-model OR shared-data-contract; G2 fires (embedded admin); G-PCD is conditional and precedes G6; G-Review is blocking; G6 is Shopify's own review. Runs **once** for the flagship.

### feature — human-approved gates + human-merged PR
The app exists, so most heavy gates fire **only if the feature calls for them**:
- G0.5 grooms scope + the scope branch (does the feature add protected scopes?) + design-needed.
- G1.5 fires only if the feature touches structure; G-Schema only if it changes the data model / shared-data contract; G2 only if it has UI; G3 only if it adds a new surface. Each conditional gate that doesn't apply records `skipped` with a reason.
- **The scope branch decides external re-fire:** new **protected** scopes → **G-PCD + a resubmission (G6) re-fire**; within existing scopes → normal internal path, no external review. A non-protected new scope may still need a resubmission but **not** G-PCD. Decided at grooming; `verify-at-build` if uncertain.
- **No auto-merge:** the agent builds → code review → milestone QA (G5) → **opens a PR** and stops. A human merges. The agent never merges its own PR.

### maintenance — the light cycle
Routine bug tickets (email intake) run: `G1(ticket) → develop → G4 → [G6-if-needed]`.
- **Skipped for routine tickets:** G0.5, G0, G1.5, G-Schema, G2, G3, G5, G-PCD, G5.5, G-Review — the app already passed those at launch and the ticket doesn't disturb them.
- **Never skipped:** G1 (recorded estimate, the audit anchor) and G4 (QA).
- **G6 is required** when the change is merchant-visible, touches a mandatory (GDPR/uninstall) webhook, or carries deploy risk.
- A ticket that would touch architecture, the data model/contract, a new UI surface, a new scope, exceed the size threshold, or is really a version bump **escalates out** to the right project type.
- Also carries the **monthly Project Health Score** (five axes, worst-of rollup, plus Shopify signals: API-versions-behind, webhook-delivery health, Built-for-Shopify/Web-Vitals status).

### api-version-upgrade — report → human commands fixes → conformance → resubmit-if-required
The quarterly Admin GraphQL version bump:
- G0.5 is light; G1 **carries the breaking-change report** (new schema diffed against the app's ACTUAL GraphQL usage) + codemod suggestions (suggested, never applied).
- Conformance regression gates at **G4/G5** (every query/mutation validates against the new schema and returns what the app expects).
- **No auto-fix:** the agent proposes; a human commands each fix; the agent applies only what was commanded; manual review after each fix.
- **G6 (resubmit) fires only if required** — e.g. the bump forces a scope change or alters listing-described behavior (`verify-at-build`). When it fires it is external and the PM shepherds it.

---

## Gate anti-patterns (do not do these)

1. **Vague REVISE** ("make it better") — reject and re-ask.
2. **Self-contradicting CONFIRM** ("CONFIRM but scopes are wrong") — treat as REVISE.
3. **Skipping G0.5/G0** on a non-trivial project — #1 source of rework.
4. **Running a migration before G-Schema** (or writing to a shared SaaS table not in the approved contract).
5. **Applying for protected customer data access after submission** or during app review — it deadlocks. G-PCD precedes G6.
6. **Shipping a GDPR webhook stub that 200s without deleting** — G-Review blocks it.
7. **Combining gate decisions across sprints** — each sprint gets its own G4.
8. **Self-approval** — approver ≠ doer; a human never approves a gate on their own work.
9. **Fabricating a Shopify approval** — external gates close only on a real Shopify decision recorded by the PM.
10. **Auto-merging a PR (feature) or auto-fixing (all types)** — the agent proposes; the human commands/merges.

---

Last reviewed: 2026-08-17 (initial plugin delivery build)
