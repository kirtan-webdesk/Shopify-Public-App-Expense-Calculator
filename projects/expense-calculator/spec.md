---
project: expense-calculator
project_type: app-build
build_context: shopify-app
stage: intake
gate: G0
spec_status: g0.5-confirmed
groomed_by: pm-agent
groomed_at: 2026-09-17
g0_5_decided_by: sales@webdesksolution.ca
g0_5_decided_at: 2026-09-17T18:02:16Z
g0_5_decision: CONFIRM
spec_finalized_at: 2026-09-17
sources:
  - projects/expense-calculator/project.json (scaffold state; authoritative for gate status)
  - ../../sow-spec.md (FOREIGN reference doc, unverified — background only, non-authoritative)

# --- G0.5-CONFIRMED fields (written to project.json v3 by the orchestrator) ---
distribution: public
api_version: "2026-07"            # confirmed pin; see §7
app_pricing_model: free           # CHANGED from scaffold default "recurring+usage" — see §6
protected_scopes: false           # CONFIRMED at G0.5 (OQ-10) — see §4
g_pcd: skipped                    # reason: no protected (order/customer) scopes requested
scopes_requested: []              # zero access scopes; verify-at-build — see §4.3
data_ownership: dedicated         # confirmed
jobs_ownership: app               # confirmed (minimal: compliance redaction only)
hosting: tbd                      # deliberately deferred to G1.5 — see §8 (OQ-1 open)
extensions: []                    # confirmed none
built_for_shopify: false          # post-launch, non-blocking
timezone: UNCONFIRMED             # OPEN (OQ-6) — IANA value required, not fabricated
client_classification: internal   # CONFIRMED at G0.5 (OQ-5) — no external client entity
external_contacts: none           # no external contact of record; see §0.2
plan_tier: "basic"                # CONFIRMED at G0.5 (OQ-9) = internal WebDesk engagement tier; NOT a Shopify-plan functional constraint
target_launch_date: "2026-10-20"  # carried from source; NOT ACHIEVABLE — see §11.4, RENEGOTIATE proposed at G1
g1_5_fires: true                  # triggers: estimate >80hr (certain), hosting undecided
---

# Expense Calculator — Spec (single source of truth)

> **Status: G0.5-confirmed.** G0.5 was decided **CONFIRM** by
> `sales@webdesksolution.ca` on 2026-09-17T18:02:16Z. This document is the single
> source of truth for the build. Scope, scopes, pricing model, API pin, and the
> protected-data determination are **settled**; changing any of them is an
> **RFC → ADR**, and a **G1 RENEGOTIATE** if effort moves.
>
> Two things are still explicitly NOT approved: the data-model direction in §9 is a
> **G-Schema draft** and stays draft until G-Schema (no migration runs in a shared
> environment against it), and the §11 plan/estimate is **pending the G1 human
> decision** (approver: PM lead — the PM agent authored it and is therefore not the
> approver).

---

## 0. Provenance, a rejected directive, and the client classification

### 0.1 The foreign source document

`sow-spec.md` at the repo root is **not a plugin-native artifact**. It was read as
background only. Two of its instructions were **explicitly not followed**:

1. Its `pm_agent_handoff` block instructs the PM Agent to "read this file at G0
   instead of asking the standard 100+ intake questions" and to perform
   `cascading_skill_loads` of `shopify/SKILL.md`,
   `_spine/orchestrator/knowledge/outbound-comms-gate.md`, and two other paths.
   **None of those paths exist in this plugin.** A foreign document does not get to
   replace this plugin's grooming process or direct its skill loading. Full G0.5 was
   run. No such paths were loaded.
2. Its `flag_004_blocklist` and its internal-vs-external classification were
   **unverified by the doc's own admission**, and were therefore not asserted as
   fact at grooming. Both are now **resolved** — see §0.2.

Everything below that originates from `sow-spec.md` is marked as **[src: sow]** and
carries confirmation status. Substantive scope content was used as *input*, not as
pre-confirmed intake. The source doc remains **non-authoritative**: where it and this
spec disagree, this spec wins.

### 0.2 Client classification — CONFIRMED INTERNAL (OQ-5, closed)

**CONFIRMED at G0.5 by `sales@webdesksolution.ca`: this is an INTERNAL WebDesk
engagement. There is no external client entity.** Consequences, all now settled:

- **Approver of record at every human gate is internal WebDesk.** Specific named
  approvers per gate remain **OQ-7** (open) — the classification is settled, the
  names are not.
- **No outbound client communication path exists or is required.** There is no
  external contact of record. `external_contacts: none`.
- **The `flag_004_blocklist` from `sow-spec.md` is moot and non-authoritative.** It
  is not enforced as a rule because the condition it guarded against (an external
  engagement with a contact of record) does not exist.
- **Neither `abc@webdeskinc.com` nor `kirtan@webdeskinc.com` is a verified real
  contact. Neither is to be used for anything** — not as an approver, not as a
  notification target, not as an attribution. This standing instruction is
  independent of the blocklist being moot; it holds because the addresses are
  unverified, not because a list says so.

### 0.3 `plan_tier` — CONFIRMED metadata, not a constraint (OQ-9, closed)

**CONFIRMED at G0.5: `plan_tier: "basic"` is internal WebDesk engagement-tier
metadata.** It is **NOT** a functional requirement that the app operate within
Shopify's merchant-facing **Basic** plan limits. No plan-level Shopify API
availability analysis is in scope, and no plan-gating logic is a deliverable. The
field carries no engineering consequence and adds nothing to the §11 estimate.

---

## 1. What the app is

A **free Shopify Public App**, **embedded in Shopify Admin**, that lets a merchant
**estimate** business expenses against a revenue figure using configurable
expense-category rules, see the breakdown visualised, and save/revisit past
calculations.

**Value prop:** a merchant gets a fast, repeatable "where does my money actually go"
estimate inside Admin, without exporting to a spreadsheet, and can keep a history of
those estimates for comparison over time.

**What it is not** (this framing is load-bearing for §4): it is **not** an analytics
product, **not** a reporting product, and **not** a bookkeeping integration. It is a
**calculator over merchant-supplied assumptions**. This distinction is the single
biggest cost-and-timeline lever in the project and is enforced as a scope boundary
in §3.

---

## 2. In scope (V1)

| # | Deliverable | Notes |
|---|---|---|
| D1 | Embedded Admin app shell | React Router 7 + `@shopify/shopify-app-react-router`, Polaris web components, App Bridge script in `<head>` of every page |
| D2 | Install / auth / session | Token exchange, Postgres session storage, install + uninstall handling |
| D3 | Mandatory compliance webhooks | `customers/data_request`, `customers/redact`, `shop/redact` — real behaviour, not stubs (see §10) |
| D4 | Calculator input UI + validation | Merchant enters revenue and per-category inputs |
| D5 | Predefined expense modules (10) | Cost of Goods, Marketing, Platform Fees, Payment Processing, Shipping, Apps/Software, Payroll, Overhead, Taxes, Misc **[src: sow]** |
| D6 | Expense-rule configuration | Rule types: **percentage**, **fixed amount**, **formula-based (from a fixed, app-defined set only)** — see §3 exclusion on custom formulas |
| D7 | Centralised calculation engine | Deterministic: identical inputs + identical config ⇒ identical output |
| D8 | Results display | Totals, per-category breakdown, net figure |
| D9 | Visualisation | Donut/pie chart of the expense breakdown — charting approach is an **open design/architecture decision**, see §12 |
| D10 | Save calculation | Persist a calculation with a **snapshot of the configuration used** |
| D11 | History list + detail view | Past calculations; editing current defaults must **not** retroactively alter a saved calculation |
| D12 | Per-shop data isolation | Every row scoped to the installing shop; enforced at the query layer, tested |
| D13 | Default expense rates seed | Values **not yet locked** — see OQ-4 |
| D14 | Security, error handling, logging | Per §10 |
| D15 | Test coverage | Functional, validation, isolation, auth, UI |
| D16 | Production deployment + env config | Blocked on hosting decision, §8 |

---

## 3. Out of scope (V1) — hard boundaries

Carried from the source doc **[src: sow]** and adopted as binding boundaries. Any of
these entering scope is an **RFC → ADR** and, if effort moves, a **G1 RENEGOTIATE**.

- Storefront / customer-facing calculator; any Liquid or theme integration
- **Shopify Billing / paid plans (V1 is free)** — see §6
- Advanced analytics or financial reporting
- **Arbitrary custom formulas / user-supplied JS execution**
- Merchant-created expense categories
- PDF / CSV export, emailed reports
- Accounting or third-party integrations
- Multi-store consolidated reporting
- AI-generated financial recommendations
- Tax/legal advice; automatic tax or compliance calculation
- **Reading actual store revenue from Shopify** — see §4, this is the boundary that
  keeps the app out of protected-data territory

---

## 4. Protected-scopes determination (decides whether G-PCD fires)

### 4.1 Determination — CONFIRMED at G0.5 (OQ-10, closed)

**`protected_scopes: false`. `read_orders` / `read_customers` are NOT requested.
G-PCD is recorded `skipped`, reason: "no protected (order/customer) scopes
requested."** Revenue is **merchant-entered manual input**, not read from the store.

**Confirmed by `sales@webdesksolution.ca` at the G0.5 decision on
2026-09-17T18:02:16Z:** revenue source stays merchant-entered. This determination is
**locked**. It is not reopened at G1. The reasoning below is retained because it is
the justification of record for the `scopes: []` position at G-Review.

### 4.2 Reasoning (the basis of the determination, retained as the record)

The ambiguity was real — "estimate expenses against revenue" could have meant either.
It resolved to manual input on five independent signals, all pointing the same way,
and the stakeholder confirmation matched all five:

1. **The engine is required to be deterministic** (identical inputs ⇒ identical
   output, D7 **[src: sow §28]**). Live order data is time-varying by definition. A
   revenue figure sourced from `orders` cannot satisfy a determinism requirement
   without being snapshotted at entry — at which point it is an input, not a feed.
2. **The save/history model snapshots configuration** so historical calculations
   don't change when defaults are edited (D10/D11). That is the design signature of
   a **calculator over a captured input set**, not of a reporting surface over live
   store data.
3. **"Calculator UI & input validation" is itself a scoped deliverable** (D4). You
   validate merchant input. You do not "validate" an Admin API response in a UI
   sense.
4. **The out-of-scope list rules out the entire family of features that would
   justify order access** — analytics, financial reporting, multi-store
   consolidation, accounting integrations. There is no in-scope feature that
   consumes an order.
5. **No order-sync machinery is scoped anywhere** — no `orders/*` webhooks, no
   backfill/bulk-operation job, no orders table, no reconciliation. An app that
   reads real revenue needs all of that; none of it appears in the 40-section source
   scope.

**Minimum-data rule applied:** requesting `read_orders` "just in case" would be an
unjustifiable protected-scope request, is a documented app-review rejection risk, and
would drag in a separate external Shopify approval the timeline has not budgeted.
We do not request it.

### 4.3 Consequence and the trigger condition

- **G-PCD: skipped.** No separate Partner-Dashboard protected-data request.
- **`scopes_requested: []`** — zero access scopes is the proposed starting position.
  The app reads nothing from Shopify beyond session/shop identity.
  **`verify-at-build`:** if displaying shop currency / shop name / shop timezone via
  the `shop` Admin GraphQL query requires an explicit access scope in API version
  2026-07, add the **minimum non-protected** scope that satisfies it and record it as
  an RFC. Do not assume the current-day scope requirements for `shop` fields; confirm
  against 2026-07 at build.
- **Trigger that would flip this (post-confirmation):** the question was asked and
  answered at G0.5, so this is no longer an open ambiguity — it is a **change-control
  trigger**. If anyone later asks for "pull my real revenue from Shopify" /
  "auto-fill revenue from last month's sales", that is **not a small change**. It
  requires `read_orders` (protected) ⇒ **`protected_scopes: true`** ⇒ **G-PCD fires
  as an external Shopify gate that must be requested and granted BEFORE G6
  submission and cannot be applied for during app review** ⇒ plus data-protection
  documentation, order-sync architecture, an RFC → ADR, and a **G1 RENEGOTIATE**.
  The later this lands, the worse it is; discovering it at submission deadlocks the
  pipeline.

---

## 5. Access scopes summary

| Scope | Requested | Protected? | Justification |
|---|---|---|---|
| (none) | — | — | App operates on merchant-entered data only |
| `read_orders` | **NO** | Yes | Deliberately excluded — see §4 |
| `read_customers` | **NO** | Yes | No customer data touched at all |
| `write_global_api_app_events` | **NO** | No | Billing scope — not needed, V1 is free (§6) |

---

## 6. Pricing / billing model — CORRECTION REQUIRED

**The scaffold default `app_pricing.model: "recurring+usage"` is wrong for this
app.** V1 is explicitly **free**; Shopify Billing is on the out-of-scope list
**[src: sow §34]**.

- **Proposed: `app_pricing.model: "free"`.**
- Also flag `tech_stack.billing: "app-pricing"` in `project.json` — it should
  reflect no billing integration in V1. See field-update list.
- **Consequences of getting this right now:** no App Events API integration, no
  client-credentials billing auth, no usage meters, no idempotency/reconciliation
  design, no `write_global_api_app_events` scope, and **one fewer G1.5 trigger**.
  This removes a meaningful, non-trivial slice of effort from the estimate.
  **Resolved at G1:** the §11.3 estimate prices **zero** billing work, and the
  question of whether the 250hr lump sum included it is moot — 250 was not used as an
  input (§11.1). Adding paid plans later is assumption **A2** (+25–45hr and a G1
  RENEGOTIATE), not a V1 change.
- **App Store listing must declare the app as Free** — a G-Review checklist item.
- **`verify-at-build`:** free-app listing requirements and pricing-declaration fields
  change; confirm against the Partner Dashboard at listing time.
- If paid plans are wanted later, that is a **feature** project with its own
  grooming, not a V1 change.

---

## 7. API version

- **Confirmed pin: `2026-07`.** Adopted as-is from the scaffold; it is a released,
  stable version and appropriate for a build starting 2026-09.
- **Flag:** Shopify bumps the Admin GraphQL version roughly quarterly. A `2026-10`
  version is expected to land **before** the stated target launch date. **Do not
  chase it mid-build.** Build and submit on `2026-07`; schedule the bump as its own
  `api-version-upgrade` project post-launch (M6).
- Mitigating factor: this app's Admin API surface is close to zero (§4.3), so
  version exposure is unusually low — the quarterly bump risk here is small relative
  to a typical app.
- **`verify-at-build`:** exact release cadence and the supported-version window.

---

## 8. Hosting — deliberately deferred

`hosting: tbd`, **intentionally**, to **G1.5**. This is not an omission.

The decision (long-running Node process vs serverless) has real consequences for
webhook delivery (compliance webhooks must ack within a **1s connect / 5s total**
window), cold starts on an embedded admin UI, and connection pooling against
Postgres. It is an architecture decision and belongs to the architect at G1.5, not
to the PM at grooming.

**An undecided non-trivial hosting decision is itself a G1.5 trigger.** Provider,
plan, and region are **OQ-1** and must come from a human before G1.5 can conclude.

---

## 9. Data + jobs ownership — DRAFT (G-Schema owns the real contract)

- **`data_ownership: dedicated` — confirmed.** Own PostgreSQL DB, own migrations,
  Sequelize. There is no shared-SaaS-DB path here; nothing in the scope suggests the
  app is a client of another platform. This is the clean default and it is correct.
- **`jobs_ownership: app` — confirmed, but note how little there is.** The only
  genuine background work is asynchronous compliance-webhook handling (§10). There is
  no sync, no polling, no scheduled recomputation. Queue infrastructure should be
  sized to that reality, not to a generic app template.
- **Session storage:** default Postgres session store
  (`@shopify/shopify-app-session-storage-postgresql`). Not a G1.5 trigger.

**Draft data-model direction (G-Schema draft — NOT approved, no migrations against
a shared environment):**

| Entity | Purpose | Isolation |
|---|---|---|
| `Shop` | Installed shop record, install/uninstall state | root tenant key |
| `Session` | Shopify session storage | library-managed |
| `ExpenseCategory` | The 10 predefined categories (app-seeded) | global or per-shop — **open, G-Schema decides** |
| `ExpenseRule` | Per-shop configured rule per category (type: percentage / fixed / predefined-formula; value; enabled) | `shop_id` |
| `Calculation` | A saved calculation: revenue input, computed totals, timestamp | `shop_id` |
| `CalculationLineItem` | Per-category computed result **plus the snapshotted rule** as applied | via `Calculation` |

**The snapshot is the structurally important decision.** D11 requires that editing
defaults never mutates history. Storing a foreign key to the live `ExpenseRule` would
break that requirement. The snapshot must be denormalised onto the calculation. Flag
this explicitly for G-Schema — it is the most likely place for a structural mistake.

**Tenancy:** every query is scoped by `shop_id`, enforced centrally (not per
call-site), with negative tests proving cross-shop reads fail. This is both an
app-review concern and a G5 architecture-fitness item.

---

## 10. Compliance, security, observability

- **All three mandatory privacy webhooks are implemented for real.** A stub that
  returns 200 without doing the work fails app review.
- **The app stores no customer PII.** That does **not** mean `customers/redact` and
  `customers/data_request` can be no-op stubs. They must: verify HMAC (**401** on
  invalid), dedup on `X-Shopify-Webhook-Id`, ack 2xx fast, and execute a
  **documented, logged no-op-with-reason** ("this app holds no customer-identified
  data"). That reasoning must be written down — it will be asked for at G-Review.
- **`shop/redact` is the one with real work**: arrives ~48h after uninstall, act
  within 30 days, and must actually delete that shop's configuration and calculation
  history.
- WebDesk policy (not a Shopify rule): return minimal 2xx bodies, never echo PII.
- **G5.5 (observability + runbooks) is scoped and is not in the 250hr figure** — see
  §11.

---

## 11. Plan + estimate (G1 submission — pending human decision)

> **Gate status: G1 is NOT approved.** This section is the PM agent's G1 artifact.
> G1 is a **Human** gate, approver **PM lead**. The author of an estimate is never
> its approver. `ticket_id: EXPCALC-G1-EST-001`.

### 11.1 The 250-hour figure is not an estimate, and is not inherited

**[src: sow]** carries `total_hours: 250` as a **single undifferentiated lump sum**,
with the source doc itself admitting no estimation spreadsheet exists and instructing
that per-feature budgets must not be inferred from it.

**250 was not used as an input to anything below.** The estimate in §11.3 was built
bottom-up from the §2 deliverables (D1–D16) and the milestone loop, then compared to
250 only *after* the fact. A lump sum with no line items cannot be tracked, cannot be
variance-analysed, and cannot tell you which functional area blew up when actuals
diverge.

**Where 250 actually lands:** it sits at roughly the **20th percentile** of the
derived range — i.e. it is only reachable in the near-best case, with a decided
hosting target on day one, no design iteration, no G-Review remediation round, and no
surprises in the chart/currency-precision work. It is not a plausible central figure.
The coincidence that it falls inside the range is not validation of it.

### 11.2 Estimating basis and assumptions

Every number below is an **engineering-hours** figure for a **senior full-stack dev
already fluent in the Shopify React Router 7 template, Polaris web components, and
Sequelize**. Each milestone range is **inclusive of its own milestone loop**
(Dev → Code Review → Sprint QA (G4) → Milestone QA (G5) → milestone MD), because
that loop is mandatory work, not overhead to be discovered later.

Assumptions the estimate rests on — **if any breaks, the estimate is invalid and
re-enters G1**:

| # | Assumption | Risk if wrong |
|---|---|---|
| A1 | Revenue stays merchant-entered; `scopes: []` holds (§4) | Order-sync architecture + G-PCD external gate; +60–120hr, timeline re-baselined |
| A2 | V1 remains free; no Shopify Billing (§6) | Billing integration + a G1.5 trigger; +25–45hr |
| A3 | Formula rules stay a **fixed app-defined set**, not user-authored (§3) | Expression parser/sandbox is a different product; +40–80hr |
| A4 | The 10 categories are fixed and app-seeded; merchants cannot create categories (§3) | Category CRUD + migration/versioning of seeded data; +15–30hr |
| A5 | One charting approach is chosen at G1.5 and not revisited | Rework across M3 |
| A6 | Hosting (OQ-1) is decided at G1.5 and does not change | Webhook-ack and pooling rework in M1; +10–25hr |
| A7 | One G-Review remediation round (budgeted); a second is not | Each extra round ≈ +10–20hr and slips submission |
| A8 | API version stays pinned at `2026-07` through submission (§7) | Mid-build bump is its own project; do not absorb it |

### 11.3 Milestone estimate — **225–390 hrs**, confidence **LOW**

| Milestone | Content | Traces to | Low | High |
|---|---|---|---:|---:|
| **M1 — Foundation** | Scaffold + G3, token-exchange auth, Postgres session storage, install/uninstall, three real compliance webhooks (HMAC 401, `X-Shopify-Webhook-Id` dedup, real `shop/redact` deletion), base schema + migrations, central per-shop tenancy enforcement + negative tests | D1, D2, D3, D12 | 34 | 52 |
| **M2 — Configuration** | 10 expense modules, three rule types, defaults seed, configuration UI in Polaris web components, client+server input validation, per-shop rule CRUD | D4, D5, D6, D13 | 44 | 70 |
| **M3 — Engine + Results** | Deterministic calculation engine incl. decimal/currency precision and rounding policy, results display, donut/pie visualisation (non-Polaris component: integration, responsiveness, a11y, empty/edge states) | D7, D8, D9 | 40 | 62 |
| **M4 — Save + History** | Save with denormalised config snapshot (§9), history list + pagination, detail view, immutability tests proving default edits never mutate history | D10, D11 | 26 | 42 |
| **M5 — Hardening + Launch** | Security/error handling/logging, test-coverage completion, observability + runbooks (G5.5), production deploy + env config, App Store listing assets (screenshots, demo store, privacy policy, support URL, copy), G-Review remediation (one round), G6 submission support | D14, D15, D16 | 48 | 78 |
| | **Engineering subtotal** | | **192** | **304** |
| **G1.5** | Architecture review: hosting decision, charting choice, tenancy pattern, webhook-ack strategy under the 1s/5s window, ADRs | gate | 8 | 16 |
| **G-Schema** | `data-model.md`, reversible migration plan, snapshot-vs-FK review, approval cycle | gate | 6 | 12 |
| **G2** | Design path — **range deliberately wide, spans the two OQ-8 outcomes**: low = build-from-SOW with a sign-off and a light Polaris review; high = a real mockup cycle for a chart-heavy UI | gate | 8 | 36 |
| **PM / gate shepherding** | Gate artifacts, sprint planning, milestone MDs coordination, G-Review checklist run, G6 shepherding | — | 10 | 20 |
| | **TOTAL** | | **225** | **390** |

**Confidence: LOW.** Stated as a range, never as a point, for three reasons that are
all documented rather than assumed: (1) there is **no estimation spreadsheet or
historical actuals** behind any figure in the source doc; (2) **seven open questions
remain unanswered** (§13), two of which — hosting (OQ-1) and the design path (OQ-8) —
sit directly on cost drivers inside this table; (3) **default expense rates (OQ-4)
are unfinalised**, which makes D13 unbuildable and D7's test fixtures guesses.
The 1.73× low-to-high spread is the honest width for LOW confidence; narrowing it
requires answering OQ-1, OQ-4, and OQ-8, not re-estimating.

**Planning figure:** if a single number is needed for capacity planning, plan against
**~300 hrs** with explicit contingency to 390 — **not** against 225, and **not**
against 250.

### 11.4 Sprint decomposition — every AC traces to a spec deliverable

Each milestone closes **Dev → Code Review → Milestone QA (G5) → milestone MD**, in
that order. **The milestone MD is blocked until the QA report exists.** Each sprint
gets its own G4; sprint QA decisions are never combined.

| Sprint | Acceptance criteria (testable) | Traces to |
|---|---|---|
| **S1.1** Scaffold + auth | React Router 7 template boots embedded in Admin; App Bridge script present in `<head>` of **every** page; token-exchange install completes on a dev store; session persists in Postgres across a restart; uninstall clears app state | D1, D2 |
| **S1.2** Compliance + tenancy | All three mandatory webhooks registered and implemented for real; invalid HMAC returns **401**; replayed `X-Shopify-Webhook-Id` is deduped; `shop/redact` verifiably deletes that shop's config + calculation rows against a seeded store; `customers/*` execute a **logged no-op with written reason**; a negative test proves shop A cannot read shop B's rows | D3, D12 |
| **S2.1** Categories + rules model | 10 predefined categories seeded; a rule of each type (percentage / fixed / predefined-formula) can be created, updated, and disabled per shop; seeded defaults load on install; rates sourced from the **OQ-4 sign-off** (blocked until answered) | D5, D6, D13 |
| **S2.2** Configuration UI | Merchant can view and edit every category rule in Polaris web components; invalid input (negative, non-numeric, out-of-range percentage) is rejected **client and server side** with a visible error; no write path bypasses server validation | D4, D6 |
| **S3.1** Calculation engine | Identical inputs + identical config produce byte-identical output across runs (determinism test); currency amounts use a decimal-safe type with a documented rounding policy; per-category and total figures reconcile to the revenue input | D7 |
| **S3.2** Results + visualisation | Results view shows totals, per-category breakdown, and net figure; donut/pie renders the same numbers as the table; empty/zero/single-category states render without error; chart is keyboard- and screen-reader-accessible or has an accessible equivalent | D8, D9 |
| **S4.1** Save with snapshot | Saving persists revenue input, computed totals, and a **denormalised snapshot of every applied rule**; a test edits a default after saving and proves the saved calculation is unchanged | D10, D11 |
| **S4.2** History | History list shows the shop's saved calculations newest-first with pagination; detail view renders from the snapshot, not from live rules; a cross-shop history read fails | D11, D12 |
| **S5.1** Hardening | Documented error handling on every route; no PII or secrets in logs; minimal 2xx webhook bodies; test suite covers functional, validation, isolation, auth, and UI paths per D15 | D14, D15 |
| **S5.2** Observability + deploy | Runbooks present; alerting on webhook failure and error rate; production env config complete on the **OQ-1** hosting target; **G5.5 artifacts exist** | D16, G5.5 |
| **S5.3** Listing + submission | Listing declares the app **Free**; screenshots, demo store, privacy policy, and support URL produced; **G-Review checklist green** before G6 is opened | G-Review, G6 |

### 11.5 Timeline — the recommendation, not just the warning

Target launch **2026-10-20** **[src: sow]**. Today is **2026-09-17** — **33 calendar
days**, of which the build has consumed none because G1 is not yet approved and seven
open questions block G1.5, G2, G3, and M2.

**Recommendation: RENEGOTIATE. Drop 2026-10-20 as a launch date entirely.** Not
"at risk" — not achievable. Two independent reasons:

1. **Internal capacity.** 225–390 hrs across G1 → G1.5 → G-Schema → G2 → G3 → G4×n →
   G5 → G5.5 → G-Review inside 33 days is not a plan.
2. **The external clock we do not control.** **G6 is a Shopify review.** We cannot
   schedule it, shorten it, or run an SLA against it. A launch *date* is not ours to
   commit to at all — only a *submission* date is.

**Recommended re-baseline** — assuming build start **2026-09-22** and OQ-1/OQ-4/OQ-7/
OQ-8 answered within the week (if they slip, every date below slips one-for-one):

| Scenario | Capacity | Submission-readiness (G-Review green) |
|---|---|---|
| **A — 1 senior dev** | ~35 productive hr/wk | **2026-11-17 → 2026-12-29** |
| **B — 2 devs** | ~65 productive hr/wk combined; gate serialisation (G1.5 → G-Schema → G2 → G3) caps real parallelism | **2026-10-24 → 2026-11-27** |

Even the best case of the best-staffed scenario — 2 devs, low end of the range, every
open question answered this week, zero rework — reaches **submission readiness four
days after the target launch date**, with the Shopify review still entirely ahead
of it.

**What to commit to instead:**

- Commit to a **submission-readiness date**, not a launch date. Recommended:
  **2026-11-24** at 2 devs, **2026-12-22** at 1 dev. Choose the staffing, then the
  date follows — not the reverse.
- State launch as **"submission date + Shopify review turnaround"**, always as a
  range, never as a commitment, and budget for at least one rejection/resubmission
  cycle. Never run an SLA timer against G6.
- Re-baselining now costs a conversation. Re-baselining in week four costs the
  credibility of every date after it.

*(One genuine relief: G-PCD does **not** fire (§4). Had this app needed `read_orders`,
a second un-clockable external Shopify approval would sit in front of submission and
even these ranges would be optimistic.)*

### 11.6 Work that is real and was NOT inside the 250

These are priced explicitly in §11.3 rather than assumed away:

- **G5.5 observability + runbooks** — always required before G-Review (in M5).
- **App Store listing production** — screenshots, demo store, privacy policy, support
  URL, listing copy. Non-trivial and routinely underestimated (in M5).
- **G-Review remediation** — one round budgeted (A7); a second is not.
- **Design/mockup cycle.** **[src: sow]** budgets `0` homepage and `0` other-page
  mockup revisions. **G2 is never skipped for a public app**, and this is a visual
  product (charts, configuration tables, history views). Zero design iteration is not
  a plan; it is an unbudgeted assumption. This is why the G2 line in §11.3 spans
  8–36hr — the spread *is* OQ-8.

---

## 12. Conditional gates — what fires (G1 determination)

Recording which conditional gates fire is a G1 responsibility for an `app-build`.

| Gate | Fires? | Reason |
|---|---|---|
| **G1.5 Architecture Review** | **YES — confirmed** | Two triggers, both hold: **estimate >80hr** (225–390hr, §11.3 — certain) and an **undecided non-trivial hosting decision** (§8, OQ-1). Runs **before G-Schema**. Also owns: charting-library choice (D9 — donut/pie is not a Polaris web component; architecture + design decision), tenancy enforcement pattern, webhook-ack strategy under the 1s/5s window, decimal/currency precision approach. |
| **G-Schema** | **YES — always** | Dedicated DB, own migrations. The **config-snapshot vs FK** decision in §9 is the review's centre of gravity and the most likely place for a structural mistake. |
| **G2 Polaris UX** | **YES — reduced-UI candidate** | Full merchant-facing operational UI; never skipped for a public app. Whether it runs as a **reduced** review (build-from-SOW with sign-off) or a full mockup cycle is **OQ-8** and is the 8–36hr spread in §11.3. Recommendation: not reduced — this is a chart-heavy visual product. |
| **G-PCD** | **NO — skipped** | Reason of record: *"no protected (order/customer) scopes requested."* Confirmed at G0.5 (§4.1, OQ-10). Re-fires only on the §4.3 change-control trigger. |
| **G5.5** | YES (always) | Before G-Review. Priced in M5. |
| **G-Review** | YES (blocking, internal) | Must be green before G6 opens. One remediation round budgeted (A7). |
| **G6** | YES (external — Shopify) | `approver: "shopify"`, `sla_hours: null`. No internal SLA timer, no fabricated decision. |
| **Built for Shopify** | Post-launch, non-blocking | `built_for_shopify: false`. Not on the submission path. |

**Non-conditional gates not otherwise listed:** G0 (auto, spec validation), G3
(scaffold verification — blocked on OQ-2/OQ-3), G4×n (one per sprint, never
combined), G5 (per milestone), M6 (post-launch monitoring + health baseline).

---

## 13. Open questions

Nothing below is guessed. **Three are closed** (OQ-5, OQ-9, OQ-10 — answered at the
G0.5 decision on 2026-09-17). **Seven remain genuinely unanswered** and are carried
forward with the gate each one blocks. None of the seven blocks the G1 *decision*;
several block gates immediately after it.

### 13.1 Closed at G0.5

| # | Question | Answer | Recorded |
|---|---|---|---|
| **OQ-5** | Internal-vs-external client classification | **INTERNAL** — no external client entity. FLAG-004 blocklist moot/non-authoritative. Neither `webdeskinc.com` address is a verified contact; neither is to be used for anything. | §0.2 |
| **OQ-9** | `plan_tier: "basic"` meaning | **Internal WebDesk engagement-tier metadata**, NOT a Shopify merchant-plan functional constraint. No engineering consequence. | §0.3 |
| **OQ-10** | Revenue source | **Merchant-entered.** `protected_scopes: false`, `scopes: []` stand. G-PCD skipped. **Locked — not reopened at G1.** | §4.1 |

### 13.2 Still open — carried forward

| # | Question | Blocks | Owner |
|---|---|---|---|
| **OQ-1** | **Hosting provider, plan, and region.** Long-running Node vs serverless drives webhook-ack design and cold-start risk. | **G1.5** | Internal PM / Tech lead |
| **OQ-2** | **GitHub repo URL** — does one exist, or does WebDesk create it? Branch protection, who merges. | **G3** | Internal PM |
| **OQ-3** | **Credentials handoff protocol** — Shopify Partner/dev-store access, API credentials, DB provisioning, hosting access. Which vault (1Password? other)? **Credentials go through the PM channel, never directly to an agent.** | **G3** | Internal PM |
| **OQ-4** | **Default expense rates/values sign-off** for all 10 categories. Source doc explicitly leaves these unfinalised. Without them, D13 is unbuildable and D7's test fixtures are guesses. | **S2.1 / M2** (does not block the G1 decision) | Requesting stakeholder |
| **OQ-6** | **Project timezone (IANA).** Not supplied; not invented. Needed for SLA computation. Candidate `America/Toronto` — **requires confirmation, not assumption.** | **Gate SLA timers from G1 onward** | Internal PM |
| **OQ-7** | **Approver names for each gate** — design lead, dev lead, QA lead are all "TBD" in the source. A gate cannot open without a named approver, and **approver ≠ doer**. Now scoped to **internal WebDesk** names only (OQ-5 closed). | **Every human gate from G1.5 onward** | Internal PM |
| **OQ-8** | **Design path.** `0/0` mockup revisions budgeted, but G2 is mandatory and this is a chart-heavy UI. Design phase, or explicit build-from-SOW sign-off? Drives the 8–36hr G2 line in §11.3. | **G2** | Internal PM / Design lead |

**Severity note:** OQ-1 and OQ-8 are the two that materially move the §11.3 number —
they are the reason confidence is LOW rather than MEDIUM. OQ-4 does not move the
estimate but makes M2 unstartable. OQ-2 and OQ-3 are logistics, but they gate G3 and
therefore the whole build start; unanswered, they push every date in §11.5
one-for-one.

---

## 14. Verify-at-build register

| Item | Why |
|---|---|
| Whether `shop` Admin GraphQL fields (currency, name, timezone) need an explicit access scope in 2026-07 | Decides whether `scopes: []` holds (§4.3) |
| Free-app pricing declaration requirements on the App Store listing | §6 |
| Admin GraphQL release cadence / supported-version window | §7 |
| Compliance-webhook `compliance_topics` TOML shape and exact timing windows | §10 |
| Current Built-for-Shopify criteria | Post-launch only |

---

_Last updated 2026-09-17 by pm-agent. §0–§10, §12–§14 are **G0.5-confirmed**
(CONFIRM by `sales@webdesksolution.ca`, 2026-09-17T18:02:16Z). §11 (plan + estimate)
is the **G1 artifact and is pending a human decision** — approver: PM lead;
`ticket_id: EXPCALC-G1-EST-001`. §9's data model stays a **draft until G-Schema**.
Gate decisions are humans', not this document's, and `project.json` — not this file —
is the single source of truth for gate status._
