# G4-sprint-1.1 live evidence v3 — BUG-4 fix verification

Session date: 2026-09-18. Environment: local Postgres, database
`expense_calculator` (from `DATABASE_URL` in `.env`, repo root — value never
printed), dev server via `npm run dev` on `http://localhost:3000`. Purpose:
live-verify the BUG-4 fix in `app/services/compliance/app-uninstalled.service.ts`
(the same unguarded-`deleteSessions([])` defect class BUG-2 fixed in
`shop-redact.service.ts`, plus the shared-claim-transaction gap QA flagged as
part of BUG-4's blast radius), under a real dev server + real Postgres, not
just by source reading. This is a NEW folder — v1/v2 (BUG-1/BUG-2 evidence)
are untouched.

## Self-embedded provenance (this evidence run verifies this exact commit)

**Fix commit SHA (full):** `942179845f889e13b1d6dd870875f2f07e79e866`
**Fix commit SHA (short):** `9421798`
**Parent commit (pre-fix HEAD this session started from):**
`d9d7503c719a6b74f7ef5612fe04f299aa925fab`

This is a real, independently reproducible provenance claim, not just an
assertion: the three changed files' content AT that commit hash to the SHA-256
below (reproduce with `git show 942179845f889e13b1d6dd870875f2f07e79e866:<path>
| sha256sum`):

| file | SHA-256 of file content at commit 9421798 |
|---|---|
| `app/db/repositories/shop.repository.ts` | `87905f1b324bba4ea0d692807626aaf27805bfe774c392b8c2d8c92ad5a76689` |
| `app/services/compliance/app-uninstalled.service.ts` | `24f486ffbeb01c5551cc9992ed0c817fe530af77809b34e415ca3b131c172a19` |
| `app/workers/drain-worker.ts` | `eb21ccb4dc5d085fdda55543cbadf40b04c752ad556b71ab45cabc4525d05c5b` |

The live test below (steps D.1-D.7) was run against the working tree in the
state that became this commit (the fix was applied, gates were run, and the
live HTTP/DB test executed, then the code was committed as `9421798` — this
evidence directory is committed separately, immediately after, so it can
reference the fix commit's real SHA rather than a not-yet-existing one).

**Net result: the BUG-4 fix is confirmed live.** A correctly-HMAC-signed
`app/uninstalled` webhook against a shop seeded with **zero** session rows
(the exact case that crashes without the guard — `deleteSessions([])` is a
Postgres syntax error, not a no-op) returned `200`, the drain worker completed
`handleAppUninstalled` on the **first attempt** (`attempts: 0`,
`last_error: null`), `shop.uninstalled_at` was set correctly, and the
`webhook_event` row was marked `processed_at` — no crash, no retry loop.

## A. What changed (code, not evidence)

- `app/services/compliance/app-uninstalled.service.ts`: added
  `if (sessions.length > 0)` guard around `deleteSessions(...)`, matching the
  BUG-2 fix pattern already in `shop-redact.service.ts`. `handleAppUninstalled`
  now takes the caller's `Transaction` and threads it through.
- `app/db/repositories/shop.repository.ts`: `markShopUninstalled` now takes a
  required `transaction: Transaction` parameter and passes it to
  `ShopModel.update(...)`, matching `hardDeleteShop`'s existing pattern for
  shop/redact.
- `app/workers/drain-worker.ts`: `dispatch()`'s `"app/uninstalled"` case now
  passes the shared savepoint `transaction` into `handleAppUninstalled`, same
  as the existing `"shop/redact"` case.

Net effect: `handleAppUninstalled` now runs fully inside the drain worker's
per-row savepoint transaction (`claimAndProcessOne` in
`app/db/repositories/webhook-event.repository.ts`). If the (still
transaction-external, library-owned — ADR-0007) session-deletion step were to
throw for some other reason, the thrown error still propagates out of
`handleAppUninstalled` and triggers the savepoint rollback, undoing
`markShopUninstalled`'s write — no more scenario where `uninstalled_at` gets
committed independently of a failed session cleanup.

**Scope note on the transaction-wrapping question:** per the task's explicit
instruction to use judgment on this, I judged this a small, safe, in-scope,
mechanical change directly mirroring the existing `hardDeleteShop`/
`handleShopRedact` pattern (three signature changes, no new control flow, no
schema change) — not a bigger structural change — so it is included in this
fix rather than flagged back separately. See the developer report for the
one related item that WAS flagged back separately instead (the same
unguarded-delete pattern also exists, unfixed, in `app/workers/sweeper.ts`).

## B. Live evidence — fresh run

### B.1 Migration check

`npm run db:migrate` — exit 0, "No migrations were executed, database schema
was already up to date" (unchanged schema; this is a bug-fix-only change).
File: `01-migrate-check.log`.

### B.2 Pre-test baseline

Fresh test domain `wsa-qa-g4-bug4-live-evidence-v3-test.myshopify.com`
(distinct from v1/v2's fixture domains) confirmed at zero rows across
shop/expense_rule/calculation/webhook_event/shopify_sessions before seeding.
File: `02-before-row-counts.json`.

### B.3 Seed data

One shop row inserted directly (`shop_domain`, `installed_at = now()`,
`uninstalled_at = NULL`), id `6abe8990-21e6-4d1e-8fe9-875e03f679de`.
**Deliberately zero session rows seeded** — this is the exact case BUG-4's
guard exists for (most real shops uninstall with zero live sessions).
Confirmed `shopify_sessions` count = 0 for this shop immediately after
seeding. Files: `03-seed-shop.json`, `04-session-count-before.json`.

### B.4 Auth / HMAC probes

| Probe | Result |
|---|---|
| `POST /webhooks/app-uninstalled` — HMAC header missing | `400 Bad Request` |
| `POST /webhooks/app-uninstalled` — HMAC header present but wrong value | `401 Unauthorized` |

File: `06-auth-hmac-probes.txt`.

### B.5 The BUG-4 test — correctly-signed `app/uninstalled`, zero live sessions

`POST /webhooks/app-uninstalled`, real HMAC-SHA256 signature computed
in-process from `process.env.SHOPIFY_API_SECRET` (never logged/printed),
topic header `app/uninstalled`, shop domain = the seeded test shop, a fresh
`X-Shopify-Webhook-Id` (`bug4-live-v3-correct-signed-001`).

**Result: `200`, empty body.** File: `07-webhook-hmac-probe.txt`.

### B.6 Drain worker outcome

The in-process drain worker (`WEBHOOK_DRAIN_INTERVAL_MS=5000`) picked up the
row on its normal interval — no bypass, no manual trigger.

`webhook_event` row after processing (`08-inbox-immediately-after-ack.json`):

```json
{
  "webhook_id": "bug4-live-v3-correct-signed-001",
  "topic": "app/uninstalled",
  "received_at": "2026-09-18T10:17:32.511Z",
  "processed_at": "2026-09-18T10:17:33.954Z",
  "attempts": 0,
  "last_error": null
}
```

`attempts: 0` and `last_error: null` with `processed_at` set confirms this
succeeded on the **first** attempt — not a retry-forever loop. `05-server-boot.log`
has zero `error`/`fail` lines across the whole session (grepped, confirmed
empty).

`shop` row after processing (`09-shop-state-after.json`):

```json
{
  "shop_domain": "wsa-qa-g4-bug4-live-evidence-v3-test.myshopify.com",
  "installed_at": "2026-09-18T10:16:57.445Z",
  "uninstalled_at": "2026-09-18T10:17:33.941Z"
}
```

`uninstalled_at` correctly set (and, per ADR-0008, the shop row itself and
its (empty, in this run) rules/calculation history are RETAINED — app/uninstalled
is not a delete). Table counts after (`10-table-counts-after.json`): `shop: 1,
expense_rule: 0, calculation: 0, webhook_event: 1, shopify_sessions: 0` — the
webhook_event row is retained too (only shop/redact's hard-delete cascades it
away), consistent with ADR-0008's uninstall-vs-redact split.

### B.7 Final auth re-confirmation (post-test)

`GET /healthz` → 200, `GET /app` unauthenticated → 302,
`POST /webhooks/app-uninstalled` missing HMAC → 400 — confirms the HMAC gate
and other routes are unaffected by this change. File:
`11-final-auth-reconfirmation.txt`.

## C. Cleanup

Seeded shop row deleted directly; the cascade removed its (retained)
`webhook_event` row along with it (`ON DELETE CASCADE`). Re-confirmed 0/0/0/0/0
across all 5 relevant tables for this domain afterward. File:
`12-cleanup.json`. Dev server process stopped cleanly (`taskkill`); `GET
/healthz` connection-refused afterward (confirmed, not saved as a file since
it is a negative/no-response check).

No `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` / `DATABASE_URL` literal value
appears anywhere in this evidence directory — HMAC signing was done
in-process from `process.env.SHOPIFY_API_SECRET`, never logged or printed;
confirmed by grep across the whole directory before commit.

## D. Gates

`gates/` — `run-gates.py`'s own subprocess invocation of `npm` fails with
`WinError 2` (FileNotFoundError resolving `npm` under Python `subprocess`
`shell=False` on this native-Windows Python 3.14 install) — same environment
limitation already documented in `g4-sprint-1.1-live-evidence-v2/gates-manual/manifest.json`,
not new to this session, not a project defect.

`gates-manual/` — the same four commands run directly (same argv, real
subprocess exit code, `__GATE_EXIT__` marker + SHA-256 binding):

| gate | command | exit | status |
|---|---|---|---|
| lint | `npm run lint` | 1 | fail — pre-existing, unrelated: `decisions/migrations/00000000000001-initial-schema.js:40 'module' is not defined (no-undef)`, identical to the failure already recorded in v2's evidence, nothing in this fix touches that file |
| typecheck | `npm run typecheck` | 0 | pass |
| tests | `npm test` | 0 | pass (77/77) |
| build | `npm run build` | 0 | pass |

See `gates-manual/manifest.json` for the SHA-256-bound logs.
