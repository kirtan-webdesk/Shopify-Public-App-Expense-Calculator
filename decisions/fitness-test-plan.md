# Architecture fitness-test plan — expense-calculator

| | |
|---|---|
| **Status** | PROPOSED — pending G1.5 approval (Tech lead). Not self-approved. |
| **Date** | 2026-09-17 · architect-agent |
| **Enforces** | ADR-0001 … ADR-0008 (`./`) |
| **Runs at** | every PR (CI, blocking) **and** at **G5** per milestone (evidence in the QA report) |

An architectural decision that nothing checks is a preference. Every test below
maps to a **real tool**, a **runnable command**, and the **ADR it enforces**. A
test that cannot run is not in this plan.

---

## 1. Toolchain

| Tool | Used for | Notes |
|---|---|---|
| **dependency-cruiser** | Layering rules between `routes/ services/ repositories/ models/ worker/` | `.dependency-cruiser.cjs` committed; `depcruise --validate` in CI |
| **eslint** + `eslint-plugin-boundaries` + `no-restricted-syntax` | Import-boundary rules and banned syntax (floats on money, REST, raw `console`) | Same eslint run as lint; `--max-warnings 0` |
| **vitest** (integration, against a real throwaway Postgres) | Behavioural tests: tenancy, HMAC, dedup, GDPR deletion, determinism, restart survival | Postgres via docker-compose or CI service container; **not** SQLite — the schema assertions read `information_schema` |
| **TypeScript** `strict` + branded types | Money type safety | `tsc --noEmit` in CI |
| **Custom node checks** (`scripts/fitness/*.mjs`) | Route-auth matrix, scope invariant, route placement, dependency deny-list, schema column checks | Plain node scripts, exit non-zero on violation; each prints the ADR it enforces |
| **axe-core** (component test) | Results-view accessibility | Only where ADR-0004 requires it |

**CI job:** `npm run fitness` runs all of the above and is a **required status
check** on the default branch. `npm run fitness` is also the evidence command
cited in each G5 QA report.

---

## 2. The tests

| ID | Asserts | Tool | Enforces | First gate |
|---|---|---|---|---|
| **FT-01** | `routes/` and `services/` may not import `db/models/`; only `db/repositories/` may. `worker/` may not import `routes/`. The calculation engine module imports nothing with I/O | dependency-cruiser + eslint-plugin-boundaries | ADR-0003, ADR-0005 | G5 / M1 |
| **FT-02a** | No `findAll(`, `findOne(`, `.destroy(`, `.update(`, `sequelize.query(` outside `db/repositories/` and `db/migrations/` | custom check | ADR-0003 | G5 / M1 |
| **FT-02b** | Seeded two-shop DB: for **every** tenant entity, shop A cannot read, update or delete shop B's rows (negative tests, one per entity) | vitest | ADR-0003, D12 | G5 / M1 |
| **FT-02c** | Every table in the tenant-table set has a `shop_id` column with an index. **Non-tenant exemption list (updated G1.5-revision, ADR-0009 D6/§7): `compliance_audit_log`, `job_heartbeat`, `shopify_sessions`** — deliberately excluded, not an oversight; see data-model.md §5 and §4.7 | custom check over `information_schema` | ADR-0003 | G5 / M1 |
| **FT-03** | Every route module with a `loader`/`action` calls the correct `authenticate.*` for its class, or is in an explicit unauthenticated allowlist (`healthz` only). **No unauthenticated sensitive route ships** | custom AST check (ts-morph) | ADR-0007, auth matrix | G5 / M1 |
| **FT-04** | No webhook route is nested under the `app` layout route tree | custom check over route config | ADR-0002 | G5 / M1 |
| **FT-05** | A webhook POST with an invalid `X-Shopify-Hmac-SHA256` returns **401**, and **no row is written** | vitest | ADR-0002 | G5 / M1 |
| **FT-06** | Webhook route responds in < 500ms with the work still pending (inbox row present, `processed_at` null) — ack is decoupled from work | vitest (timing) + prod alert on p95 | ADR-0001, ADR-0002 | G5 / M1 |
| **FT-07** | Replaying the same `X-Shopify-Webhook-Id` yields exactly one effect and a 2xx both times; the unique index on `webhook_id` exists | vitest + schema check | ADR-0002 | G5 / M1 |
| **FT-08** | **Flagship.** Seed a shop (rules, calculations, line items, sessions, inbox rows) → deliver `shop/redact` with valid HMAC → drain worker → **enumerate every table with a `shop_id` column from `information_schema`** and assert **zero** rows for that shop. **Table-enumeration exclusion list (updated G1.5-revision, ADR-0009 D6/§7): `compliance_audit_log`, `job_heartbeat`** — neither has a `shop_id` column by design (data-model.md §5, §4.7) and neither is shop data to begin with, so neither should be enumerated by this check in the first place | vitest + `information_schema` | ADR-0008 | G5 / M1, re-run M5 |
| **FT-08b** | A completion audit record exists with non-zero deleted counts; a second delivery of the same redact is a safe no-op | vitest | ADR-0008 | G5 / M1 |
| **FT-09** | `customers/redact` and `customers/data_request` return a **minimal 2xx with no PII in the body** and write a **reason-coded audit row** | vitest | ADR-0008, spec §10 | G5 / M1 |
| **FT-10** | Zero REST usage: no `admin.rest`, no `/admin/api/*.json` string, no REST client import (Req **2.2.4**) | eslint `no-restricted-syntax` + custom grep | ADR-0006 | G5 / M1 |
| **FT-11a** | `shopify.app.toml` declares **no access scopes**; deployment `SCOPES` env is empty | custom check | ADR-0006 | G5 / M1 |
| **FT-11b** | Zero `admin.graphql(` call sites outside `scripts/fitness/admin-call-allowlist.json` (currently **empty**) | custom check | ADR-0006 | G5 / M1 |
| **FT-11c** | `ApiVersion.July26` is the only API-version constant referenced; no dynamic "latest" resolution | custom check | ADR-0006, A8 | G5 / M1 |
| **FT-12** | For **every** route's rendered document: API-key `<meta>` precedes `app-bridge.js`; both `app-bridge.js` and `polaris.js` are present in `<head>`; `addDocumentResponseHeaders` applied (CSP `frame-ancestors` present) | vitest over rendered documents | ADR-0007, Req 2.2.3 | G5 / M1 |
| **FT-12b** | Dependency deny-list: no `@shopify/polaris` (Polaris React, archived), no charting library (`chart.js`, `recharts`, `d3*`, `echarts`, `victory`, `nivo`), no vendored/self-hosted App Bridge or Polaris script | custom check over `package.json` + `<head>` | ADR-0004, ADR-0007 | G5 / M1 |
| **FT-13a** | Money parameters use the branded `MinorUnits` type; a raw `number` does not typecheck | `tsc --noEmit` (strict) | ADR-0005 | G5 / M3 |
| **FT-13b** | No `parseFloat`, no `Number(` on money-named identifiers, no float literals in the engine module | eslint `no-restricted-syntax` | ADR-0005 | G5 / M3 |
| **FT-13c** | Golden file: a fixed input matrix produces **byte-identical** output across runs and across a process restart (determinism, D7) | vitest snapshot | ADR-0005 | G5 / M3 |
| **FT-13d** | Invariant test over randomised rule sets: `sum(lineItems) === total` **exactly**; no negative category | vitest (property style) | ADR-0005, S3.1 | G5 / M3 |
| **FT-13e** | No `FLOAT`/`DOUBLE PRECISION`/`REAL` column on any money or rate field | custom `information_schema` check | ADR-0005 | G5 / M3 |
| **FT-14a** | Save a calculation → mutate **every** live rule and category label → re-render the saved calculation → output is byte-identical (**editing defaults never alters history**, D11) | vitest | snapshot decision (G-Schema §8.1) | G5 / M4 |
| **FT-14b** | The history read path does not import the `expense_rule` model and issues no join to it (repository-boundary rule + query-log assertion) | dependency-cruiser + vitest query log | ADR-0003, G-Schema §8.1 | G5 / M4 |
| **FT-14c** | A saved `calculation` row carries `engine_version` and a currency code; an UPDATE against `calculation`/`calculation_line_item` is rejected (append-only) | vitest | G-Schema §8.1 | G5 / M4 |
| **FT-15a** | No module-scope mutable state in `auth`/`session`/`shop` paths; no `Set-Cookie` written by app code; no app-issued JWT signing (**session storage is the only auth state**) | custom check | ADR-0007, ADR-0001 | G5 / M1 |
| **FT-15b** | Install → restart the server process → the session still resolves and the app renders (restart/redeploy survival) | vitest integration | ADR-0001, ADR-0007 | G5 / M1 |
| **FT-16** | No raw `console.*` outside the logger module; logging a `Session` or webhook payload redacts `accessToken`, `refreshToken` and any merchant identifiers flagged sensitive | eslint `no-console` + vitest | spec §10, NFR security | G5 / M5 |
| **FT-17** | No migration invocation in the request path; `up`/`down` round-trip succeeds on a clean database (**reversible migrations, release-step only**) | custom check + vitest/CI migration job | ADR-0001, G-Schema | G5 / M1 |
| **FT-18** | `healthz` responds without auth, with a static body containing **no store data and no shop identifier** | vitest | auth matrix | G5 / M1 |
| **FT-19** | Chart and table render identical numbers from one fixture; the five mandated edge states (zero revenue, all-zero, single non-zero category, sub-1% slice, rounding residual) render without throwing | vitest component test | ADR-0004 | G5 / M3 |
| **FT-19a** | The results view passes an automated accessibility check; the data table is present and reachable independently of the SVG | axe-core in component test | ADR-0004 | G5 / M3 |
| **FT-20** | Sweeper: a shop with `uninstalled_at` beyond the window is purged; one inside the window is not; reinstall inside the window restores configuration | vitest | ADR-0008 | G5 / M1 |

---

## 3. Production alerts (fitness in the running system)

Fitness tests catch regressions before merge; these catch them after deploy.
They are an input to **G5.5** (observability + runbooks), not a substitute for it.

| Alert | Threshold | Why it exists |
|---|---|---|
| Webhook endpoint p95 response time | > 750ms | Early warning that ack is drifting toward the 1s/5s budget — the R1 signal if a sleeping tier is ever chosen (ADR-0001) |
| Webhook endpoint 5xx rate | any sustained | Delivery failures accumulate toward subscription removal |
| Inbox rows unprocessed > 15 min, or `attempts` at cap | any | **The worker is dead while the endpoint still returns 200** — the specific failure mode ADR-0002's split introduces |
| 45-day sweeper purged ≥ 1 shop | any | A `shop/redact` delivery was lost (R2) — a GDPR near-miss that must not be silent |
| Unexpected instance restart / OOM | any | ADR-0001 single-instance health |
| Application error rate | baseline + deviation | General |

---

## 4. Gating

- **Every PR:** `npm run fitness` is a required, blocking status check. A failing
  fitness test is not overridden by a green feature test.
- **G4 (per sprint):** the sprint's new tests exist and pass; no fitness test was
  skipped or `.todo`'d to land the sprint.
- **G5 (per milestone):** the QA report cites the `npm run fitness` run and lists
  which FT IDs newly came into scope that milestone. **A milestone MD is blocked
  until the QA report exists** (spec.md §11.4).
- **G-Review:** FT-03, FT-05, FT-08, FT-08b, FT-09, FT-10, FT-12 are the
  app-review-facing set — their evidence goes into the review-readiness pack.
- **Waiving a fitness test requires an RFC**, not a commit. A skipped test is an
  unenforced decision, and an unenforced decision erodes.

---

## 5. Rollout by milestone

| Milestone | Tests coming into force |
|---|---|
| **M1 Foundation** | FT-01, 02a/b/c, 03, 04, 05, 06, 07, 08, 08b, 09, 10, 11a/b/c, 12, 12b, 15a/b, 17, 18, 20 |
| **M2 Configuration** | FT-02b extended to rule entities; FT-13a/b/e as money types land |
| **M3 Engine + Results** | FT-13c, 13d, 19, 19a |
| **M4 Save + History** | FT-14a, 14b, 14c |
| **M5 Hardening + Launch** | FT-16; full re-run of FT-08 against the production-shaped schema; alert set live (G5.5) |

The M1 weighting is deliberate: the tests that protect compliance, tenancy and
auth must exist **before** feature work starts writing rows, or they are written
to fit the code instead of the decision.
