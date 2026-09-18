# G4-sprint-1.1 live evidence v2 — BUG-1 / BUG-2 fix re-verification

Session date: 2026-09-18. Environment: local Postgres 18.1, database
`expense_calculator`, `DATABASE_URL` from `.env` (repo root), dev server via
`npm run dev` on `http://localhost:3000`. Purpose: re-run the same kind of
live evidence as `dev-evidence/g4-sprint-1.1-live-evidence/` (the original run
that discovered BUG-1 and BUG-2), against the code AFTER both approved fixes,
to confirm the fixes work under real HTTP + real Postgres, not just by source
reading. This is a NEW folder — the original run is untouched, kept as
evidence of the original defects.

**Net result: both fixes confirmed live. The correctly-HMAC-signed
`shop/redact` webhook that previously 500'd (BUG-1) now returns 200. The
drain worker then completed the full redaction — including the
zero-live-sessions path that previously crashed every attempt forever
(BUG-2) — ending with `compliance_audit_log.outcome = "completed"` and zero
rows across every tenant table, on the very first attempt (no retries).**

## A. All 4 webhook routes use `getRawWebhookTopic()` — confirmed by diff review

Read the full working-tree diff for all four routes
(`webhooks.app-uninstalled.tsx`, `webhooks.customers-data-request.tsx`,
`webhooks.customers-redact.tsx`, `webhooks.shop-redact.tsx`): each imports
`getRawWebhookTopic` from `app/services/webhook-topic.service.ts` and calls it
with its own literal expected topic (`"app/uninstalled"`,
`"customers/data_request"`, `"customers/redact"`, `"shop/redact"`) instead of
trusting `authenticate.webhook()`'s normalized `topic` field. All four are
structurally identical. No route was missed. (Live HTTP re-verification below
focuses on `shop/redact` per the assigned task; a correctly-signed
`customers-redact` webhook probe after redaction also returned 400 for a
missing-HMAC request, consistent with the shared `authenticate.webhook` path.)

## B. `shopify.app.toml` reconciliation — see the file's own header comment

Not repeated here — the file itself now carries a "PROVENANCE" and "SCHEMA
RECONCILIATION" comment block explaining the conclusion. Short version:
`shopify app config validate --json` (the actual installed CLI, v4.8.0)
returns `{"valid": true, "issues": []}` for the current file. Per real
shopify.dev docs ("Manage webhook subscriptions", "Subscribe to compliance
webhooks"), `compliance_topics` is documented only as a field INSIDE an
individual `[[webhooks.subscriptions]]` block — no official example shows it
as a bare `[webhooks]`-level array. Both the original hand-authored file and
the CLI-relinked file had a redundant top-level `[webhooks] compliance_topics`
array in addition to the four correct per-subscription entries; removed as
dead/duplicate config. `.shopify/project.json` (git-ignored) ties the
`client_id` in this file to a real linked dev store
(`wds55.myshopify.com`), consistent with a real `shopify app config
link`/`shopify app dev` run, not a fabrication.

## C. App URL change

`.env`: `SHOPIFY_APP_URL` changed from the CLI-default placeholder
`https://example.trycloudflare.com` to `http://localhost:3000`.
`shopify.app.toml`: `application_url` changed from `https://example.com` to
`http://localhost:3000`. `[auth] redirect_urls` left empty — this app has no
OAuth authorization-code callback route (`app/routes/auth.$.tsx` calls
`authenticate.admin()` directly, token-exchange only, ADR-0007), so there is
nothing for a redirect URL to point at, local or otherwise.

**Restated per the task: `http://localhost` cannot receive a real
Shopify-initiated call.** Shopify's own servers (webhook delivery, and the
browser-side app-embed load during a real install) cannot reach a bare
`localhost` on this machine. This value is correct ONLY for the
direct-to-server test probes below, run with `curl`/`fetch` from this same
machine against the locally-bound dev server — exactly what this evidence
run and the original v1 run both do. A real install or a real webhook
delivery on any store, including a disposable dev store, requires a public
HTTPS tunnel (`shopify app dev` or equivalent) with `application_url`
pointed at that tunnel's URL.

## D. Live evidence — fresh re-run

### D.1 Migration

`npm run db:migrate` — exit 0, `"No migrations were executed, database
schema was already up to date."` (schema is unchanged since v1; no new
migration was needed for this bug-fix-only change). File:
`01-migrate-check.log`.

### D.2 Pre-test baseline

All 7 tables confirmed empty before seeding (full-database counts, not just
this test shop) — the v1 run's own cleanup left the database in this state.

### D.3 Seed data (structural, not secret)

One fresh test shop, `shop_domain =
wsa-qa-g4-live-evidence-v2-test.myshopify.com` (distinct from v1's fixture
domain), plus one row each in `expense_rule` (percentage rule, marketing
category), `calculation` (revenue 1,000,000 minor / USD / total_expenses
150,000 minor), `calculation_line_item` (one line item, computed_amount_minor
= 150,000, satisfying the deferred reconciliation trigger), and
`webhook_event` (one pre-existing, already-processed `app/uninstalled` row).
All inserted in one transaction. **Deliberately did NOT seed a
`shopify_sessions` row this time** — v1 had to seed a fake session row to
prove the deletion topology worked once BUG-2 was isolated; this run's whole
point is to prove the NORMAL zero-session case (which is what every real shop
following the documented uninstall -> 48h -> redact sequence looks like) now
succeeds without that workaround.

Files: `03-seed-data.json`, `04-before-redact-row-counts.json` — 1 row each
across shop/expense_rule/calculation/calculation_line_item/webhook_event, and
explicitly **0** in `shopify_sessions` for this shop.

### D.4 Auth probes (re-confirmed, unchanged from v1)

| Probe | Result |
|---|---|
| `GET /healthz` (intentionally unauthenticated) | `200 ok` |
| `GET /app` unauthenticated | `302` redirect |
| `GET /app/calculator` unauthenticated | `410 Gone` (`authenticate.admin` rejects) |
| `POST /webhooks/shop-redact` — HMAC header missing | `400 Bad Request` |
| `POST /webhooks/shop-redact` — HMAC header present but wrong value | `401 Unauthorized` |

Files: `06-auth-and-missing-hmac-probe.txt`, `07-webhook-hmac-probe.txt`
(invalid-HMAC case).

### D.5 BUG-1 fix — correctly-signed `shop/redact` webhook

`POST /webhooks/shop-redact`, real HMAC-SHA256 signature computed in-process
from `process.env.SHOPIFY_API_SECRET` (never logged/printed), topic header
`shop/redact`, shop domain = the seeded test shop, a fresh
`X-Shopify-Webhook-Id`.

**Result: `200`, empty body — not the `500`
`chk_webhook_event_topic` constraint violation from v1.** File:
`07-webhook-hmac-probe.txt`.

### D.6 BUG-2 fix — drain, zero live sessions, full deletion

The in-process drain worker (`WEBHOOK_DRAIN_INTERVAL_MS=5000`) picked up the
newly-inserted row on its normal interval — no bypass, no manual trigger. On
the very first attempt (confirmed via `compliance_audit_log`, no
`webhook_event.attempts`/`last_error` retry history — the row itself was
cascade-deleted along with the shop, consistent with the previously-logged P3
"Defect / note C" cascade behavior, which is unchanged and was not in scope
to fix here), `handleShopRedact` ran to completion:

- `sessionStorageInstance.findSessionsByShop(shopDomain)` returned `[]`
  (0 sessions — the normal case).
- The `if (sessions.length > 0)` guard skipped `deleteSessions([])` entirely
  — no Postgres `syntax error at or near ")"`, the crash from v1's Defect B.
- `compliance_audit_log` recorded `outcome: "completed"` with
  `deleted_row_counts: {"shop":1,"calculation":1,"expense_rule":1,
  "webhook_event":1,"shopify_sessions":0,"calculation_line_item":1}`.

**Before/after row counts, every tenant table, real DB, this shop:**

| table | before | after |
|---|---|---|
| shop | 1 | 0 |
| expense_rule | 1 | 0 |
| calculation | 1 | 0 |
| calculation_line_item | 1 | 0 |
| webhook_event | 1 | 0 |
| shopify_sessions | 0 | 0 |

Files: `07-webhook-hmac-probe.txt`, `08-inbox-insert-confirmed.json` (empty —
see note below), `09-after-redact-row-counts.json`,
`10-compliance-audit-log-final.json`.

**Note on `08-inbox-insert-confirmed.json`:** this was an attempted
point-in-time check of the inserted `webhook_event` row's literal topic value,
run immediately after the `200` response. It came back empty because the
drain worker had already claimed, processed, and (via the shop-delete
cascade) removed that row within the ~1–5s window before the check ran — a
race against the 5-second drain interval, not a defect. The row's existence
and correct topic are proven indirectly but conclusively: (a) the `200`
response itself is only reachable past `insertWebhookEvent`'s
`chk_webhook_event_topic` CHECK constraint — a wrong topic value throws and
the route would 500, exactly as it did in v1; and (b)
`compliance_audit_log.topic = "shop/redact"` and the asserted
`deleted_row_counts.webhook_event: 1` confirm the drain worker actually
dispatched on `"shop/redact"` (the `switch` in `drain-worker.ts` only reaches
`handleShopRedact` for that literal string).

### D.7 Final auth re-confirmation (post-redaction)

Re-ran the core probes after the redact run completed: `GET /healthz` → 200,
`GET /app/calculator` unauthenticated → 410, `POST /webhooks/shop-redact`
missing HMAC → 400, `POST /webhooks/customers-redact` missing HMAC → 400
(confirms the shared `authenticate.webhook` HMAC gate is intact on a second
route too, not just the one under test). File:
`11-final-auth-reconfirmation.txt`.

## E. New finding (NOT fixed — outside this task's authorized scope)

While reading `app/services/compliance/app-uninstalled.service.ts` to confirm
BUG-1 completeness, found the SAME unguarded-empty-array pattern BUG-2 fixed
in `shop-redact.service.ts`, uncorrected here:

```ts
// app/services/compliance/app-uninstalled.service.ts, handleAppUninstalled
await sessionStorageInstance.deleteSessions(
  (await sessionStorageInstance.findSessionsByShop(shopDomain)).map((s) => s.id),
);
```

This calls `deleteSessions(ids)` unconditionally, with no `if (sessions.length
> 0)` guard. For any shop uninstalling with zero live sessions (plausible —
depends on exactly when session rows expire/get cleaned up relative to
uninstall), this would hit the identical Postgres `syntax error at or near
")"` that BUG-2 fixed for `shop/redact`. Unlike `shop/redact`, this handler
is NOT called inside the drain worker's shared transaction (see
`drain-worker.ts`'s `dispatch()` — the `app/uninstalled` case calls
`handleAppUninstalled(row.shopDomain)` without passing the transaction), so a
crash here would leave `markShopUninstalled`'s update committed
independently while the session-deletion half fails and retries forever —
a distinct, likely-worse failure mode than BUG-2's (which at least rolled
back atomically inside one transaction).

**This was found by code reading only — it was NOT triggered live in this
session** (triggering `app/uninstalled` on the test shop would have
interfered with the BUG-1/BUG-2 shop-redact re-verification this task was
scoped to, and fixing it was not commanded). Flagging for the orchestrator /
QA to log as a new bug and route through the same approve-then-fix process;
not applying a fix here per the no-auto-fix rule.

## F. Cleanup

The live redact run itself removed every seeded row across shop/
expense_rule/calculation/calculation_line_item/webhook_event/
shopify_sessions (confirmed 0/0/0/0/0/0, `09-after-redact-row-counts.json`).
The one remaining `compliance_audit_log` row (test-fixture data, not a real
audit trail) was explicitly deleted afterward (`12-final-cleanup.log`), which
also re-confirms full-database-wide zero counts across all 7 tables. Dev
server process stopped cleanly; `GET /healthz` connection-refused afterward.

No `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` literal value appears anywhere in
this evidence directory — HMAC signing was done in-process from
`process.env.SHOPIFY_API_SECRET`, never logged or printed.
