# Developer handoff - G4-sprint-4.2 (in-body fallback buttons + tooling fixes)

Code commit: `5ca3acd0afda362c243d22b20a9d1b5af79088bd` (13 files, on top of `17d0772`). Not pushed. Evidence is committed separately.

MCP-Evidence: dev-evidence/g4-sprint-4.2-fallbacks/mcp-validation-evidence.json

Distribution: public App Store app (project.json pins it), Admin API 2026-07. Nothing here touches Admin GraphQL, webhooks or billing. The MCP-relevant part is the Polaris markup of three routes: app.calculator.tsx, app.rules.tsx, app.results.tsx, each VALID with `validate_component_codeblocks` (api `polaris-app-home`). The harness MCP tools were not exposed to this session, so the validator was run by driving `@shopify/dev-mcp@1.14.5` over stdio (`tools/mcp-call.mjs`), as in 4.1. Part B (guard text, CI workflow, tests, docs) has no Shopify-specific API or UI, so MCP validation is not applicable to it.

Read `remaining_warnings` and `live_store_items` in the evidence first.

## Part A - in-body fallbacks (all header buttons unchanged)

- Results: a non-primary `s-button` (`slot="secondary-actions"` of the "Estimate only, not saved yet" banner) with the same `commandFor="save-calculation-modal"` / `command="--show"` as the header button. Modal, hidden save `<Form>`, server recompute and `{transaction}` path untouched.
- Calculator: a non-primary in-body Calculate (`type="button"`, same `handleCalculate`, same `loading`/`disabled={isCalculating}`), last element of the page below the Revenue and rules sections. Enter-in-revenue still works. Like the header button it is not disabled when the input is invalid; on click it shows the error and focuses the field (that is the existing behaviour, kept).
- Rules: `Save` (`type="submit"`, primary) and `Discard` (`type="button"`, `formRef.current?.reset()` which fires the existing `onReset={discard}`) at the end of the "Category rules" section, INSIDE the same `data-save-bar` form: same `<Form>`, same action, same server validation and "Rule changes not saved" banner. Both are disabled while a submission is in flight (`useNavigation`). No `requestSubmit`, no programmatic save bar API added.
- Tests: `tests/ui/{calculator,history-results,rules}-render.test.ts` (header assertion made explicit; new blocks assert each fallback exists, targets the same modal id/command or the same handler, adds no form field, is enabled after a failed save). The forged-rule-payload test is untouched and green. Full suite: 555 passed + 43 opt-in DB tests skipped.

Harness results (`fallback-checks.json`, real Chromium, real polaris.js; what they do NOT prove is in the warnings): every in-body button was clicked and worked - Calculate (invalid: error and no navigation; valid: Results), Discard (restores 32.50), FAILED Save (empty percent: banner, zero writes) then retry Save with no save bar (one write, toast), a real mouse click on Save = one write, Results fallback opens the same modal and the modal's Save completes the save. QA's suspicion is consistent with the code: with `data-save-bar` the bar hides on submit and only returns on the next edit, so after a failed Save only the in-body button offers a retry; that is not observable outside the Admin, so I did not verify the bar itself.

Double submit, honestly: one click = one write. A synthetic same-tick double click (two `.click()` in one task) produced 2 identical writes because React has not yet rendered the disabled state; the harness cannot show the disabled guard working (its actions finish in microtasks). No ref-latch was added.

Click-through in the real Admin iframe is still the human's check (list in `live_store_items`).

## Part B - tooling

1. `db/config/migrate-guard.cjs`: refusal now suggests one-shot forms. PowerShell `$env:ALLOW_HOSTED_DB=1; try { npm run db:migrate -- --env development } finally { Remove-Item Env:ALLOW_HOSTED_DB }`; cmd `set "ALLOW_HOSTED_DB=1"&& npm run db:migrate -- --env development & set "ALLOW_HOSTED_DB="` (single `&` before the clear so it also clears when the migration fails); bash unchanged (command-scoped). The text says why. `tests/README.md` updated; `tests/architecture/migrate-guard.test.ts` asserts the new text, that the old persisting PowerShell form is gone, and the README wording. Not added (product decision, disclosed only): friction for `--env production` drop/undo:all.
2. `.github/workflows/app-ci.yml`: `postgres:18` service container with `pg_isready` health check; after the four unchanged mandatory gates, `npx sequelize-cli db:migrate --env test`, then `RUN_DB_TESTS=1 npx vitest run tests/db`. `TEST_DATABASE_URL` (`postgres://postgres:postgres@127.0.0.1:5432/expense_calculator_test`, the throw-away container's own credentials) is set only on those two steps, not job-wide; no other database URL or secret exists in the file, so the isolation guard has nothing to compare against and no `ALLOW_HOSTED_DB` is needed. Also added `permissions: contents: read`, `timeout-minutes: 20`, and `**/*.cjs` to the path filters (a migration-only change previously would not have triggered CI). `tests/architecture/ci-workflow.test.ts` pins the shape.
   - Verified here: YAML parses (PyYAML); the guard accepts exactly this URL with `--env test` in check-only mode and refuses a bare `db:migrate`; the pin tests pass.
   - **UNPROVEN until its first GitHub Actions run**: service start, connectivity, the migration on Postgres 18 from empty, and the DB suites (race suites included) on Linux. The local DB suites were not run either: a local server on 5432 refused the documented default credentials and I did not read `.env`.
   - **Postgres version**: 18 is what the suites were verified on locally; production's version is not recorded in the repo and was not checked. A human should run `SHOW server_version;` on the hosted DB and adjust the tag.
   - Linux differences: repo blobs are LF (the Windows working tree is CRLF), the source-reading tests I found accept both, none require CRLF (the flagged `test-db-isolation.test.ts` comment-stripping regex uses a multiline `$`, which is terminator-agnostic). Not proven by a Linux run.
3. `dev-evidence/g4-sprint-3.1-m4/live-evidence.ts`: ARCHIVED header comment (also notes it uses the hosted `DATABASE_URL`) plus a README beside it; not deleted, no other change.

## Gates (`gates/`, run at the code commit on the whole repo)

lint, typecheck, tests (39 files + 4 skipped; 555 passed + 43 skipped), build - all exit 0.

## Files

Screenshots (1000px and 600px): `screenshots/after-{rules,calculator,results}-fallback-*.png`, `after-results-fallback-modal-open-1000.png`. Harness: `tools/harness/` (`fallbacks.mjs`, `probe-mouse-save.mjs`; rebuild with `rebuild.sh`, build output `dist-*` not committed).

Ask of the orchestrator: run `check-dev-handoff.py` with `--commit 5ca3acd0afda362c243d22b20a9d1b5af79088bd`.
