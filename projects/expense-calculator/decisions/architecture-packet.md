# G1.5 Architecture Packet — expense-calculator

| | |
|---|---|
| **Gate** | G1.5 — architecture review (conditional; FIRED) |
| **Triggers** | estimate 225–390hr (>80hr) · hosting undecided (`hosting: tbd`, OQ-1) |
| **Status** | **PROPOSED — awaiting tech-lead approval. Not self-approved.** |
| **Author** | architect-agent, 2026-09-17 |
| **Approver** | Tech lead (named approver = OQ-7, still open) |
| **Inputs** | `project.json` v5 · `spec.md` (g0.5-confirmed) · G1 estimate `EXPCALC-G1-EST-001` |
| **Next gate** | G-Schema (see §8 handoff) |

Settled before this gate and **not reopened here**: `protected_scopes=false`,
`scopes=[]`, `data_ownership=dedicated`, `jobs_ownership=app`,
`app_pricing.model=free`, `api_version=2026-07`, `distribution=public`.

---

## 1. Decisions taken at this gate

| ADR | Decision | Reversibility |
|---|---|---|
| [ADR-0001](./ADR-0001-hosting-long-running-node.md) | **Hosting: long-running always-on Node process**, not serverless | Medium — ~10–25hr to reverse (A6) |
| [ADR-0002](./ADR-0002-webhook-durable-inbox.md) | Webhook processing: **Postgres durable inbox + fast 2xx ack + in-process drain worker**; no external broker | Easy |
| [ADR-0003](./ADR-0003-tenancy-repository-layer.md) | Tenancy: **shop scoping enforced centrally in a repository layer**, not per call-site | Hard once code exists |
| [ADR-0004](./ADR-0004-charting-inline-svg-donut.md) | Visualisation: **hand-rolled inline SVG donut + always-rendered data table**; no charting library | Easy |
| [ADR-0005](./ADR-0005-money-integer-minor-units.md) | Money: **integer minor units end-to-end** with a documented rounding + largest-remainder policy | Hard (data migration) |
| [ADR-0006](./ADR-0006-zero-admin-api-dependency.md) | **No Admin GraphQL call on any core path**; currency/locale is merchant-configured | Easy |
| [ADR-0007](./ADR-0007-session-storage-postgres.md) | Session storage: **library-managed Postgres store is the sole auth state**; no deviation, no custom cookies | Medium |
| [ADR-0008](./ADR-0008-uninstall-vs-redact-lifecycle.md) | Data lifecycle: **uninstall soft-marks + kills sessions; `shop/redact` hard-deletes; 45-day safety sweeper** | Easy |

The four questions spec.md §12 explicitly assigned to G1.5 — hosting, charting,
tenancy pattern, webhook-ack strategy — are answered by ADR-0001, 0004, 0003, 0002
respectively. Decimal/currency precision (also assigned here) is ADR-0005.

---

## 2. Context diagram

```
┌──────────────────────── Shopify ────────────────────────┐
│                                                          │
│  Admin (merchant browser)          Shopify platform      │
│   └─ iframe ──────────────┐          └─ webhook sender   │
│      session token (JWT)  │             HMAC-signed      │
└───────────────────────────┼────────────────┬─────────────┘
                            │                │
                 session-token │              │ POST /webhooks/*
                 exchange      │              │ (1s connect / 5s total)
                            ▼                ▼
        ┌──────────────────────────────────────────────────┐
        │  APP HOST — single always-on Node 22 process     │
        │  (React Router 7 SSR, ADR-0001)                  │
        │                                                  │
        │  ┌── routes ─────────────────────────────────┐   │
        │  │ app.*        → authenticate.admin         │   │
        │  │ auth.$       → token exchange             │   │
        │  │ webhooks.*   → authenticate.webhook (HMAC)│   │
        │  │ healthz      → no auth, static            │   │
        │  └───────────────────────────────────────────┘   │
        │  ┌── services ───────────────────────────────┐   │
        │  │ calculation engine (pure, deterministic)  │   │
        │  │ rule config · snapshot builder            │   │
        │  │ compliance handlers (redact / data_req)   │   │
        │  └───────────────────────────────────────────┘   │
        │  ┌── repositories (sole shop-scope choke pt) ┐   │
        │  └───────────────────────────────────────────┘   │
        │  ┌── inbox drain worker (in-process interval)┐   │
        │  └───────────────────────────────────────────┘   │
        └───────────────────────┬──────────────────────────┘
                                │ single Sequelize pool
                                ▼
        ┌──────────────────────────────────────────────────┐
        │  Managed PostgreSQL — SAME REGION (dedicated)     │
        │  shopify_sessions (library-managed)               │
        │  shop · expense_rule · calculation ·              │
        │  calculation_line_item · webhook_event(inbox)     │
        └──────────────────────────────────────────────────┘

CDN (browser-side, not through the app host):
  app-bridge.js · polaris.js  — always latest, never vendored (Req 2.2.3)

NOT PRESENT, deliberately: Admin GraphQL client on any core path (ADR-0006),
Billing API, message broker, Redis, scheduler service, storefront surface,
extensions, third-party integrations.
```

**External dependencies: three.** Shopify platform (auth + webhooks), the
Shopify CDN (App Bridge/Polaris, browser-side only), and our own Postgres.
That is the whole blast-radius surface. Keeping it at three is itself a decision
(ADR-0002, ADR-0004, ADR-0006 each avoid adding a fourth).

---

## 3. Component breakdown

| Layer | Responsibility | May import | May NOT import |
|---|---|---|---|
| **routes/** | HTTP boundary only: authenticate per the route matrix, parse/validate input, call one service, render | services, UI components | Sequelize models, `db/` directly |
| **services/** | Business logic. The calculation engine is a **pure function** (no I/O, no clock, no random) | repositories, domain types | routes, request/response objects |
| **repositories/** | The **only** place Sequelize models are touched. Every function takes a `ShopContext` as its first argument and applies the `shop_id` predicate | models | services, routes |
| **models/** | Sequelize model definitions + migrations | — | everything above |
| **worker/** | In-process inbox drain (ADR-0002). Calls services, never routes | services, repositories | routes |

Route-authentication matrix (per `shopify-app-auth-and-routes`, no deviation):

| Route | Mechanism | Notes |
|---|---|---|
| `app.*` (embedded) | `authenticate.admin(request)` — session-token JWT | Works without third-party cookies |
| `auth.$` | token exchange + managed installation | No OAuth redirect flow |
| `webhooks.*` | `authenticate.webhook(request)` — HMAC, **401 on invalid** | **Must NOT be nested under the `app` layout route.** `session` may be `undefined` (already uninstalled) — handle it |
| `healthz` | none | Static body. No store data, no shop identifiers |
| app proxy / extensions | — | **None.** `extensions: []` |

---

## 4. Stack justification

The stack was set at grooming; this gate confirms it is load-bearing-correct
rather than inherited by default.

| Choice | Why it holds for *this* app | Cost accepted |
|---|---|---|
| **React Router 7 + `@shopify/shopify-app-react-router`** | Current official template; the Remix template is deprecated. Gives token exchange, session storage adapters, `authenticate.*`, and `addDocumentResponseHeaders` (CSP `frame-ancestors`, required for embedding) without hand-rolling | Framework-version churn tracks Shopify's template |
| **Node 22 (long-running)** | See ADR-0001 | Idle cost |
| **Polaris web components + App Bridge from CDN** | Polaris React was archived Jan 2026. CDN load = always-latest App Bridge (Req 2.2.3). Both scripts in `<head>` of **every** page, API-key `<meta>` **before** `app-bridge.js` | Component/attribute set is versioned — verify-at-build |
| **PostgreSQL, dedicated** | Correct default per `shopify-data-jobs-ownership`: no shared-SaaS platform exists here, so no shared-data contract and no SaaS-side migration ownership. App owns its own migrations and queue. Also doubles as the durable inbox and the session store — one dependency doing three jobs | We own backups, migrations, pooling |
| **Sequelize** | WebDesk standard. Assumes a stable connection pool — which ADR-0001 provides and serverless would not | Not Prisma; template default is overridden deliberately |
| **`PostgreSQLSessionStorage`** | ADR-0007. Documented deviation from the template's Prisma/SQLite default | — |
| **Admin API: GraphQL only** | REST is prohibited for new public apps (Req 2.2.4). Moot in practice — ADR-0006 puts zero Admin API calls on core paths — but the prohibition is still enforced (FT-10) so it can't creep in | — |
| **`ApiVersion.July26` (2026-07), pinned** | Never resolve "latest". A `2026-10` version will land before launch; **do not chase it mid-build** (A8). Exposure is unusually low here because the Admin API surface is ~zero | Deliberate quarterly upgrade project post-launch (M6) |
| **`future.expiringOfflineAccessTokens: true`** | Offline tokens expire (60-min) with a `refresh_token`. Required for new public apps since 2026-04-01; all public apps by 2027-01-01. Build with it day one | Verify at build whether the installed major line already defaults it on |

---

## 5. Answers to the three confirmation questions

### 5.1 Admin GraphQL cost / rate-limit strategy — **NOT NEEDED. Confirmed.**

I walked D1–D16 looking for anything that issues an Admin GraphQL call:

| Deliverable | Admin API call? |
|---|---|
| D1 app shell | No — App Bridge is browser-side CDN |
| D2 install/auth/session | No merchant-scoped query. Token exchange is a library auth call, not a data query |
| D3 compliance webhooks | No — `compliance_topics` are declared in `shopify.app.toml`; `app/uninstalled` is a declarative `[[webhooks.subscriptions]]`. No registration mutation at runtime (verify-at-build: exact TOML shape for 2026-07) |
| D4–D8, D10–D13 | No — merchant-entered data and app-owned rows only |
| D9 chart | No — client-side render of app data (ADR-0004) |
| D14–D16 | No |

**The only candidate in the entire scope** was cosmetic shop metadata
(`shop { currencyCode name ianaTimezone }`) for display formatting. ADR-0006
removes even that from the core path. So:

- **No bulk operations.** `bulkOperationRunQuery` / `bulkOperationRunMutation`
  have no use here — there is no export, backfill, or large read.
- **No pagination of large connections**, no cost-budget tuning, no
  `extensions.cost` inspection loop, no throttle/backoff layer.
- Even in the worst case (ADR-0006's fallback is rejected and we do query `shop`
  once per session), it is a single low-cost query against a leaky bucket — a
  rate-limit *strategy* would be architecture theatre.

**What replaces the strategy is an invariant, not an assumption:** FT-11 fails
CI if an `admin.graphql(` call site appears outside an (empty) allowlist, and
FT-10 fails on any REST usage. If a future feature needs an Admin call, CI breaks
and it arrives as an RFC — not silently.

### 5.2 Billing architecture — **TRIVIAL. Confirmed.**

`app_pricing.model: free`. Therefore **none of the following exist in V1**:
Billing/App-Pricing API integration, App Events API, client-credentials billing
auth, usage meters, capped-amount / spend-limit enforcement, Historical-API
reconciliation, idempotency keys for charges, `app_subscriptions/*` webhooks,
subscription-state tables, or the `write_global_api_app_events` scope.

Two architectural instructions follow from "free", and they are the only billing
content of this gate:

1. **Do not pre-build a billing abstraction.** No `PlanService`, no
   `entitlements` table, no feature flags "for when we go paid". A2 already
   prices adding billing later at +25–45hr with a G1 RENEGOTIATE; a speculative
   seam built now will be the wrong seam then and costs QA surface today.
2. **The listing must declare the app Free** — a G-Review checklist item, not an
   engineering one. Free-app pricing-declaration fields change: **verify at build**
   against the Partner Dashboard at listing time.

### 5.3 Auth + session storage — **DEFAULT STANDS. No deviation. Confirmed.**

Token exchange + managed installation (no OAuth redirect flow), route auth per
the matrix in §3, `PostgreSQLSessionStorage` against the app's own Postgres.
Reasons to deviate would be cross-process session sharing at scale, sub-ms
session reads, or a session store the app host can't reach — **none apply**: one
process, one region-local Postgres, low volume. Adding Redis here would buy
nothing and add a fourth external dependency. Detail and lifecycle in ADR-0007.

---

## 6. Non-functional requirements

| NFR | Target | How it is held |
|---|---|---|
| **Webhook ack latency** | p95 < 500ms, hard ceiling 1s — inside Shopify's 1s connect / 5s total | ADR-0002 (ack before work), FT-06, production alert |
| **Webhook endpoint availability** | ≥ 99.9% — the one availability number that actually matters | Always-on instance (ADR-0001), health-check-gated rolling deploys, Shopify retries + durable inbox cover the restart window |
| **Embedded first paint** | < 2.5s warm, no cold-start tier in the path | ADR-0001 (min instances = 1) |
| **Calculation latency** | p95 < 200ms server-side | Pure in-memory arithmetic; no I/O in the engine |
| **Determinism** | Identical inputs + identical config ⇒ byte-identical output, across runs and across process restarts (D7) | ADR-0005 + `engine_version`, FT-13 golden file |
| **History immutability** | Editing live rules never alters a saved calculation (D11) | Snapshot (§8), FT-14 |
| **Tenant isolation** | Zero cross-shop reads | ADR-0003, FT-02 negative tests |
| **GDPR deletion** | `shop/redact` acted on within 30 days, verifiably complete | ADR-0008, FT-08 (table-enumerating), 45-day sweeper |
| **Durability** | No data loss on redeploy or restart; daily backups + PITR where the provider offers it | All state in Postgres; zero in-process state (FT-15) |
| **Security** | No customer PII stored; secrets only in platform env/vault; no secrets or PII in logs; HMAC on every webhook; CSP via `addDocumentResponseHeaders` | FT-05, FT-09, FT-16 |
| **Scale** | Low hundreds of shops on one instance. **Revisit trigger:** sustained CPU > 60% or > 50 req/s | Stateless app ⇒ scaling out is adding instances, not re-architecting |
| **Observability** | Structured JSON logs with request-id and `webhook_id` correlation; alerts on webhook 5xx rate, inbox rows stuck > 15min, error rate, unexpected restarts | G5.5 owns the runbooks; the alert list is an input to it |

---

## 7. Risk register

| # | Risk | Severity | Mitigation | Owner |
|---|---|---|---|---|
| R1 | A sleeping/free hosting tier is chosen anyway → cold start → webhook delivery failures | **High** | `min instances = 1` is a hard procurement requirement in ADR-0001; webhook-latency alert catches it in production | Tech lead at procurement |
| R2 | `shop/redact` is never delivered (delivery is retried, not guaranteed forever) → shop data retained past 30 days → **GDPR breach** | **High** | 45-day safety sweeper purges shops with `uninstalled_at` older than the window regardless of webhook receipt (ADR-0008). This is the failure mode a webhook-only design silently loses | Build (M1) |
| R3 | Config snapshot implemented as an FK to live rules → history mutates → D11 fails at QA or, worse, in production | **High** | ADR index + §8 handoff to G-Schema + FT-14; repository-boundary rule forbids the history read path from importing the rule model | G-Schema |
| R4 | Float arithmetic on money → penny drift, per-category totals that don't reconcile, non-determinism | **High** | ADR-0005 branded integer minor units + FT-13 | Build (M3) |
| R5 | `scopes: []` proves untenable at build for shop currency in 2026-07 | Medium | ADR-0006 fallback (merchant-configured currency) keeps `scopes: []` intact. If a scope is genuinely unavoidable it is an **RFC**, not a quiet addition | Build (M1), verify-at-build |
| R6 | Chart-only representation fails accessibility at G2/G-Review | Medium | ADR-0004 makes the data table the primary representation and the chart the enhancement | Build (M3) |
| R7 | Single instance → brief unavailability during deploy/restart | Medium | Rolling, health-check-gated deploys; durable inbox + Shopify retry make a missed webhook recoverable rather than lost | Build (M5) |
| R8 | API version `2026-10` lands before launch and someone bumps it mid-build | Medium | A8 holds: pin `2026-07` through submission; the bump is its own post-launch project (M6). FT enforces the pinned constant | Build |
| R9 | Provider lock-in via platform-specific queue/background primitives | Low | ADR-0002 keeps the queue in Postgres; the app is a plain Node container with a `DATABASE_URL` | Build |
| R10 | Hosting provider/plan/region (OQ-1 procurement half) still unanswered after this gate | Medium | ADR-0001 decides the **class** and states six hard requirements; provider selection is an ops choice that must satisfy them. G1.5 approval should not be blocked on procurement — but **G3/M1 is** | Internal PM (OQ-1/OQ-3) |

---

## 8. Handoff to G-Schema

G-Schema owns the data model. This gate does **not** design it. What follows are
the structural implications the architecture creates, which G-Schema must resolve.
Everything here is a **DRAFT input**, not an approved model.

### 8.1 The config snapshot — the centre of gravity (spec.md §9, §12)

D11 requires that editing defaults never mutates history. The structural
implication of that, and of ADR-0005's determinism requirement:

1. **A saved calculation must render with zero joins to `expense_rule` or any
   live category source.** Not "a nullable FK we only read for convenience" — an
   informational FK invites a join and the first `include:` that lands makes
   history mutable again. Recommendation: **no FK at all** from
   `calculation_line_item` to `expense_rule`.
2. **Snapshot by value, with typed columns, not only a JSONB blob.** Suggested
   per line item: `category_key`, `category_label_at_save`, `rule_type`,
   `rule_value`, `computed_amount_minor`. Typed columns keep history queryable
   and testable; a blob alone makes FT-14 and any future comparison view painful.
   A blob *in addition* is fine as an audit record.
3. **Category identity must be a stable string `category_key`** (e.g.
   `cost_of_goods`), not a row id. App-seeded rows can be reseeded or renumbered
   across environments; a snapshot keyed on an integer id is a landmine. The
   display label is snapshotted separately so renaming a category doesn't rewrite
   history.
4. **`engine_version` on `calculation`.** Determinism is only meaningful if the
   engine that produced a number is identifiable. History renders **stored**
   values and never recomputes.
5. **Currency code stored on the calculation**, alongside integer minor units
   (ADR-0005). Do not infer currency at render time.
6. **Calculations are append-only.** No UPDATE path. G-Schema should decide
   whether that's a DB trigger, a repository-only invariant, or both; FT-14
   tests the behaviour either way.

### 8.2 `ExpenseCategory`: global table vs per-shop rows — a live question

Spec §9 leaves this open. Architectural input, not a decision: given A4 (the 10
categories are fixed, app-seeded, merchants cannot create categories), a
**category table may not be needed at all** — a code-level constant keyed by
`category_key`, with per-shop `expense_rule` rows referencing the key, removes
seed migrations, seed drift between environments, and a table that GDPR deletion
must be careful *not* to delete. A global table also breaks the uniform
"every tenant table has `shop_id`" rule that FT-02 and FT-08 depend on.
G-Schema decides; flagging the consequence.

### 8.3 Tables the architecture adds

- **`webhook_event` (inbox)** — ADR-0002. Needs a **unique index on
  `webhook_id`** (that index *is* the dedup mechanism), plus topic, shop, payload,
  received_at, processed_at, attempts, last_error, and a pruning policy for
  processed rows.
- **`shop.uninstalled_at`** — ADR-0008, drives both reinstall behaviour and the
  45-day safety sweeper.
- **Shop-scope column placement:** recommend `shop_id` denormalised onto **every**
  tenant table including `calculation_line_item`, rather than reaching shop
  through a join. It makes the tenancy predicate uniform (ADR-0003), makes
  `shop/redact` one delete per table, and makes FT-02/FT-08 mechanically
  enumerable from `information_schema`.
- **`shopify_sessions`** is **library-managed**. G-Schema should confirm nobody
  adds app columns to it and that its rows are deleted for the shop at both
  uninstall and redact (ADR-0007, ADR-0008).

### 8.4 Deletion topology

`shop/redact` must delete: sessions, expense rules, calculations, line items,
inbox rows, and the shop row itself. G-Schema should specify `ON DELETE CASCADE`
from `shop` **and** have the redaction path assert deleted row counts rather than
trusting the cascade silently. FT-08 enumerates tables from the live schema so a
table added in M3 that nobody wired into redaction **fails the test** rather than
shipping.

### 8.5 Migrations

Own DB, own migrations (`data_ownership: dedicated`). Reversible up/down, run as
a **release step**, never at request time (FT-17). No shared environment is
migrated against a draft model — the §9 model stays draft until G-Schema approves.

---

## 9. Verify-at-build register (additions from this gate)

Carried in addition to spec.md §14. Shopify surfaces change quarterly; nothing
below is asserted as current fact.

| Item | Why it matters | Where |
|---|---|---|
| Exact webhook retry schedule and the failure threshold at which Shopify removes a subscription in 2026-07 | Sizes the real cost of a missed ack; referenced as a motivation in ADR-0001 | ADR-0001 |
| Whether `shop { currencyCode name ianaTimezone }` requires an access scope in 2026-07 | Decides whether `scopes: []` holds; triggers ADR-0006's fallback | ADR-0006 |
| `compliance_topics` + `[[webhooks.subscriptions]]` TOML shape for `app/uninstalled` in the current CLI | Confirms no runtime registration mutation is needed (§5.1) | ADR-0002 |
| Whether the installed `@shopify/shopify-app-react-router` major line already defaults `expiringOfflineAccessTokens` | Flag redundant vs required | ADR-0007 |
| PgBouncer transaction-mode compatibility with Sequelize prepared statements | Only if ADR-0001 is overturned toward serverless | ADR-0001 |
| Polaris web-component tag/attribute set beyond nav/modal/save-bar | UI build | ADR-0004 |
| Free-app pricing-declaration fields on the Partner Dashboard | Listing | §5.2 |

---

## 10. What this gate did NOT do

- Did not approve itself. **Tech lead approves G1.5.**
- Did not design the schema — that is G-Schema (§8 is draft input).
- Did not select a hosting **provider/plan/region** — ADR-0001 decides the
  architectural class and states the requirements a provider must satisfy;
  selection and procurement remain OQ-1/OQ-3, human-owned.
- Did not revisit `scopes: []`, the protected-data determination, `free` pricing,
  `dedicated` data ownership, or the API pin.
- Did not change the estimate. Nothing decided here moves §11.3; ADR-0004
  (no charting library) and ADR-0002 (no broker) land at the *lower* end of the
  M3/M1 ranges rather than adding hours, and A5/A6 are now satisfied.
- Did not write production code, run QA, or produce listing content.
