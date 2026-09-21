# G4-sprint-3.6 - `db:*` commands refuse without an explicit `--env`

Executor: developer agent (Claude Sonnet 5), Windows dev machine, 2026-09-21.
Authorised by the human: "make db:migrate refuse without an explicit env".
Scope: backend tooling only. **MCP validation: N/A** (no Admin GraphQL, Polaris or Liquid change).

**Code commit: `3f7135f2cfe5f71d1cd22b26e6a3850f5c82c6b2`** (parent `5659a8b`). Not pushed.

## Design

- `db/config/migrate-guard.cjs` (new, dependency-free CommonJS). Pure `evaluate(argv, opts)` + side-effecting
  `enforceForCli()` (memoised, inert unless argv contains a `db:*` command).
- Wired in two places: `.sequelizerc` (sequelize-cli loads it before parsing a command, so it also covers
  `npx sequelize-cli ...` used directly; the npm scripts are unchanged) and, defence in depth, the bottom of
  `db/config/config.cjs` (covers `--options-path`, which replaces `.sequelizerc` entirely).
- Rules: explicit `--env <development|test|production>` required (no default, no NODE_ENV, an `--env` after a
  bare `--` does not count; missing value / duplicate / `--no-env` / unknown env refused); `--url`, `--config`,
  `--options-path` refused; if the resolved host is not `localhost`/`127.0.0.1`/`::1`, `--env development|test`
  additionally need `ALLOW_HOSTED_DB=1` (shell only: snapshotted at module load, before dotenv, so a `.env`
  line cannot grant it; sequelize-cli runs yargs `.strict()`, so an extra `--allow-hosted` flag is impossible);
  `--env production` needs only the explicit flag. Config-level failures (TEST_DATABASE_URL unset / equal to prod,
  DIRECT_DATABASE_URL unset for production) surface as refusals through the same path. `test-db-guard.cjs` untouched.
- Prints `Migrating env=<env> host=<masked> db=<name>` first (host: first 2 chars of first label + last two labels,
  e.g. `ep***.***.neon.tech`; local hosts shown as-is; no user/password/URL ever). `DB_GUARD_CHECK_ONLY=1` runs all
  checks, prints that line, exits 0 without connecting.
- Refusal exit code 1, written with `fs.writeSync` before `process.exit`, before sequelize-cli even prints its banner.

## File hashes (sha256)

| path | working tree = tested | git blob at 3f7135f |
|---|---|---|
| `.sequelizerc` | `d3cea17f7b355cae1eb0d08dd2e5312c2caae522071e8f35cb7739ad0d003564` | same |
| `db/config/config.cjs` | `b54d91544204e8334d313e0fb3f9227c7d3dc6a7ae35f1b96a0dbfeaec238ba4` | same |
| `db/config/migrate-guard.cjs` | `58912006befefc3b0a3e90725af80b7ca942e31a55bf678aea0e605291e50643` | same |
| `tests/architecture/migrate-guard.test.ts` | `46707b1161819f7f767b78af4c37c29554cc8302d0c72622a4aa65b570387bd0` | same |
| `.env.example` | `c647150b40fec66f3f0dea8053a68bb09d8f6983302402be7bce4bfbb5a33213` | same |
| `tests/README.md` | `b83e900784aa168372ae98c3f6bf2c718a377b6ecec84f2b60c777bfa2770d32` | `d3ffbd533e82da2f5da2e8cbb4617eb32adf26a9bf4dd60186b8529907273c02` (blob is LF, working tree CRLF; content identical) |

`package.json` needed no change (scripts stay `sequelize-cli db:migrate` / `db:migrate:undo`).

## IMPORTANT: how the gates were run (the repo's node_modules is broken right now)

At 12:44 today the repo's `node_modules` lost `.bin/`, `@rollup/`, `@esbuild/`, `@eslint/`, `@react-router/`,
`@jridgewell/` and `.package-lock.json` (311 top-level dirs remain; no npm process for this repo running). I was told
not to run `npm ci` / touch node_modules, so I did not. `npm run ...` and vitest/vite/eslint/react-router therefore
cannot run in the repo. Whoever did that (likely a concurrent install/cleanup by the UI pass) needs to restore it.

So the four gates were run in a **scratch copy outside the repo**: `git archive HEAD` (base `5659a8b`, i.e. WITHOUT the
other developer's uncommitted work) + my six files overlaid (hashes above identical to what was committed), then
`npm ci` there (460 packages) and `npm run lint|typecheck|test|build`. Logs: `gate-*.log`.

| gate | result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm test` | exit 0 - 24 files passed / 3 skipped (DB suites), 321 tests passed / 40 skipped; includes the new `migrate-guard.test.ts` (28 tests) and the untouched `test-db-guard` / `test-db-isolation` suites |
| `npm run build` | exit 0 |
| `npm run lint` (whole repo) | **exit 1 - 33 errors, ALL in `dev-evidence/g4-sprint-3.3-ui-fixes/tools/*.mjs`** (`no-undef` process/console/document; the known scratch scripts pending UI pass 2's eslint config). `gate-lint.log` |
| lint of my files (`eslint db/config tests/architecture/migrate-guard.test.ts --max-warnings=0`) | exit 0, no output |
| lint of whole repo excluding that dir (`--ignore-pattern`) | exit 0 |

Not run: the same gates against the real working tree (it also carries the other developer's uncommitted edits and a
broken node_modules).

## Refusals demonstrated (every one fails before any connection; exit 1)

Real repo + real `.env` (loaded by dotenv, never printed; `DB_GUARD_CHECK_ONLY=1` set as a no-connect safety net) -
`real-repo-real-env-refusals.txt`:
- bare `sequelize-cli db:migrate`; `db:migrate:undo --env` (missing value)
- **`db:migrate --env development` -> refused: "resolves to a HOSTED database (host ep***.***.neon.tech, db neondb)"**
  - this is the exact careless-command scenario on the maintainer's machine (DATABASE_URL is Neon, DIRECT_DATABASE_URL unset)
- `--env test` -> refused, TEST_DATABASE_URL not set in `.env` (existing isolation guard, unchanged)
- `--env production` -> refused, DIRECT_DATABASE_URL not set (existing lazy-getter check, unchanged)

Scratch copy with fake `.invalid` URLs, via the real npm scripts - `npm-scripts-scratch-copy.txt`: `npm run db:migrate`,
`npm run db:migrate:undo`, `npm run db:migrate -- --env`, `npm run db:migrate -- --env development` (hosted) all refused;
`-- --env test` (local) and `ALLOW_HOSTED_DB=1 ... --env development` accepted in check-only mode.

Default-CI child-process tests (`tests/architecture/migrate-guard.test.ts`, 28 cases): bare command for 8 db commands,
NODE_ENV ignored, `--env` missing value (3 forms), `--env` after `--`, unknown/duplicate/`--no-env`, `--url`, `--config`,
`--options-path` (3 spellings; caught by the config.cjs guard), dev hosted without ack (+ undo, + DATABASE_URL-only
fallback), test hosted without ack, `ALLOW_HOSTED_DB` in a `.env` file ignored / non-`1` ignored, ack accepted,
production needs no ack, `--env test` local success path (confirmation line, stops), `--env=test` / flag-first order,
local development URL, existing test guard still active, non-db commands unguarded, package.json scripts still exist,
docs contain the rule. All assert no secret substrings leak and that sequelize-cli never printed "Loaded configuration
file".

## What I could NOT run

- **Local success path against `expense_calculator_test`**: local Postgres is listening on 5432 and the guard accepted
  `--env test` (`Migrating env=test host=localhost db=expense_calculator_test`, then sequelize-cli proceeded to
  connect), but the test DB credentials are not in `.env` (no TEST_DATABASE_URL) and my single attempt with the documented
  default `postgres:postgres` got `password authentication failed`. I did not guess further. See
  `real-local-test-db-success-path.txt`. The accept-and-stop path is covered by the check-only tests instead.
- The hosted/production database was never contacted.

## Found, not fixed

1. The repo `node_modules` breakage above (blocks every gate in the real tree).
2. `--options-path <file>` replaces `.sequelizerc`; a deliberately crafted options/config file that does not use this
   repo's `config.cjs` can still bypass the guard. Accident-proofing, not an adversarial control (documented).
3. `db/config/config.cjs` `production` env still carries `rejectUnauthorized:false` (pre-existing verify-at-build note).
4. The pre-existing `[db/config] DIRECT_DATABASE_URL not set ... falling back to DATABASE_URL` warning still appears
   for `--env development`; with the guard the run is refused anyway when that URL is hosted.
5. `tests/README.md`/`.env.example` older wording elsewhere still says `npx sequelize-cli ... --env test` in the
   isolation section; still correct (the explicit `--env` is what is required).
6. Others' git commits swept-in risk (as in 3.4): I committed with `git commit -- <paths>` only.
