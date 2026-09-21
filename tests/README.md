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
append-only FT-14c, save atomicity, pagination; G4-sprint-3.4: first-load seed
race across two independent pools). They are SKIPPED (and reported as skipped)
unless `RUN_DB_TESTS=1`.

## Running the DB suites — against a SEPARATE test database, never production

The DB suites read **`TEST_DATABASE_URL` only**. They never read or fall back
to `DATABASE_URL` / `DIRECT_DATABASE_URL` (which may be the production Neon
database that holds the real store), and this is enforced, not just documented:

- `RUN_DB_TESTS=1` with `TEST_DATABASE_URL` unset -> the suites **fail loudly**
  ("TEST_DATABASE_URL is not set ...").
- A hard guard (`db/config/test-db-guard.cjs`, wired in by
  `tests/helpers/test-database.ts`) **refuses to run** if the
  `TEST_DATABASE_URL` host + database name match `DATABASE_URL`,
  `DIRECT_DATABASE_URL`, any other postgres URL in the process environment, or
  any postgres URL in `.env` / `.env.*` (commented-out lines included; a Neon
  `-pooler` host and its direct host count as the same database; the port and
  credentials are ignored). Error output is masked (no URL, user, password or
  full host is ever printed).
- The helper then points the test process's own connection variables at the
  test database (so no app module in the test process can reach another
  database) and, after the app's Sequelize instance exists, verifies
  `current_database()` and the configured host/database really are the test
  ones.
- `sequelize-cli ... --env test` uses the same guard and `TEST_DATABASE_URL`
  only (`db/config/config.cjs`; per-environment blocks are lazy, so
  `--env test` needs nothing else set).
- Default-CI tests keep it that way: `tests/architecture/test-db-isolation.test.ts`
  fails if any `tests/**/*.db.test.ts` or `tests/helpers/*` file references
  `DATABASE_URL` for connecting; `tests/architecture/test-db-guard.test.ts`
  unit-tests the guard.

## Running migrations — the environment must be explicit

A bare `npm run db:migrate` used to default to `development`, whose URL falls
back to `DATABASE_URL` — which may be the **hosted production** database. So
every `sequelize-cli db:*` command (`db:migrate`, `db:migrate:undo`,
`db:migrate:undo:all`, `db:migrate:status`, `db:seed*`, `db:create`, `db:drop`)
now **refuses to run, before any connection**, unless you pass an **explicit
`--env <development|test|production>`** on the command line. The guard lives
in the CLI load path (`.sequelizerc` -> `db/config/migrate-guard.cjs`, and
again from `db/config/config.cjs`), so `npx sequelize-cli db:migrate ...` is
covered exactly like the npm scripts. It exits non-zero and prints the correct
usage. Not accepted as the environment: the sequelize-cli default, `NODE_ENV`,
any other variable, or an `--env` placed after a bare `--`. `--url`, `--config`
and `--options-path` are refused for `db:*` commands (they would bypass the
checks).

Every accepted run first prints one masked line so you can see where it points:

    Migrating env=test host=localhost db=expense_calculator_test

(host partially masked unless it is `localhost` / `127.0.0.1` / `::1`; the
database name is shown; user, password and the rest of the URL never are).

With npm the flag goes **after `--`**:

| Target | Command (Windows cmd) |
|---|---|
| Local development DB | `npm run db:migrate -- --env development` |
| Test DB (`TEST_DATABASE_URL` only; isolation guard unchanged) | `npm run db:migrate -- --env test` |
| Hosted production (`DIRECT_DATABASE_URL`, the unpooled endpoint) | `set "DIRECT_DATABASE_URL=postgres://..."&& npm run db:migrate -- --env production` |
| Undo the last migration | `npm run db:migrate:undo -- --env <name>` |
| Any other db command | `npx sequelize-cli db:migrate:status --env <name>` |

(PowerShell: `$env:DIRECT_DATABASE_URL="postgres://..."; npm run db:migrate -- --env production`;
bash: `DIRECT_DATABASE_URL=postgres://... npm run db:migrate -- --env production`.
In cmd, quote the whole assignment and put `&&` directly after the closing quote;
a `%` or `&` inside the URL needs escaping. If `DIRECT_DATABASE_URL` is already in your
`.env`, `--env production` uses it — the `set` above is only needed to override it.)

**Hosted-target safety.** If the URL an environment resolves to is not local
(`localhost`, `127.0.0.1`, `::1`), then `--env development` and `--env test` are
**refused** unless you acknowledge it for that one command with
`ALLOW_HOSTED_DB=1`:

    set "ALLOW_HOSTED_DB=1"&& npm run db:migrate -- --env development

The acknowledgement is read from the real shell environment only — a
`ALLOW_HOSTED_DB=1` line in `.env` is ignored on purpose (sequelize-cli runs
yargs in strict mode, so an extra `--allow-hosted` flag is not possible).
`--env production` is the intended hosted target and needs only the explicit
`--env production`. There is deliberately no way to migrate hosted data without
typing the environment.

**Check where a command would point, without connecting:**

    set "DB_GUARD_CHECK_ONLY=1"&& npm run db:migrate -- --env production

runs every check, prints the `Migrating env=...` line, and exits 0 without
connecting. The default-CI test `tests/architecture/migrate-guard.test.ts`
drives the real CLI this way (bare command, `--env` without a value, `--env
development` against a fake hosted host without acknowledgement, and the
accepted `--env test` local path) and also asserts the `package.json` db
scripts and these docs still exist.

### One-time setup

1. Create a separate database (pick one):
   - **Neon:** Console -> your project -> **Branches -> Create branch** (from
     `main`). Use the new branch's **direct** connection string (its host
     differs from production's, so the guard accepts it).
   - **Local Postgres:** `CREATE DATABASE expense_calculator_test;` on your
     local server.
2. Put its connection string in `.env` (gitignored) as `TEST_DATABASE_URL=...`
   (see `.env.example`) — or export it in the shell for the run. It MUST be a
   different database/branch from every other URL in `.env`.
3. Migrate it (uses `TEST_DATABASE_URL` only; `--env test` is mandatory, see
   "Running migrations" below):

       npm run db:migrate -- --env test

4. Run the suites:

       RUN_DB_TESTS=1 npx vitest run tests/db

   (PowerShell: `$env:RUN_DB_TESTS=1; npx vitest run tests/db`.)

Note for a local, non-TLS Postgres: TLS is decided from the test URL alone
(`?sslmode=require` -> TLS, otherwise plain) — an ambient `PGSSLMODE` from
`.env` is overridden for the test process and for `--env test`.

`tests/db/expense-rule-seed-race.db.test.ts` (G4-sprint-3.4) builds TWO independent app module graphs
(`vi.resetModules()` => two Sequelize singletons => two pools => two real Postgres connections) and races the
real `getOrSeedExpenseRules` on both for a fresh shop, with a barrier that guarantees both read "no rules"
before either writes; its DB-free companions are `tests/services/expense-rule-seed*.test.ts`.

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
