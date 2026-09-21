# G4-sprint-3.2 - P1 fix: ensure `shop` row on the request path

Reviewed tree: commit `7765afe7c241fed04b2f1ea61bf466a5ccd45ad8` (HEAD when this summary was written). The
implementation itself landed in `144b3eea22f921743c782bef0c532caa4769c137`
(a commit made by kirtan-webdesk at 12:05:30 +0530 that swept up this
sprint's staged files plus unrelated `project.json` edits, and is already on
origin/main - see "Provenance" below); `7765afe` adds only the
`tests/README.md` note. The evidence commit that adds this directory follows
`7765afe` and changes no code.

## Bug
`upsertInstalledShop()` ran only from `auth.$.tsx`; under managed installation
+ token exchange `/auth/*` is never visited, so no `shop` row was ever
created and 5 call sites threw 404 "Shop record not found for this session".

## Fix (design)
- `ensureShopContext(shopDomain)` (app/db/repositories/shop.repository.ts):
  SELECT first (hot path = 1 read, no write); row missing -> `INSERT ... ON
  CONFLICT DO NOTHING` (`bulkCreate({ignoreDuplicates:true})`) then re-read
  (bounded 3 attempts); row present with `uninstalled_at` set -> conditional
  `UPDATE ... WHERE id=? AND uninstalled_at IS NOT NULL`. No transaction, no
  `findOrCreate` (it opens its own), strictly sequential autocommit statements
  -> safe under `pool.max:1`; must not be called inside an open transaction.
- `requireShopContext(session)` (app/services/shop-context.service.ts): the
  single choke point. Takes the authenticated *session* object, not a string,
  so the shop domain can only come from `authenticate.admin`.
- All five 404 sites (calculator loader+action, results action, history,
  history/:id) now call it. `upsertInstalledShop` (auth.$.tsx) delegates to
  `ensureShopContext` - one implementation. It is called in each route, not in
  the `/app` layout loader: a layout loader does not run for child-route
  actions, and it would add a redundant SELECT to every navigation.
- Semantics: reinstall (row exists, `uninstalled_at` set, valid session) ->
  clear `uninstalled_at`, same row/id, rules+history retained (ADR-0008 step 2;
  the ADR is explicit, nothing invented). Session after `shop/redact`
  hard-delete -> a fresh empty row with a NEW id ("start clean", ADR-0008
  step 2, acceptable), old data is not resurrected.

## Gates (run separately, exit codes from the logs' `__GATE_EXIT__` marker)
| gate | command | marker |
|---|---|---|
| lint | `npm run lint` | __GATE_EXIT__:0 |
| typecheck | `npm run typecheck` | __GATE_EXIT__:0 |
| tests | `npm test` | __GATE_EXIT__:0 |
| build | `npm run build` | __GATE_EXIT__:0 |

`npm test`: 19 files passed / 2 skipped, 244 tests passed / 37 skipped (the
skipped are the two opt-in DB suites). Opt-in real-Postgres run
(`RUN_DB_TESTS=1 npx vitest run tests/db`): 2 files, 37/37 passed (M4 suite
22/22 unchanged + new `shop-ensure` suite 15/15).
Note: `.claude/tools/scripts/run-gates.py` could not be used - on this Windows
host its `shell=False` `subprocess.run(["npm", ...])` cannot resolve `npm`
(npm.cmd) and reports exit 127 for every gate. The four gates were instead run
by hand with the identical commands and the identical `__GATE_EXIT__:<code>`
log marker; the plugin script was not modified. Logs are ANSI-stripped `.txt`
copies (`*.log` is gitignored).

## Live evidence (real Postgres, production `pool.max:1`, DB URL never printed)
`live-evidence.ts` -> `00-live-evidence-output.txt` ("ALL LIVE CHECKS PASSED"):
- 1a/1b outage state reproduced: a real session row (via the session-storage
  library API) and NO shop row; the old `findShopContextByDomain` returns null
  (= the 404). 1c-1d: `requireShopContext` created the row for that EXISTING
  session with no new token exchange.
- 3: two concurrent first requests -> both succeed, 2 x `INSERT ... ON
  CONFLICT DO NOTHING` observed in the SQL trace, exactly ONE row.
- 4: 3 repeat requests = 3 SELECTs, 0 writes, row unchanged.
- 5: reinstall: `uninstalled_at` cleared, same id, 10 rules + 1 calculation retained.
- 6: post-redact: new row, new id, empty history.
- 7: cross-tenant: shop B (first-ever) gets null for A's id; row demonstrably exists.
- 8: cleanup verified (zero rows/sessions left). `02-db-state-after-evidence-runs.txt`.
`tests/db/shop-ensure.db.test.ts` (real loaders/actions, only `authenticate.admin`
stubbed; every scenario asserts NO pre-existing row before its first request and
uses no seeding helper) -> `01-db-test-suite-output.txt`: (a) calculator
loader+action, (b) results loader/action, history, history/:id each alone on a
fresh shop, (c) 2 and 5 concurrent first requests (conflict path asserted from
the SQL log), (d) reinstall, auth/* route, post-redact, (e) repeat requests
issue zero shop writes, (f) shop B vs shop A identical 404 for foreign /
nonexistent / malformed ids, and shop/shopId in URL/form never create or select
a tenant. DB-free CI guard: `tests/architecture/shop-context-choke-point.test.ts`.

## MCP validation
Not applicable: backend-only change (repository, service, route loader/action
plumbing, tests). No Polaris/web-component, GraphQL, Liquid or extension file
was touched (the JSX of `app.calculator.tsx`/`app.results.tsx`/`app.history*.tsx`
is unchanged). No MCP evidence artifact produced; nothing is claimed as
MCP-validated.

## Provenance
`144b3ee` (kirtan-webdesk, not this agent) contains this sprint's staged work
together with `project.json` changes this agent did not make and did not
touch. Same class as the M4 incident in
`dev-evidence/g4-sprint-3.1-m4/DEVELOPER-HANDOFF.md`. History not rewritten.
Not pushed by this agent.

## File hashes (sha256, at `7765afe7c241fed04b2f1ea61bf466a5ccd45ad8`)
### Code / tests
| file | sha256 |
|---|---|
| `app/db/repositories/shop.repository.ts` | `f0469e0916e72644c41faa53cc0739d7884aa22f2c6098dee99e763a4ab7af14` |
| `app/services/shop-context.service.ts` | `f7fab9c5ca03d99b23ebab67dae99a981e99ca74d8eb9b606431afec325501bb` |
| `app/routes/app.calculator.tsx` | `76c045dbe2dead50b76dce9168145fbfc6b7f35be6cccee9aca25e9f7a28a2da` |
| `app/routes/app.results.tsx` | `b703efe6de8551acf86a790d6f225b1206988512ee9ee413363bbd2bbc3f1ae7` |
| `app/routes/app.history.tsx` | `28ea3dd3844849fc51ee4e13168c132ff3d2b564c40fb83db2f1c16b65ed03dd` |
| `app/routes/app.history.$id.tsx` | `3130cc63acffbc07507e27d49a5ee71de482be3128a4ccc96fc0d0c3165ad99b` |
| `tests/architecture/shop-context-choke-point.test.ts` | `0a27b741442acd899f1e7e480c95f6c72f2883cd8690cda5595455a697985d98` |
| `tests/db/shop-ensure.db.test.ts` | `0042f84a5f01ff6b5677f69e255809894a0cf017817a372ae9f23f09ed8c81f7` |
| `tests/ui/history-results-render.test.ts` | `f2a64bacb2f170eca8bc2dc3a1232a09115cb9cd5d65514ba035f633883fa5f5` |
| `tests/README.md` | `0c11e0ddc3a46c5f353664fbcf7bb3ee1018c76c0d8dc4b11277ddea09d6e164` |
| `dev-evidence/g4-sprint-3.2-shop-ensure-fix/live-evidence.ts` | `44e4dd683ed285d5593994710707939ff0908d5fd45e4b27eb13acb99275efe4` |
### Evidence files in this directory
| file | sha256 |
|---|---|
| `dev-evidence/g4-sprint-3.2-shop-ensure-fix/00-live-evidence-output.txt` | `8979ab33d6909120b1b0f3c4882ebecdd4ff0184bc6c3d2ee5bef8c81f7f6288` |
| `dev-evidence/g4-sprint-3.2-shop-ensure-fix/01-db-test-suite-output.txt` | `1af0acdac07e21b6961d2d81f9bd881557fd8506996033ec26d2c1f36ec0ed2e` |
| `dev-evidence/g4-sprint-3.2-shop-ensure-fix/02-db-state-after-evidence-runs.txt` | `25d1739b7061b531948932fe65f1b34095d86240f198f68f17d6a18ea38c63fa` |
| `dev-evidence/g4-sprint-3.2-shop-ensure-fix/gates/lint.txt` | `2dbcadf6952581a31688b8990252cff06d619a59f26bc1de0c6354579732c7f9` |
| `dev-evidence/g4-sprint-3.2-shop-ensure-fix/gates/typecheck.txt` | `c995b2fcfa2359e3b7c1a9855200c6777993f0a953aacd19d0fe6d82b0d3d555` |
| `dev-evidence/g4-sprint-3.2-shop-ensure-fix/gates/tests.txt` | `d5888f8450b7ef93f5f70a4831a091414316ba86e244b0f4b197b353e065c1fd` |
| `dev-evidence/g4-sprint-3.2-shop-ensure-fix/gates/build.txt` | `6564e27edaf8638307bcf441baa4bf1877e7e1ca94fbe13765263b93db9eb073` |
