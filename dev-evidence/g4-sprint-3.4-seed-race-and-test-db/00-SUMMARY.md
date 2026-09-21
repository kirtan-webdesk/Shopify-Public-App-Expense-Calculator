# G4-sprint-3.4 - first-load seed race + test-database isolation

Executor: developer agent (Claude Sonnet 5), Windows dev machine, 2026-09-21.
Authorised by the human: "fix the first-load race and use a test database" (QA verdict
`g4_sprint_3_2_shop_ensure_qa_verdict`, flags: P3 seed race, P3 DB suites share the production DB).
Scope: backend / test only. **MCP validation: N/A** (no Admin GraphQL, Polaris or Liquid change;
generic Sequelize / Postgres / test-infrastructure work).

## Code commit

**Code commit: `dd4c2669e443d932b101d0fd9b46e4afea1cd40c`** (`dd4c266`).

Disclosure: my code was NOT committed by me under its own message. Another agent's commit `dd4c266`
("feat: Update project version and timestamps in project.json"), made with a broad add while I was still
working, swept every file below into it (together with `project.json` and the other developer's 3.3
evidence directory). I verified afterwards that the working tree equals HEAD for all my paths
(`git diff --quiet HEAD -- <my paths>`), did not rewrite history, and did not push. The commit that adds
this evidence directory is separate.

## File hashes (sha256)

Column 2 = working-tree bytes when the gates ran; column 3 = `git show dd4c266:<path> | sha256sum`.
They differ only where the working tree has CRLF line endings and the stored blob is LF (`core.autocrlf`);
the content is otherwise identical.

| path | working tree | git blob at dd4c266 |
|---|---|---|
| `app/db/repositories/expense-rule.repository.ts` | `d2d7a27d9e50269076bd5ced0c46901ded38a7b3ac9ff577fe3c4bcaf1d0151e` | `d2d7a27d9e50269076bd5ced0c46901ded38a7b3ac9ff577fe3c4bcaf1d0151e` |
| `app/services/expense-rule.service.ts` | `4e0e86b72c7d28591b53223446f31d3069a3457a6bce83fc2946678aebe3e19a` | `4e0e86b72c7d28591b53223446f31d3069a3457a6bce83fc2946678aebe3e19a` |
| `db/config/config.cjs` | `c607800c30888d1b8c155af176bf166c1203b83f457d4b323d4f79aa030761c3` | `c607800c30888d1b8c155af176bf166c1203b83f457d4b323d4f79aa030761c3` |
| `db/config/test-db-guard.cjs` | `e9c05d56d3507f66e623c07ce4b6b4a06e2a051aa4cbf8d1260e8d0530f2d734` | `e9c05d56d3507f66e623c07ce4b6b4a06e2a051aa4cbf8d1260e8d0530f2d734` |
| `tests/helpers/test-database.ts` | `422a3c802782d30a73aad386173302b03cd69debea92e32f6f912ae13297408f` | `981e9b1abfe0256930ebb03692e35913b508fea0e0c1d9f531d8319edde22d28` |
| `tests/db/expense-rule-seed-race.db.test.ts` | `637335a269ced5cbc54b9d5df702ce21c4e60ee98628d2b74f91bea0bdaf27e9` | `637335a269ced5cbc54b9d5df702ce21c4e60ee98628d2b74f91bea0bdaf27e9` |
| `tests/db/calculation-history.db.test.ts` | `c3ac8c6e073ebb2c8144f7658b94d6871811acf610e0236de869b7b537ddb8d0` | `298223373093873c67b5bcd1649138f84abe34620678b6df602958062b4b6a84` |
| `tests/db/shop-ensure.db.test.ts` | `3b2cddc26cd363b06abb1592e79d0432df9fc6ffde73e5b83c25295b5b68875d` | `3391f6bbb87ad2c30b6026c2b274522a6675642e21f424ad2ab042cc994de837` |
| `tests/architecture/test-db-guard.test.ts` | `9617eebce26e2cbb5a858fe03f10bb92e6a33800e15dec90819125e102603138` | `9617eebce26e2cbb5a858fe03f10bb92e6a33800e15dec90819125e102603138` |
| `tests/architecture/test-db-isolation.test.ts` | `bf53a448d777a4486765cea0b5deea7eabb4456969ae9a07dcba1a0d83ae3f99` | `18f333a3dcc9c88d867fff536eeaf33648dfdb94db52a48fd4f3087b74e98dfc` |
| `tests/services/expense-rule-seed.test.ts` | `240e8837e3948965fe6e10d7a85e187610230031ad22ed7906a842aeeabf29c5` | `240e8837e3948965fe6e10d7a85e187610230031ad22ed7906a842aeeabf29c5` |
| `tests/services/expense-rule-seed-repository.test.ts` | `a6d1e49abf0fb644c7b232411cdaff23757273c0353463b0b53a21c8dbdb105b` | `a6d1e49abf0fb644c7b232411cdaff23757273c0353463b0b53a21c8dbdb105b` |
| `tests/README.md` | `08cddcdf11849a99b834334416123c5867f43cd388783ed6bfa42be569136f89` | `60861bccb5d6874b4a1b5b5e8fbc89460d9d60202692f26ff44de059b393883e` |
| `.env.example` | `4b8c7ef079e7747d46e2b1b85d145e60164d2877c0a49d555b6c24fefd748e90` | `4b8c7ef079e7747d46e2b1b85d145e60164d2877c0a49d555b6c24fefd748e90` |

## Part A - first-load seed race (fixed)

**Bug (QA P3).** `getOrSeedExpenseRules`: two first-ever requests for a fresh shop on different serverless
instances both read "no rules", both `create()` the same (shop_id, category_key); the loser hits
`uq_expense_rule_shop_category`, its transaction throws, and the merchant sees an error on first load.
A second, latent defect found while reproducing: the old seed path was find-then-UPDATE, so a loser arriving
after the winner (or the merchant) had customised rules silently **overwrote them with the defaults**.

**Fix.** New repository function `seedExpenseRulesIfMissing(ctx, inputs, transaction?)` =
`ExpenseRuleModel.bulkCreate(rows, { ignoreDuplicates: true })` -> one multi-row
`INSERT ... ON CONFLICT DO NOTHING`. `getOrSeedExpenseRules` seeds through it and then **re-reads**
(`listExpenseRulesForShop`), so a concurrent seeder's / merchant's rows are kept untouched and no unique
violation can escape. Rule values and validation are unchanged; `replaceExpenseRulesForShop` (the Save path)
is unchanged. Transactions: a single INSERT statement is atomic on its own, so no transaction is opened
(nothing to thread, nothing that can take a second connection under `pool.max:1`); a caller-supplied
`transaction` is honoured if one is passed.

**Two-pool race evidence** (`tests/db/expense-rule-seed-race.db.test.ts`, real Postgres):
- `vi.resetModules()` between imports builds TWO independent app module graphs = two Sequelize singletons =
  two pools (each `pool.max:1`) = two backend connections. The test asserts the instances differ and that
  `pg_backend_pid()` differs. (The earlier concurrency tests ran on the app's single `pool.max:1` pool, which
  serialises everything and could never see this race.)
- A hook on each instance's `sequelize.query` holds its first `SELECT ... FROM "expense_rule"` **after it
  returned** until both instances have read, so both provably saw **zero rules** before either wrote
  (asserted: first-read row count 0 on both). Both then run the real service code and both attempt the
  INSERT (asserted from each instance's SQL log; every seed INSERT contains `ON CONFLICT DO NOTHING`).
- Test 2 (x5 fresh shops): both calls resolve; both return the 10 default views; exactly **10** rows in
  `expense_rule`; every value equals `DEFAULT_EXPENSE_RULES`.
- Test 3: B reads "no rules" and is held; A seeds AND the merchant customises (marketing 4242 bp, misc
  disabled); B is released. B's INSERT-IGNORE conflicts on every row and changes NOTHING (ids, values and
  `updated_at` before == after), and B returns the customised values, not the defaults.
- **Proven to catch the bug:** run against the UNFIXED code first
  (`07-seed-race-test-against-UNFIXED-code.txt`). Test 2 fails with
  `SequelizeUniqueConstraintError: Validation error` (the merchant-visible first-load error). Test 3 fails
  because the old path issues `UPDATE "expense_rule" SET "rate_basis_points"...` / `SET "enabled"...`,
  reverting the winner's customisation. Both pass after the fix (`06-*.log`).
- Default-CI companions (no DB): `tests/services/expense-rule-seed.test.ts` (service seeds via
  `seedExpenseRulesIfMissing` then re-reads, never `replaceExpenseRulesForShop`; static checks) and
  `tests/services/expense-rule-seed-repository.test.ts` (`bulkCreate` with `{ ignoreDuplicates: true }`,
  transaction only if supplied).

## Part B - test-database isolation

- **Guard** `db/config/test-db-guard.cjs` (plain CJS, shared by `config.cjs` and the vitest helper, so
  `--env test` migrations and the DB suites enforce the same rule). `resolveTestDatabaseUrl` reads
  `TEST_DATABASE_URL` ONLY; unset/empty -> throws. It refuses when the test URL's **host + database name**
  equal any non-test postgres URL: every process-env variable holding a postgres URL (DATABASE_URL,
  DIRECT_DATABASE_URL, POSTGRES_URL...) and every postgres URL in `.env` / `.env.*` (not `.env.example`),
  **including commented-out lines**. Normalisation is strict: case-insensitive host, localhost aliases
  collapse, a Neon `-pooler` host equals its direct host, port/credentials/query ignored. Errors are masked
  (`host ep***(52) / db ne***(6)`, env-var names and `.env` line numbers only; no URL, user, password or host).
- **Test helper** `tests/helpers/test-database.ts`: `setupTestDatabase()` (top level of every DB suite) returns
  RUN_DB_TESTS and, when enabled, runs the guard against the pristine environment, then points the test
  process's `DATABASE_URL` / `DIRECT_DATABASE_URL` at the TEST URL (so no app module in the process can reach any
  other database) and pins `PGSSLMODE` from the test URL alone (`.env`'s ambient PGSSLMODE, meant for the hosted
  DB, otherwise breaks a local non-TLS Postgres). `assertConnectedToTestDatabase(sequelize)` (each suite's
  `beforeAll`) additionally verifies the live instance's host/database and `SELECT current_database()`.
- **`db/config/config.cjs` WAS changed - stated plainly.** It was required, not optional: `.env` has no
  `DIRECT_DATABASE_URL`, and all three env blocks were evaluated eagerly at require time, so `--env test`
  threw from the *production* block before it could use anything. I made all three per-environment values
  **lazy getters** (`--env test` needs only `TEST_DATABASE_URL`; `--env development` only
  `DATABASE_URL`/`DIRECT_DATABASE_URL`; `--env production` only `DIRECT_DATABASE_URL`). **This also fixes the
  known P3 eager-evaluation bug.** The `test` block no longer falls back to `DIRECT_DATABASE_URL` /
  `DATABASE_URL` (it previously *preferred* DIRECT_DATABASE_URL, so `--env test` would have migrated the hosted
  DB), goes through the guard, and sets `dialectOptions.ssl` from the test URL's `sslmode` only. The
  development/production values and comments are otherwise unchanged (re-indented into getters). New file
  `db/config/test-db-guard.cjs` is required from it.
- **Default-CI tests** (`tests/architecture/test-db-isolation.test.ts`, `test-db-guard.test.ts`): fail if any
  `tests/**/*.db.test.ts` or `tests/helpers/*` file references DATABASE_URL / DIRECT_DATABASE_URL /
  POSTGRES_URL* (comments stripped; only `test-database.ts` may ASSIGN the process-local variable, with one
  pinned idempotency READ); every DB suite must wire `setupTestDatabase` / `assertConnectedToTestDatabase` and
  must not `new Sequelize` or import `pg`; the `config.cjs` test block has no DATABASE_URL reference and all three
  env blocks are getters. Behavioural tests spawn real `node` processes loading the real `config.cjs` with a
  controlled env: only-TEST works; TEST unset fails loudly; TEST == DATABASE_URL is refused with no secret in
  the output; dev needs only DATABASE_URL; prod needs only DIRECT_DATABASE_URL; TLS follows the test URL.
  Guard unit tests: 15.
- Docs: `tests/README.md` (the rule, the guard, one-time setup, migrate + run commands) and `.env.example`
  (`TEST_DATABASE_URL`, commented "must be a separate database/branch").

## Working non-production test database - YES

`expense_calculator_test` on the human's **local** Postgres (`localhost:5432`). Credential source: the repo's own
`.env` - the commented-out local staging line (`localhost:5432/expense_calculator`, user `postgres`). The
documented `.env.example` / `config.cjs` default (`postgres:postgres`) was tried first and rejected (28P01);
no other credential was tried and nothing was guessed. I connected only to the maintenance database `postgres`,
to list databases and run `CREATE DATABASE expense_calculator_test`; no other database was read or modified.
The URL lives only in a shell file in my scratchpad (outside the repo); it is **not** written to `.env`
(instruction: no `.env` changes). Migrated with `npx sequelize-cli db:migrate --env test` (both migrations up,
`09-test-db-state.txt`). The production Neon database was never connected to by any command in this work.

## Results

| check | result |
|---|---|
| DB suites on the test DB, 3 consecutive runs | **40/40 passed each** (37 existing + 3 new race tests); zero residue afterwards (`09`) |
| Seed-race test on the unfixed code | 2 of 3 FAIL (unique violation; overwrite) - `07` |
| `npm run lint` (whole repo) | **exit 1 - 33 errors, all in the other developer's UNTRACKED `dev-evidence/g4-sprint-3.3-ui-fixes/tools/*.mjs`** (no-undef `process`/`console`/`document` in their Playwright scratch scripts); none in my files - `01` |
| lint excluding that untracked directory | exit 0, 0 problems - `02` |
| `npm run typecheck` | exit 0 - `03` |
| `npm test` (default CI; DB suites skipped) | exit 0: 23 files passed + 3 skipped; 293 passed, 40 skipped - `04` |
| `npm run build` | exit 0 - `05` |
| guard refusals (unset; == production; == commented staging; CLI test env) | all refused before connecting, output masked - `08` |

## Disclosed, not fixed

- `replaceExpenseRulesForShop` (calculator Save) has the same race class on the very first save (find-then-create;
  two simultaneous first SAVES from two instances/tabs -> the loser hits the unique constraint). Out of scope; rare.
- `config.cjs` `development` still falls back to `DATABASE_URL` when `DIRECT_DATABASE_URL` is unset, and this
  machine's `.env` `DATABASE_URL` is the hosted (Neon) DB - so a bare `npm run db:migrate` (default env =
  development) would migrate the hosted DB. Behaviour unchanged (off-limits); needs a decision.
- A Neon **branch** as `TEST_DATABASE_URL` (`?sslmode=require`): the TLS handling (`PGSSLMODE=require` for the test
  process, `dialectOptions.ssl` for sequelize-cli) is implemented but UNVERIFIED - I could only run against local
  non-TLS Postgres.
- `app/db/sequelize.ts` only enables TLS when `NODE_ENV=production`, and Sequelize ignores `?sslmode=` in the URL;
  hosted connections therefore rely on the ambient `PGSSLMODE` in `.env`. Unchanged; worth knowing.
- Process incident: while gathering context a broad grep pattern (`DB`, case-insensitive) matched a substring of
  `SHOPIFY_API_SECRET` in `.env` and echoed that line into my tool output (session transcript only; not in any
  file or evidence). Consider rotating that secret.
