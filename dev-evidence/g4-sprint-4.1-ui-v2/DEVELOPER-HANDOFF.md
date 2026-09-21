# Developer handoff - G4-sprint-4.1 (build the confirmed G2-revision v2 design)

Code commit: `6a8657feda9d5855223a3ae4e3f2609a9c4490bf` (31 files, on top of `82577eb`, the design-v2 commit that landed after `91d74ed`). Not pushed. Evidence is committed separately.

MCP-Evidence: dev-evidence/g4-sprint-4.1-ui-v2/mcp-validation-evidence.json

Distribution: public App Store app (project.json pins it), Admin API 2026-07. Nothing here touches Admin GraphQL, webhooks or billing. The MCP-relevant part is the Polaris web-component markup: 7 UI files validated VALID with `validate_component_codeblocks` (api `polaris-app-home`). `app/routes/app.tsx` (`s-app-nav`, an App Bridge component) is outside that validator's type universe and INVALID there (same as passes 1 and 2), so it is not listed as a validation; its raw output is in `records/mcp-raw-validator-output.json`.

Read the `remaining_warnings` in the evidence first. The important ones:

- The harness MCP tools were not exposed; validation was run by driving `@shopify/dev-mcp@1.14.5` over stdio (`tools/mcp-call.mjs`), as pass 2 did.
- Two constructs in the designer's mockup were INVALID (`s-text-field` `inputMode` and `onKeyDown`); fallbacks are recorded there.
- axe reports one critical `aria-required-children` on every `s-table` page. I judge it a false positive (Chromium's accessibility tree is correct); the designer's native-table fallback was NOT used. That is my judgement, no screen-reader pass was done.
- Not seen (needs the live Admin): sidebar nav, contextual save bar, toast, and every header action button (Polaris hoists the `s-page` header into the Admin chrome, so whether those buttons' click / `commandFor` reach the iframe is unverified).

Gates (`gates/`, run at the code commit on the whole repo): lint, typecheck, tests (537 passed + 43 opt-in DB tests skipped), build - all exit 0. DB suites not run (no test DB without reading `.env`).

Ask of the orchestrator: run `check-dev-handoff.py` with `--commit 6a8657feda9d5855223a3ae4e3f2609a9c4490bf`.
