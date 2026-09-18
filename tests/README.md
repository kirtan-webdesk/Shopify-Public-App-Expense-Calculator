# Tests — what runs here, what doesn't

`npm test` in this environment runs **pure, DB-free** tests only:

- `tests/domain/*` — unit tests for `app/domain/*` (expense categories, money
  branded type).
- `tests/architecture/*` — static, file-scanning tests that approximate a
  handful of the fitness tests in
  `projects/expense-calculator/decisions/fitness-test-plan.md` without
  needing a database (route-auth matrix coverage, repository import
  boundary, webhook-route placement, REST-usage ban).

**Not run here — require a live Postgres dev-store, unavailable in this
scaffold environment:**

- FT-02b/c (tenancy negative tests, shop_id column enumeration)
- FT-05/06/07 (HMAC 401, ack latency, webhook dedup)
- FT-08/FT-08b (shop/redact table-enumeration + idempotency)
- FT-09 (compliance no-op audit rows / no PII in webhook responses)
- FT-14 (append-only enforcement, snapshot immutability)
- FT-15b (session survives a process restart)
- FT-17 (migration reversibility against a real database)
- FT-20 (45-day sweeper window behaviour)

These are real M1/M2 sprint QA work (S1.2 in particular) once a dev-store-
connected Postgres instance exists (OQ-1/OQ-3 — hosting + credentials). The
repository/service/worker code they would exercise is written and structured
for it now; only the actual DB round-trip is deferred.
