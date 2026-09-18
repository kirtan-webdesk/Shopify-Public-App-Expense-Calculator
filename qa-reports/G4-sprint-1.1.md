# G4-sprint-1.1 — Sprint QA Report (M1 Foundation)

Commit reviewed: `299328cd2288c7fbcef4511a41be6f2ee160988b`
Reviewer: qa agent (read-only)
Date: 2026-09-18

## Verdict: BLOCKED (not PASS, not FAIL)

Code-level review found no P1/P2 code defects. However, this sprint's scope covers Webhook
Compliance and Auth, and the mandatory live-evidence artifacts for both (a redact-then-query
database dump proving `shop/redact` actually deletes rows, and a runtime route-probe transcript
proving unauthenticated requests are rejected) are absent — no seeded dev-store Postgres or
running server is available in this environment. Per QA's operating rule, missing GDPR-deletion
evidence blocks the module regardless of code quality ("a 200 is not a pass").

This is NOT the same as FAIL: the gaps are accurately and consistently disclosed in three
independent places (audit_log, mcp-validation-evidence.json remaining_warnings, in-code
`KNOWN GAP` comments), not papered over.

## Module results

| Module | Result | Notes |
|---|---|---|
| GraphQL contract | PASS | Verified by direct grep — zero `admin.graphql(`/REST call sites. Matches ADR-0006. |
| Webhook compliance | BLOCKED (evidence) | HMAC + dedup + real deletion code confirmed by direct read; no live redact-then-query artifact exists (FT-08/FT-08b not run). |
| Auth | Code-level PASS / live-probe BLOCKED | Route-auth-matrix confirmed correct by direct source read (not just trusting the test); no runtime probe transcript exists. |
| Billing | PASS (N/A) | No billing code present, confirmed by grep. Matches free app_pricing.model. |
| Security | PASS with 1 flag | scopes=[] least-privilege; no credential leakage in error paths. F3: `.env` holds a realistic-format (non-placeholder) Shopify key/secret — gitignored, not committed, but flagged for provenance confirmation and rotation. |
| App Bridge in `<head>` | PASS | Loaded in `app/root.tsx`, guaranteed on every route via the single root layout. |
| Polaris a11y | N/A this sprint | M1 pages are static shells; MCP validation VALID for all 4; real axe-core run correctly deferred to M2/M3. |

## Findings

| # | Severity | Finding |
|---|---|---|
| F1 | Module-blocking (evidence) | No FT-08/FT-08b redact-then-query artifact against a live DB. |
| F2 | Module-blocking (evidence) | No route-probe transcript against a running server. |
| F3 | P3 | `.env` contains realistic-format (non-placeholder) Shopify key/secret — confirm provenance, rotate. |
| F4 | P4 (disclosed) | `run-gates.py` fails on Windows (`shell=False` can't exec `npm.cmd`); developer manually reproduced the identical log/exit-code contract. Fix the plugin script for Windows as follow-up. |
| F5 | P4 | No CI workflow exists yet in this repo; all local-gate evidence to date is developer-self-produced, not independently CI-executed. |
| F6 | Note | `customers/data_request` delivery-transport gap is real and honestly disclosed; needs an RFC before G-Review. |

## Path to clear the block

Stand up a seeded dev-store Postgres (local Docker/native install, or an actual Shopify dev
store's connected DB), run FT-05/06/07/08/08b/09/20 against it, capture the redact-then-query
dump and HMAC-401 probe as immutable artifacts, and re-open this module for QA.

## Recommendation

Given this is the very first sprint and infrastructure (OQ-1/OQ-3) is still being stood up, this
gate should either (a) wait for a real local/dev Postgres so full evidence can be gathered before
CONFIRM, or (b) receive an explicit, logged human override carrying the live-DB evidence
obligation forward to G5 (milestone regression) rather than silently dropping it. Not a decision
QA or the orchestrator makes unilaterally.
