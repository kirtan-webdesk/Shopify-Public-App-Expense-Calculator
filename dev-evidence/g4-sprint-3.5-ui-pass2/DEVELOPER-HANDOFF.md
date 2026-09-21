# Developer handoff - G4-sprint-3.5 (UI pass 2)

Code commit: `9d6407f1e8869352cf62600fc3256404136afb8e` (25 files, on top of `4745ac2`). Not pushed. Evidence is committed separately.

MCP-Evidence: dev-evidence/g4-sprint-3.5-ui-pass2/mcp-validation-evidence.json

Distribution: public App Store app (project.json pins it), Admin API 2026-07. Nothing here touches Admin GraphQL, webhooks or billing; the MCP-relevant part is the Polaris web-component markup in 3 route files. The 4th validated file (`expense-breakdown.tsx`) has no Polaris components, so its VALID result carries no information. `app/routes/app.tsx` (App Bridge `s-app-nav`) is outside the validator's Polaris type universe (same as pass 1) and is not listed as a validation; its behaviour was confirmed against shopify.dev docs instead (see the evidence `remaining_warnings`).

Verification summary (all details in `00-SUMMARY.md` and the evidence JSON):

- Gates lint / typecheck / tests / build each exit 0 on a clean clone of the commit (390 tests passed, 43 opt-in DB tests skipped). Gate logs are in `gates/`. The shared tree's `node_modules` is damaged, so the gates could not be run there.
- Browser checks: hydrated harness against real route modules with stubbed auth/repositories, before (HEAD) and after screenshots at 1000/600 px in `screenshots/`. App Bridge nav, save bar and toast were not seen (need the live Admin).
- DB suites were not run (no test-DB credentials available without reading `.env`).

Ask of the orchestrator: run `check-dev-handoff.py` with `--commit 9d6407f1e8869352cf62600fc3256404136afb8e`.
