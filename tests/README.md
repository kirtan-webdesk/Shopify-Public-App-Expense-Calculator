# Tests — what runs here, what doesn't

`npm test` in this environment runs **pure, DB-free** tests only:

- `tests/domain/*` — unit tests for `app/domain/*` (expense categories, money
  branded type).
- `tests/architecture/*` — static, file-scanning tests that approximate a
  handful of the fitness tests in
  `projects/expense-calculator/decisions/fitness-test-plan.md` without
  needing a database (route-auth matrix coverage, repository import
  boundary, webhook-route placement, REST-usage ban).

`tests/ui/*` — DB-free server-render smoke tests of the M4 history/results/
detail pages (repositories stubbed).

`tests/db/*` — **opt-in, real-Postgres** tests (M4: tenant isolation FT-02b,
snapshot immutability FT-14a, no-`expense_rule`-in-history-reads FT-14b,
append-only FT-14c, save atomicity, pagination). They are SKIPPED (and reported
as skipped) unless `RUN_DB_TESTS=1` and a `DATABASE_URL` are present:

    RUN_DB_TESTS=1 npx vitest run tests/db

`tests/db/shop-ensure.db.test.ts` (G4-sprint-3.2) covers the "no `shop` row" gap: every scenario starts from a
fresh domain with NO shop row (no seeding helper) and drives the real /app loaders/actions through
`requireShopContext` — first request, concurrent first requests, reinstall, post-redact, repeat requests,
cross-tenant. Its DB-free companion `tests/architecture/shop-context-choke-point.test.ts` runs in default CI.

They use fresh per-run shop domains and delete every row they create. They
exercise the real route loaders/actions, service and repository code; only
`authenticate.admin` is stubbed (a real session-token JWT cannot be fabricated).

**Not run here — require a live Postgres dev-store, unavailable in this
scaffold environment:**

- FT-02b/c (tenancy negative tests, shop_id column enumeration)
- FT-05/06/07 (HMAC 401, ack latency, webhook dedup)
- FT-08/FT-08b (shop/redact table-enumeration + idempotency)
- FT-09 (compliance no-op audit rows / no PII in webhook responses)
- FT-14 (append-only enforcement, snapshot immutability) — covered for M4 by the opt-in `tests/db` suite above
- FT-15b (session survives a process restart)
- FT-17 (migration reversibility against a real database)
- FT-20 (45-day sweeper window behaviour)

These are real M1/M2 sprint QA work (S1.2 in particular) once a dev-store-
connected Postgres instance exists (OQ-1/OQ-3 — hosting + credentials). The
repository/service/worker code they would exercise is written and structured
for it now; only the actual DB round-trip is deferred.
