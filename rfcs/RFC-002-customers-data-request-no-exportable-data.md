# RFC-002 — `customers/data_request` requires no delivery-transport mechanism: this app holds no customer-identified data

| | |
|---|---|
| **Status** | PROPOSED — awaiting Tech lead confirmation at G-Review. Not self-approved. PM does not approve gates. |
| **Date** | 2026-09-18 |
| **Author** | pm-agent (on instruction from orchestrator) |
| **Type** | Compliance determination + documentation of record (closes a QA finding; no architecture reversal) |
| **Resolves** | **F6**, `qa-reports/G4-sprint-1.1.md`: *"`customers/data_request` delivery-transport gap is real and honestly disclosed; needs an RFC before G-Review."* |
| **Also supersedes** | The `KNOWN GAP` comment block in `app/services/compliance/customers-data-request.service.ts` (lines 15–27), which called for "an ADR or spec amendment … to pick a delivery mechanism" |
| **Related** | spec.md §4, §10, §14 · ADR-0006 (zero Admin API dependency) · ADR-0008 (uninstall vs redact lifecycle) · ADR-0002 (webhook durable inbox) · `decisions/data-model.md` §4, §5 |
| **Impacts** | No ADR is reversed. No architecture decision changes. No schema change. |
| **Protected-data impact** | **None.** `scopes: []`, `protected_scopes: false` unchanged. **G-PCD stays `skipped`** and this RFC does not reopen it. |
| **Triggers G1 RENEGOTIATE** | **NO.** Zero estimate movement. See §7. |
| **project.json** | Not written by this RFC. Orchestrator records under lock. |

---

## 1. The question F6 actually asks

`customers/data_request` is the webhook Shopify sends when a shop's **customer**
exercises a data-subject access right and the shop must tell that customer what
each installed app holds about them. The documented Shopify pattern is that the
app **provides the data to the store owner**, who forwards it to the customer —
the app does not transmit anything to the customer directly.

F6's premise was that "provide the data to the store owner" implies an **outbound
transport** (email, Partner-Dashboard message, in-app record), and that none is
specified anywhere in `spec.md` D1–D16, the architecture packet, or any ADR. That
premise is correct as far as it goes — no transport is specified, and the handler
comment says so honestly rather than inventing one.

But it skipped the prior question. **A transport is only required if there is a
payload to transport.** This RFC establishes, by direct inspection rather than by
restating the spec, that there is none — and therefore that the correct compliant
behaviour is exactly what is already implemented.

## 2. Determination

> **`customers/data_request` requires no delivery-transport mechanism for this
> app. The app holds no data keyed to any customer identity, so there is nothing
> to compile, nothing to export, and nothing to transmit. The complete and
> compliant fulfilment of the request is the factual statement "this app holds no
> records about this customer," evidenced by a durable audit row.**
>
> **`app/services/compliance/customers-data-request.service.ts` needs no
> functional change.** Its ack-verify-dedup-record behaviour is correct. What was
> missing was this document.

Two small accuracy/hardening items, neither of which blocks the determination and
neither of which is a transport, are carried in §6.

## 3. The evidence — checked, not asserted

Everything below was verified against the repository at this commit. This section
exists so a Tech lead can confirm the determination without taking anyone's word
for it.

### 3.1 The app requests zero access scopes

- `shopify.app.toml` → `[access_scopes]`, `scopes = ""`, `optional_scopes = [ ]`.
- `app/shopify.server.ts:56` → `scopes: process.env.SCOPES ? … : []`, guarded by
  a file-header comment marking `scopes: []` as a **locked** invariant
  (G0.5 OQ-10, ADR-0006).
- `qa-reports/G4-sprint-1.1.md` "GraphQL contract: PASS — verified by direct grep,
  zero `admin.graphql(` / REST call sites."

The app therefore has **no read path to `customers`, `orders`, `draft_orders`,
`checkouts`, or any other object carrying buyer identity**. There is no mechanism
by which customer data could enter this system from Shopify in the first place.
Revenue is 100% merchant-entered (spec.md §4.1, five independent signals in §4.2,
confirmed by `sales@webdesksolution.ca` at G0.5).

### 3.2 No table anywhere is keyed to a customer identity

The full schema is eight tables. I enumerated every column of every one against
`db/migrations/20260918120000-initial-schema.cjs`,
`db/migrations/20260918130000-add-job-heartbeat.cjs`, and `app/db/models/*`.

| Table | Every identity-bearing column it has | Customer-identified? |
|---|---|---|
| `shop` | `shop_domain` (e.g. `foo.myshopify.com`) | No — merchant/tenant identity |
| `expense_rule` | `shop_id`, `category_key` | No — config values only |
| `calculation` | `shop_id`; `revenue_minor`, `currency_code`, totals, `engine_version` | No — merchant-entered figures |
| `calculation_line_item` | `shop_id`, `calculation_id`, snapshot columns | No — computed figures + rule snapshot |
| `webhook_event` | `shop_id`, `shop_domain`, `webhook_id`, `topic`, `payload` JSONB | **See §3.3** — the one nuance |
| `compliance_audit_log` | `shop_domain`, `webhook_id`, `topic`, `outcome`, `reason` | No |
| `job_heartbeat` | `job_name` (currently one row, `'cron_tick'`) | No |
| `shopify_sessions` | library-managed; correlated by its own `shop` text column | No — see §3.4 |

There is **no `customer_id` column, no `customer_email` column, no email/phone/
name/address column, and no order-derived column anywhere in the schema.** A
grep across `app/`, `db/` for `customer|email|phone|orders_requested|first_name|
last_name|address` returns hits in exactly eleven files — all of them the
compliance-webhook plumbing itself (routes, services, inbox, drain worker, the
`topic` CHECK-constraint literals, and the model type unions). Not one is a
storage site for customer attributes.

This is also structurally load-bearing, not incidental: `decisions/data-model.md`
§4 defines every tenant table as `shop_id`-keyed, and there is no second tenancy
axis in the design. The system has exactly one subject — the shop.

### 3.3 The one nuance, named rather than glossed: `webhook_event.payload`

Honesty requires naming the single place where a customer identifier can
physically land in this database, because a reviewer who inspects the DB will
find it and it would otherwise look like this RFC overclaimed.

`app/services/webhook-inbox.service.ts:51-57` inserts the **verbatim webhook
body** into `webhook_event.payload` (`JSONB NOT NULL`, migration line 186) for
all four topics. For `customers/data_request` and `customers/redact`, Shopify's
body contains a `customer` object (id, email, phone) and `orders_requested`.

That is customer PII, and it is in the database. Three facts bound it, and none
of them change the determination:

1. **It is the request, not the holding.** It is data Shopify sends *in order to
   identify whose record is being asked about*. It is not data the app collected,
   derived, or retained about that customer's relationship with the shop. There
   is nothing to "export back" — the requester already has it; it originated with
   them.
2. **It is never read.** `app/workers/drain-worker.ts:32,37` dispatch
   `handleCustomersDataRequest(row.shopDomain, row.webhookId, transaction)` and
   `handleCustomersRedact(...)` — **neither handler receives or reads
   `row.payload`.** Verified by direct read of both service signatures. No query,
   index, join, log line, or UI surface in the app touches that column for these
   topics.
3. **It is bounded and deleted.** `webhook_event.shop_id` is
   `NOT NULL REFERENCES shop(id) ON DELETE CASCADE`, so `shop/redact` removes it
   (data-model.md §5). Independently, `runWebhookEventPruning()`
   (`app/workers/sweeper.ts:144-149`, `WEBHOOK_EVENT_RETENTION_DAYS`, default 30)
   hard-deletes processed rows on the cron tick.

Because the column is written but never read for these topics, §6.2 recommends
not persisting it at all for `customers/*` — a data-minimisation improvement, not
a prerequisite for this determination.

### 3.4 Sessions hold no customer identity either

`app/shopify.server.ts` configures `future.expiringOfflineAccessTokens: true` and
sets no `useOnlineTokens` / `isOnline` anywhere, so sessions are **offline** and
carry no `onlineAccessInfo.associated_user` block. Even had they been online, an
associated user is **merchant staff**, not a shop customer, and is outside
`customers/data_request`'s subject matter entirely. `shopify_sessions` is
correlated to a shop only by its own `shop` text column (data-model.md §7).

### 3.5 The scope boundary that keeps it this way is enforced, not hoped for

`spec.md` §3 puts storefront/customer-facing surfaces, analytics, reporting,
accounting integrations, multi-store consolidation, and **"reading actual store
revenue from Shopify"** out of scope as binding boundaries. ADR-0006 makes
`scopes: []` an architectural invariant with **CI enforcement** (FT-11 breaks the
build if an Admin GraphQL call appears). `spec.md` §4.3 defines the change-control
trigger: any request to auto-fill revenue from real sales flips
`protected_scopes: true`, fires **G-PCD** as an external Shopify gate that must be
granted *before* G6 submission, and forces RFC → ADR plus a G1 RENEGOTIATE (A1,
+60–120hr).

**If that trigger ever fires, this RFC is void and must be re-derived.** That is
the one condition under which a real export mechanism becomes necessary work.

## 4. Why the current implementation is already the compliant answer

The three mandatory privacy webhooks must do real work, not return a bare 200
(spec.md §10 — a stub fails app review). Against that bar, the current handler:

| Requirement | Where it is satisfied |
|---|---|
| HMAC verification, 401 on invalid | `authenticate.webhook(request)` in `app/routes/webhooks.customers-data-request.tsx:14` |
| Dedup on `X-Shopify-Webhook-Id` | `webhook_event.webhook_id` UNIQUE (migration line 182; data-model.md §4.5 — the index *is* the dedup) |
| Fast 2xx ack inside the 1s/5s budget | Route does one insert and returns; all work is drained asynchronously (ADR-0002, ADR-0009) |
| **A documented, logged no-op-with-reason** | `recordComplianceOutcome(...)` writes a durable `compliance_audit_log` row carrying the stated reason |
| Durable evidence that survives shop deletion | `compliance_audit_log` deliberately carries **no `shop_id` and no FK to `shop`** (data-model.md §5) — it is outside the redaction sweep by design, precisely so the proof outlives the data |
| Minimal 2xx body, no PII echoed | `return new Response(null, { status: 200 })` |

**This is the artifact spec.md §10 predicted G-Review would ask for**, and it
exists per-delivery, per-shop, timestamped, in the database — a stronger position
than a transport would have produced, because a sent email proves nothing after
the fact whereas a `compliance_audit_log` row is the evidence itself.

A delivery mechanism built on top of this would transmit a fixed, content-free
sentence to the merchant. It would add an outbound-email dependency to an app
that otherwise sends **no merchant-facing email at all** (the handler comment
notes this), add a secret to manage, an SPF/DKIM/deliverability surface, a
failure mode on a GDPR-critical path, and a new class of thing that can silently
stop working — in exchange for zero additional information reaching anybody.
**Declining to build it is the correct engineering decision, not a shortcut.**

## 5. How the merchant actually gets the answer

The determination must still be reachable by a human, or it is only true inside
the database. Three surfaces, all documentation, none code:

1. **The audit row** — queryable per `webhook_id` / `shop_domain`, the
   authoritative per-request record.
2. **The privacy policy** (D16 / S5.3 listing deliverable, M5) must state plainly
   that the app collects and stores no customer personal data, so a merchant
   answering their customer has a citable source without contacting support.
   **Action item for S5.3 — this RFC is the source text.**
3. **A support-response template** for the rare merchant who asks directly,
   stating the same fact and how to verify it. Folded into the G-Review artifact
   set, not a product feature.

**Verify-at-build (carried to §8 of the register):** confirm Shopify's current
documented expectation for `customers/data_request` against the 2026-07 Partner
docs at G-Review — specifically whether any response body, acknowledgement
format, or merchant-notification step is prescribed for the nothing-to-report
case. Compliance-webhook requirements are version-specific and this RFC does not
assert current-day Shopify wording from memory. **Nothing found in this repo
suggests one is required, and the app's 200-with-empty-body + durable audit row
satisfies every requirement recorded in `spec.md` §10.**

## 6. Recommended follow-ups — small, not blockers, not transports

Neither item below changes behaviour or the determination. Both are recommended
before G-Review. Combined: **≤ 2.5 hours**, confidence MEDIUM (small, bounded,
touches files already under test).

### 6.1 Correct two inaccurate statements in the handler (~0.5hr, P3, recommended)

`app/services/compliance/customers-data-request.service.ts` currently persists,
into the compliance audit trail, this reason string:

> `"… the compiled report to the store owner states that no records exist for the requested customer."`

**No report is compiled and none is delivered to a store owner.** The audit trail
is the app's compliance evidence of record; a row asserting an action that did not
occur is worse than a row asserting nothing, and it is exactly the sort of thing a
reviewer or a DPA reads literally. Replace with a statement of what actually
happened — no records exist for any customer identity, there is nothing to compile
or transmit, per RFC-002.

Second, the `KNOWN GAP` block (lines 15–27) instructs a future reader that "an ADR
or spec amendment is needed before G-Review to pick a delivery mechanism." **This
RFC is that determination, and the answer is that no mechanism is needed.** Leaving
the comment in place leaves a live-looking open gap pointing at closed work.
Replace with a pointer to this RFC.

Also worth the Tech lead's eye at review, though defensible either way: this
handler records `outcome: 'completed'` while `customers-redact.service.ts` records
`outcome: 'no_op'` for the same underlying "nothing to do" condition. `completed`
is arguably right — the request *is* fully discharged — but the two topics should
be consistent by intent, not by accident. Pick one rationale and write it down.

### 6.2 Stop persisting the customer block for `customers/*` (~1–2hr, P3, recommended)

Per §3.3, `webhook_event.payload` stores customer PII that **no code path ever
reads**. Storing personal data with no processing purpose is the definition of
what data minimisation prohibits, and it is avoidable here at near-zero cost.

Scoped recommendation — the developer's task, not built here:

- In `ackAndEnqueueWebhook` (`app/services/webhook-inbox.service.ts`), for topics
  `customers/data_request` and `customers/redact`, insert a minimal placeholder
  (e.g. `{ redacted: true, note: "payload not retained — RFC-002 §6.2" }`) in
  place of the raw body. `shop/redact` and `app/uninstalled` keep their bodies —
  they carry no customer identity.
- No schema change: `payload` stays `JSONB NOT NULL`.
- Safe because no handler reads it (verified, §3.3 item 2) — but the developer
  must re-confirm that at implementation time rather than trusting this RFC.
- Add a test asserting the stored payload for both `customers/*` topics contains
  no `customer` key, so a future change reintroducing the raw body fails CI.
- Retention/cascade behaviour (§3.3 item 3) is unaffected and stays as the
  backstop.

**This is a hardening improvement. It is not required for the determination in §2
and must not be allowed to hold F6 open.**

## 7. Estimate and gate impact

- **Estimate movement: zero** against the G1 range of 225–390hr
  (`ticket_id: EXPCALC-G1-EST-001`). No G1 RENEGOTIATE. The §6 follow-ups
  (≤2.5hr) sit inside M5 hardening, which already budgets this class of work.
- **G-PCD: unchanged, `skipped`.** Reason of record stands: *"no protected
  (order/customer) scopes requested."* This RFC reinforces that determination and
  does not reopen it. No Partner-Dashboard protected-data request is created and
  none is needed.
- **G-Review:** F6 moves from open finding to a confirmable artifact. The
  reviewer's job is to confirm §3 by inspection, not to accept §2 on trust.
- **No ADR is superseded.** If the Tech lead prefers this determination carry ADR
  weight rather than RFC weight, promoting it to an ADR is a formatting exercise
  — the substance does not change. PM recommendation: RFC is the right instrument,
  because nothing is being *decided* here, only *established*.

## 8. Verify-at-build items

| Item | Why |
|---|---|
| Shopify's current documented expectation for `customers/data_request` in the nothing-to-report case (response body? prescribed merchant notification?) | §5 — compliance-webhook requirements are version-specific; confirm against 2026-07 at G-Review rather than asserting remembered wording |
| Whether `compliance_topics` TOML shape / delivery-timing windows changed for 2026-07 | Already carried in spec.md §14 and data-model.md §10; touches this handler |

## 9. What a Tech lead is being asked to confirm

Not the prose. These five checkable facts:

1. `shopify.app.toml` declares `scopes = ""` and no Admin GraphQL call site exists
   (re-grep `admin.graphql(`).
2. No column in any of the eight tables is keyed to a customer identity
   (`db/migrations/*.cjs`, `app/db/models/*`).
3. `webhook_event.payload` is the only place customer PII can land, is never read
   for `customers/*`, and is both cascade-deleted and retention-pruned.
4. The handler verifies HMAC, dedups, acks fast, and writes a durable
   reasoned `compliance_audit_log` row that survives shop deletion.
5. Therefore: nothing to export ⇒ no transport required ⇒ **F6 closed as
   documentation**, with §6 as recommended (non-blocking) follow-ups.

If any of the five does not hold on inspection, this RFC is wrong and F6 stays
open. That is the intended failure mode.

---

_PROPOSED. Not approved. Gate decisions belong to humans, and `project.json` —
not this file — is the single source of truth for gate status. This RFC writes
nothing to `project.json`; the orchestrator records it under lock._
