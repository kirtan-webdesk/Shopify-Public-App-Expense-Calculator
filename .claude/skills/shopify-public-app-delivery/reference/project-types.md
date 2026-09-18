# Project-type reference — pick one, then run its gates

> A Shopify public-app project runs as exactly **one** of four project types. The type decides the gate weight (see `gates.md` for the per-type gate differences). All four share the milestone loop **Dev → Code Review → Milestone QA(G5) → Generate MD** (the MD is blocked until the QA report exists), `project.json` as the single source of truth for gate status, no auto-fix, and no fabricated Shopify decisions.

---

## Picking the type

- Is this the **first, from-scratch build** of the flagship app? → **app-build** (runs once).
- Is this a **new feature / substantial enhancement** on the already-launched app? → **feature**.
- Is this a **bug ticket / small fix / health check** on the launched app? → **maintenance**.
- Is this the **quarterly Admin GraphQL version bump**? → **api-version-upgrade**.

If a "ticket" is really a feature, or a "feature" is really a rebuild, or a "bump" wants new functionality — reclassify it. Keep each type clean.

---

## app-build

**Is:** the greenfield build of the flagship public app to its first App Store launch. Settles the per-SOW architecture decisions (data + jobs ownership, hosting, scopes, GraphQL cost strategy, billing model), builds the app, proves App Review Readiness, and shepherds the two external Shopify reviews.

**Is not:** a feature on a launched app, a bug ticket, or the version bump.

**Gate weight:** the **full path** — `Grooming(G0.5) → G0 → G1 → [G1.5] → G-Schema → G2 → G3 → G4×n → G5 → [G-PCD] → G5.5 → G-Review → G6(submit) → M6`. Includes the two external Shopify reviews (G-PCD if protected scopes, G6 submission) and the blocking internal G-Review.

**Data/jobs ownership is a per-SOW decision at G1.5/G-Schema** — the default is a dedicated per-app Postgres DB with jobs on the app's own host; the alternative is the shared-SaaS path (shared DB, SaaS-side jobs, super-admin settings, a shared-data contract, and a shared-DB GDPR-deletion obligation). Never assume the shared path.

**Runs once** for the flagship (re-run only on a full rebuild).

---

## feature

**Is:** a net-new feature or substantial enhancement on the launched flagship — a new admin screen, a new Admin GraphQL data flow, a new billing plan or usage meter, a new webhook topic, a settings surface. Groomed, designed, built, reviewed, QA'd, and merged via a human-approved PR.

**Is not:** the initial build, a bug fix (maintenance), or the version bump.

**Gate weight & the two disciplines that define it:**
1. **You approve the human gates** — G1 (plan), and conditionally G1.5 (architecture), G-Schema (data), G2 (design). Each is a real human decision; the agent opens the gate and waits.
2. **No auto-merge** — build → code review → milestone QA (G5) → the agent **opens a PR** and stops. A human merges.

**The scope branch, decided at grooming:** new **protected** (order/customer) scopes → **G-PCD + resubmission (G6) re-fire** (plan the Shopify turnaround); within existing scopes → normal internal path, no external review. A non-protected new scope may still need a resubmission but not G-PCD. `verify-at-build` if uncertain.

Conditional gates fire only when the feature calls for them (design only if UI; G1.5 only if it touches structure; G-Schema only if it changes the data model/contract).

---

## maintenance

**Is:** ongoing care of the launched flagship — a stream of bug tickets (email intake for now), each estimated, approved, built, QA'd, shipped, and closed, plus the **monthly Project Health Score**. Also the home of an onboarded existing app repo after its docs are reconstructed and validated.

**Is not:** a feature, the initial build, or the version bump. When a ticket is really one of those, it **escalates out**.

**Gate weight — the light cycle:** `G1(ticket) → develop → G4 → [G6-if-needed]`. For a routine ticket, G0.5/G0/G1.5/G-Schema/G2/G3/G5/G-PCD/G5.5/G-Review are skipped (the app passed them at launch). **G1 and G4 are never skipped.** **G6 is required** when the change is merchant-visible, touches a mandatory (GDPR/uninstall) webhook, or carries deploy risk.

**Never regress the App Review Readiness invariants** — GDPR webhooks still actually delete data (and `customers/data_request` still acks then delivers to the store owner), no unauthenticated sensitive/protected routes (a static, non-sensitive health endpoint is allowed per the route-authentication matrix), no credentials in responses, App Bridge still in `<head>`, Admin GraphQL still pinned. A ticket that would break one is not routine.

**Monthly health score:** five axes (architecture · test · dependency · security · delivery), each 0–100 + GREEN/YELLOW/RED + a one-line basis, **worst-of** rollup. Watches Shopify-specific signals: how many Admin GraphQL versions behind (→ schedule an api-version-upgrade), webhook-delivery failure rate, GDPR-webhook health, Built-for-Shopify/Web-Vitals status, open security findings.

---

## api-version-upgrade

**Is:** moving the app's pinned Admin GraphQL version forward (e.g. 2026-07 → 2026-10). Pull the new schema + changelog, diff against the app's ACTUAL GraphQL usage, produce a breaking-change report + codemod suggestions, let a human decide, run conformance regression at the new version, apply human-commanded fixes, and resubmit if Shopify requires it.

**Is not:** a Node runtime/dependency upgrade (ordinary maintenance), a new feature, the initial build, or a bug ticket. If a bump tempts new functionality, that functionality is a separate feature — keep the version move clean.

**Gate weight & the rule that defines the type — NO AUTO-FIX:** the agent **proposes**, the human **commands** the fix. Claude pulls the version, produces the breaking-change report and codemod *suggestions*, and runs the GraphQL conformance regression; it does **not** auto-apply query fixes. A human reads the report and commands each fix; the agent applies only what was commanded; manual review after each fix.

- G1 carries the breaking-change report (usage-mapped, not a generic changelog dump).
- Conformance regression at the new version gates the result (G4/G5).
- **Resubmit (external G6) only if required** — e.g. the bump forces a scope change or alters listing-described behavior (`verify-at-build`). When it fires the PM shepherds it; never fabricate a Shopify approval.

---

Last reviewed: 2026-08-17 (initial plugin delivery build)
