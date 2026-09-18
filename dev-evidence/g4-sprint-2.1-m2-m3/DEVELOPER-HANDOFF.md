# G4-sprint-2.1 — M2 Configuration + M3 Engine — Developer Handoff

Commit: `58050e1a4d9b17b617122cf34606eb4e32b99a0c`

Scope: made `app/routes/app.calculator.tsx` and `app/routes/app.results.tsx`
real, per the G4-sprint-2.1 task brief — expense-rule CRUD (M2), the
deterministic calculation engine (M3), and the results view wired to real
computed output. M4 (save/history persistence) is out of scope and not built.

## Local gates

lint / typecheck / tests / build all **pass** (exit 0). Full detail,
commands, and output hashes in
`dev-evidence/g4-sprint-2.1-m2-m3/mcp-validation-evidence.json`'s
`local_gates`.

## MCP-Evidence

MCP-Evidence: dev-evidence/g4-sprint-2.1-m2-m3/mcp-validation-evidence.json

`validate_component_codeblocks` run against the byte-exact content of
`app/routes/app.calculator.tsx` and `app/routes/app.results.tsx` (the only
UI files this round touched Polaris components in) — both **VALID**. Full
detail, including the two real defects the first validation pass caught and
this round fixed (an invalid `<ui-save-bar>` element and `s-button`'s
missing `name` prop), in the structured record at
`dev-evidence/g4-sprint-2.1-m2-m3/records/polaris-calculator-results-record.json`.

## Live evidence (real Neon Postgres)

`dev-evidence/g4-sprint-2.1-m2-m3/00-SUMMARY.md` + `live-evidence.ts` +
`00-live-evidence-output.log`. Exercises expense-rule CRUD, the engine
against DB-sourced rows, money/rounding correctness (a case chosen so naive
per-category rounding would not reconcile), determinism, the
calculator→results transport round-trip, and verified cleanup.

## NEW FINDING (not fixed, not authorized)

`app/db/repositories/shop.repository.ts`'s `upsertInstalledShop()` cannot
create a brand-new shop row — see `00-SUMMARY.md`'s dedicated section. Not
fixed (no-auto-fix rule, no command given); does not block or invalidate
this sprint's own scope (no route built this sprint creates a shop row).
Flagged for a human fix-decision.
