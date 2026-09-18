# G4-sprint-1.1 live evidence — summary

Session date: 2026-09-18. Environment: local Postgres 18.1, database
`expense_calculator`, `DATABASE_URL` from `.env` (repo root). Purpose: resolve
the infrastructure BLOCKED verdict from `qa-reports/G4-sprint-1.1.md` (F1, F2)
by running the app's own code against a real database and a real HTTP server,
not re-asserting source-level correctness.

**Net result: F2 is cleanly resolved. F1 surfaced two new, real, live-only P1
defects in the shop/redact pipeline (not found by source review) that must be
fixed before this module can be marked PASS — plus one lower-severity
implementation/comment mismatch. Deletion topology itself, once reached, is
correct: a live redact run driven entirely by the app's own code ended with
zero rows across every tenant table.**

No fixes were applied to app source as part of this evidence run (no fix was
commanded) — one *diagnostic-only* logging line was added to
`app/db/sequelize.ts` to capture a raw SQL error, then reverted; `git diff`
confirms the file is byte-identical to before this session.

## 1. Migration (real run against live DB)

`npm run db:migrate` (`sequelize-cli db:migrate`) executed
`db/migrations/20260918120000-initial-schema.cjs` against `DATABASE_URL` for
the first time ever. Exit 0. `information_schema.tables` confirmed all 6 app
tables + `SequelizeMeta` afterward (`shopify_sessions` /
`shopify_sessions_migrations` were auto-created later by
`PostgreSQLSessionStorage` on first app-server request, not by this
migration).

Files: `01-migration-output.log`, `02-post-migration-tables.log`.

## 2. Seed data (structural, not secret)

One test shop (`shop_domain = wsa-qa-g4-live-evidence-test.myshopify.com`,
obviously-fake) plus one row each in `expense_rule` (percentage rule,
marketing category), `calculation` (revenue 1,000,000 minor / USD /
total_expenses 150,000 minor), `calculation_line_item` (one line item,
computed_amount_minor = 150,000, satisfying the calculation's DEFERRED
reconciliation trigger — trigger fired correctly at COMMIT), and
`webhook_event` (one pre-existing, already-processed `app/uninstalled` row,
representing history the tenant already had). All inserted in a single
transaction; the deferred `assert_calculation_line_items_reconcile()` trigger
passing at commit is itself a positive live confirmation that constraint
works.

Files: `03-seed-data.json`, `04-before-redact-row-counts.json` (1 row each
across shop/expense_rule/calculation/calculation_line_item/webhook_event).

## 3. Runtime auth probe (F2) — RESOLVED, no defects found

Dev server started for real (`npm run dev`, `localhost:3000`).

| Probe | Result |
|---|---|
| `GET /healthz` (intentionally unauthenticated) | `200 ok` — correct |
| `GET /app` unauthenticated | `302` redirect to `/app/calculator` (not 200) |
| `GET /app/calculator` unauthenticated | `410 Gone` rendered error boundary (not 200) — `authenticate.admin` correctly rejects |
| `POST /webhooks/shop-redact` — HMAC header **missing entirely** | `400 Bad Request` |
| `POST /webhooks/shop-redact` — HMAC header **present but wrong value** | `401 Unauthorized` |

Note the precise distinction: a **missing** HMAC header is `400` (missing
required header), not `401`; an **invalid-value** HMAC is `401`. Both are
rejections (never `200`), which is what actually matters for the route-auth
guarantee, but the exact code differs from a literal "bad/missing → 401"
phrasing — worth knowing precisely rather than approximately.

No unauthenticated request anywhere returned `200` with sensitive content.
F2 is resolved: the route-auth matrix behaves as designed under live HTTP
traffic.

Files: `06-unauthenticated-route-probe.txt`, `07-webhook-hmac-probe.txt`.

## 4. F1 (redact-then-query) — two new P1 defects found, deletion topology confirmed correct once reached

### Defect A (P1) — HTTP webhook ingestion is broken for ALL FOUR topics

The correctly-HMAC-signed `shop/redact` request in `07-webhook-hmac-probe.txt`
returned `500`, not `200`:

```
SequelizeDatabaseError: new row for relation "webhook_event" violates check
constraint "chk_webhook_event_topic"
```

Root cause: `@shopify/shopify-api`'s webhook validator normalizes the topic via
`topicForStorage()` — `topic.toUpperCase().replace(/\/|\./g, '_')` — so
`authenticate.webhook(request)` returns `topic: "SHOP_REDACT"`, not
`"shop/redact"`. Every one of the four webhook routes
(`webhooks.shop-redact.tsx`, `webhooks.app-uninstalled.tsx`,
`webhooks.customers-data-request.tsx`, `webhooks.customers-redact.tsx`) passes
this normalized value straight through
(`topic as "shop/redact"` etc., a type-level cast with no runtime
translation) into `ackAndEnqueueWebhook` → `insertWebhookEvent`, which inserts
it as-is. The `webhook_event.topic` CHECK constraint and the `WebhookTopic` TS
type both expect the raw slash-format string. Result: **no compliance webhook
can currently insert into the durable inbox via the real HTTP path** — the
route HMAC-verifies correctly, then 500s before doing anything durable. This
is a live-only defect; a pure source read (which is what G4-sprint-1.1's
original QA pass did) would not surface it without either running the library
or already knowing `topicForStorage`'s exact transform.

Confirmed the DB was not left in a partial state by this: the INSERT is a
single statement, Postgres rejected it atomically, and the pre-existing seed
row was still exactly 1 row afterward (`before_redact` unaffected).

### Defect B (P1) — shop/redact crashes (and rolls back the entire delete) whenever the shop has zero live sessions — which is the *normal*, designed case

To isolate defect A from the deletion logic itself, one `webhook_event` row
was inserted **directly via SQL with the correct topic value** (`shop/redact`)
— i.e., exactly the row shape the HTTP route would have produced had defect A
not existed — and the **already-running, unmodified, in-process drain worker**
(`WEBHOOK_DRAIN_INTERVAL_MS=5000`, started for real inside the live
`npm run dev` process) was left to pick it up on its normal interval. This
exercises the real `claimAndProcessOne` → `handleShopRedact` →
`hardDeleteShop` code path with no bypass beyond the one field.

Result: the drain worker retried ~20 times over several minutes, every
attempt rolling back with:

```
error: syntax error at or near ")"
```

Diagnosis (temporary Sequelize query logging added to `app/db/sequelize.ts`
for this session only, then reverted — see `13-sql-trace-redact-sequence.log`
for the full statement-by-statement trace): all five app-table `DELETE`
statements inside `hardDeleteShop` are syntactically fine and executed. The
failure is downstream, in `shop-redact.service.ts`:

```ts
const sessions = await sessionStorageInstance.findSessionsByShop(shopDomain);
await sessionStorageInstance.deleteSessions(sessions.map((s) => s.id));
```

`@shopify/shopify-app-session-storage-postgresql`'s `deleteSessions(ids)`
builds `WHERE "id" IN (${ids.map(...).join(', ')})` with **no guard for an
empty array** — confirmed directly against Postgres
(`DELETE FROM shopify_sessions WHERE id IN ();` → `syntax error at or near
")"`). `handleShopRedact` calls this unconditionally, with no empty-array
check.

This is not an artifact of the seeded test shop skipping real install. It is
the **designed, normal lifecycle**: `app-uninstalled.service.ts` (invoked at
`app/uninstalled`, which fires immediately on uninstall) already deletes every
session row for the shop:

```ts
// app/services/compliance/app-uninstalled.service.ts
await sessionStorageInstance.deleteSessions(
  (await sessionStorageInstance.findSessionsByShop(shopDomain)).map((s) => s.id),
);
```

...and `shop/redact` is documented (ADR-0008, `shopify-webhooks-compliance`
skill) to arrive **48 hours later**. By the time `shop/redact` fires for any
real shop that follows the normal uninstall path, `shopify_sessions` for that
shop is already empty — so `shop-redact.service.ts`'s own
`deleteSessions([])` call will hit this exact crash **every time**, for every
real shop, not just this test fixture. As currently coded, the transaction
rolls back and nothing commits — no compliance_audit_log row, no deletion —
and the webhook_event row retries forever, eventually tripping the
"attempts at cap" alert threshold documented in ADR-0002. **GDPR-mandated hard
deletion currently cannot complete for any shop that follows the designed
uninstall → 48h → redact sequence.**

Confirmed via the live drain-worker retry/backoff loop and the exact
`last_error` values captured in `09-drain-result-check.json` and the full SQL
trace.

To get a positive proof of the deletion topology itself (distinct from defect
B), one fake session row was seeded directly into `shopify_sessions` for the
test shop (`10-seed-session-row.json`) so `deleteSessions` would receive a
non-empty array. On the next drain tick, the **same unmodified live code**
succeeded end-to-end:

- `compliance_audit_log` recorded `outcome: "completed"` with asserted
  `deleted_row_counts` (`14-compliance-audit-log-final.json`).
- **Before/after row counts, every tenant table, real DB:**

| table | before | after |
|---|---|---|
| shop | 1 | 0 |
| expense_rule | 1 | 0 |
| calculation | 1 | 0 |
| calculation_line_item | 1 | 0 |
| webhook_event | 1 | **0** |
| shopify_sessions | 1 | 0 |

Files: `08-direct-inbox-insert.json`, `09-drain-result-check.json`,
`10-seed-session-row.json`, `11-second-direct-inbox-insert.json`,
`12-after-redact-row-counts.json`, `13-sql-trace-redact-sequence.log`,
`14-compliance-audit-log-final.json`.

### Defect / note C (P3, comment-vs-behavior mismatch) — the "exclude and mark processed" comment does not describe what actually happens

`hardDeleteShop`'s `webhook_event` delete deliberately excludes the
currently-processing row (`id != excludeWebhookEventId`), and the code
comments (in `shop-redact.service.ts` and `ADR-0002`) describe that row as
being *marked* `processed_at` afterward rather than deleted — the documented
resolution to the G-Schema judgment call #3 tension between FT-08's "zero
webhook_event rows" wording and "keep the in-flight row."

The SQL trace (`13-sql-trace-redact-sequence.log`, lines ~279–284) shows this
is **not what happens**: `webhook_event.shop_id` has `ON DELETE CASCADE`
against `shop.id`. The subsequent `DELETE FROM shop WHERE id = ...` in the
same transaction cascades and deletes the "excluded" row anyway, at the
database level, regardless of the application-level `id != excludeId` filter.
The later `UPDATE "webhook_event" SET "processed_at" = ... WHERE "id" = ...`
then silently affects **0 rows** (no error — Postgres doesn't complain about
an UPDATE matching nothing) and the transaction commits successfully. The
practical *effect* — zero webhook_event rows remain — happens to satisfy
FT-08's literal wording, but not through the documented mechanism, and the
"mark processed_at" line is dead code in this path. Low severity (the
observable end state is arguably more correct than the documented one), but
the code comments and ADR-0002 text should not be trusted as a description of
actual behavior here, and this needs a human/architect decision on which
behavior is actually wanted (cascade-delete-everything, which is what happens
today, vs. genuinely retaining one marked-processed audit row, which the
comments claim happens but does not).

## 5. Secondary observation (not a defect, informational)

`startBackgroundWorkers()` (and therefore the drain worker / sweeper) only
actually starts on the **first incoming HTTP request** to the dev server, not
at process boot — confirmed by `[SQL]` query-log silence until after a
`curl /healthz` was sent. This matches the documented "entry.server module
loaded lazily under Vite dev SSR" risk already flagged as verify-at-build in
`app/workers/bootstrap.server.ts`'s own comments. Worth confirming under the
actual production build/host (`@react-router/serve`), not just Vite dev mode,
since a delayed-start background worker has different implications for
`app/uninstalled` / `shop/redact` latency in production.

## 6. Cleanup

All seeded test-fixture rows were removed by the live redact run itself
(shop/expense_rule/calculation/calculation_line_item/webhook_event/
shopify_sessions all confirmed at 0 for the test shop — see
`12-after-redact-row-counts.json`). The one remaining `compliance_audit_log`
row (intentionally shop_id-less, survives shop deletion by design) was
explicitly deleted afterward since it was test-fixture data, not a real
audit trail (`15-final-cleanup.log`). Final state: every table the migration
created is empty; `SequelizeMeta` (migration bookkeeping) is untouched and
correctly still shows the one applied migration.

No `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` literal values appear anywhere in
this evidence directory — HMAC signing was done in-process from
`process.env.SHOPIFY_API_SECRET`, never logged.
