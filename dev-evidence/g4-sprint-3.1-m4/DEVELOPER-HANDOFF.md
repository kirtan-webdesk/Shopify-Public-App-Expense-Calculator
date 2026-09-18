# G4-sprint-3.1 — M4 Save + History — Developer Handoff

Reviewed commit (code + tests, gated and MCP-validated): `ffd3bf7244e0f08c8fe0b64e7d3759dcc95a512e`

**Provenance incident — read first.** Most of the M4 application source was
swept into the unrelated commit `105b1c6` ("feat(rfc): add RFC-002 ...",
author kirtan-webdesk, already at origin/main) by a concurrent commit while
this sprint was in progress. This agent did not make that commit and did not
touch `project.json` / RFC-002; history was not rewritten. `ffd3bf7` is the
remainder (tests, one import merge, tests/README.md); the tree at `ffd3bf7`
is the tree that was gated and validated. Details in
`mcp-validation-evidence.json` `remaining_warnings[0]`.

Scope: M4 Save + History (D10, D11) against the G2-approved mockups
(`results.html` save modal, `history.html`, `history-detail.html`) — no
redesign. `db/config/config.cjs`, `shopify.app.toml`, `project.json`,
hosting/Vercel config were not touched.

## What was built

- **Save** (`app.results.tsx` action -> `calculation-history.service.ts` ->
  `calculation.repository.ts#insertCalculationSnapshot`): `<s-modal>`
  confirmation; ONE transaction writes one `calculation` row + one
  `calculation_line_item` per applied category, by value (typed `*_at_save`
  columns, label + sort order at save, JSONB audit copy, `engine_version`,
  currency). No FK / no read of `expense_rule`. Every statement in the
  transaction passes `{ transaction }` (pool.max:1). The server never persists
  transported amounts: it decodes, re-validates every input, **recomputes with
  the pure engine** (`app/domain/calculation-verification.ts`) and rejects any
  payload whose amounts differ. The DB reconciliation trigger is a backstop,
  not the only check.
- **History list** (`app.history.tsx`): newest first (id tie-break), page size
  20, Previous/Next, empty state, tenant-scoped through the repository.
- **Detail** (`app.history.$id.tsx` + `saved-calculation-page.tsx`): stored
  values only (no engine call, no `expense_rule`); explicit-copy banner,
  lock-icon Snapshot badge + stored `engine_version`, zero form controls, no
  Save; other-shop / nonexistent / malformed id -> identical 404 (no
  existence oracle). "Duplicate as new calculation" -> `/app/calculator?from=:id`
  pre-fills a NEW unsaved calculation from the snapshot (read-only, tenant-scoped).
- **Append-only**: repository exports no update/delete; history routes have
  no action; DB trigger blocks UPDATE; deletion only via the shop/redact cascade.
- Shared table + donut extracted to `app/components/expense-breakdown.tsx`
  (used by Results and Detail); `formatRuleApplied` / `formatSavedAt` added to
  `presentation.ts`.

## Local gates

lint / typecheck / tests / build all **pass** (exit 0), reported separately in
`mcp-validation-evidence.json` `local_gates`. `npm test`: 214 passed, 22
skipped (the opt-in real-DB suite; its own run: 22/22 passed, see below).

## MCP-Evidence

MCP-Evidence: dev-evidence/g4-sprint-3.1-m4/mcp-validation-evidence.json

`validate_component_codeblocks` (api=polaris-app-home) run in 3 calls over the
6 changed UI files — all **VALID** on first pass (records in
`dev-evidence/g4-sprint-3.1-m4/records/`). `expense-breakdown.tsx` contains no
Polaris components (validator: "No components found") — recorded for
completeness only. Limits (MCP proves types, not runtime modal/toast
behaviour) and the descriptive-not-toolu `tool_call_ref` values are stated in
`remaining_warnings`.

## Live evidence (real Neon Postgres, real production code paths, fresh shop domains)

- `00-live-evidence-output.log` (from `live-evidence.ts`, 41 PASS / 0 FAIL):
  save + `engine_version`/currency stored + sum(line items)=total + no FK to
  `expense_rule`; **byte-identical detail** (sha256 of JSON view, rendered
  HTML and raw stored rows equal before/after every live rule was rewritten
  and disabled); cross-tenant read returns null while the row provably exists;
  **failure-injection with SQL traces** (CHECK violation, unique violation,
  deferred-trigger reconciliation failure at COMMIT) -> zero rows and a valid
  save afterwards under pool.max:1; tampered payload rejected; UPDATE rejected
  by the append-only trigger; 25 rows -> pages of 20 + 5, newest first, no
  overlap; duplicate prefill from snapshot, writes nothing; cleanup verified.
- `01-db-test-suite-output.log`: the permanent opt-in suite
  `tests/db/calculation-history.db.test.ts` (22/22) driving the REAL route
  loaders/actions (only `authenticate.admin` stubbed): FT-02b, FT-14a/b/c,
  atomicity, pagination, duplicate.
- `02-db-state-after-evidence-runs.txt`: all counts 0 after the runs. (An
  earlier evidence attempt aborted mid-run at a too-narrow error-message
  assertion and left 4 `m4-live-*` shops; they were deleted, the script now
  cleans up on its failure path too, and the final run above is a clean one.)

## Not done / flagged

See `mcp-validation-evidence.json` `remaining_warnings` and
`live_store_items` (double-submit has no server idempotency; UTC labelling
pending OQ-6; DB tests are opt-in and not in CI; pre-existing `$`-hardcoding
in the calculator summary and currency-less fixed-amount text, not fixed;
run-gates.py Windows gap).
