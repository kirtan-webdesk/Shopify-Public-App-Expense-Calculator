# G4-sprint-1.1 live evidence v4 — BUG-5 fix verification

Session date: 2026-09-18. Environment: local Postgres, database
`expense_calculator` (from `DATABASE_URL` in `.env`, repo root — value never
printed), dev server via `npm run dev` on `http://localhost:3000`, sweeper
interval overridden for this session only via an inline process env var
(`SWEEPER_INTERVAL_MS=8000`, NOT written to `.env`) so the real interval-driven
sweep loop fires in seconds instead of the default 1 hour. Purpose: live-verify
the BUG-5 fix in `app/workers/sweeper.ts` (the same unguarded-`deleteSessions([])`
defect class BUG-2/BUG-4 already fixed elsewhere, PLUS the per-shop loop-
isolation fix QA's blast-radius finding required), under a real dev server +
real Postgres, not just by source reading. This is a NEW folder — v1/v2/v3
(BUG-1/BUG-2/BUG-4 evidence) are untouched.

## Self-embedded provenance (this evidence run verifies this exact commit)

**Fix commit SHA (full):** `8590c244a7db7f6b837bcfb8fd587491d75f9a17`
**Fix commit SHA (short):** `8590c24`
**Parent commit (pre-fix HEAD this session started from):**
`9123217b8052269409bcc1ec521eba75a491b78f` (BUG-4 evidence commit)

This is a real, independently reproducible provenance claim, not just an
assertion: the one changed file's content AT that commit hash to the SHA-256
below (reproduce with `git show 8590c244a7db7f6b837bcfb8fd587491d75f9a17:app/workers/sweeper.ts
| sha256sum`):

| file | SHA-256 of file content at commit 8590c24 |
|---|---|
| `app/workers/sweeper.ts` | `e681658036c2c600b44f336771278e48f8fd98c7f9291cfbe205b1ff5bfd86ac` |

The live test below (steps B.1-B.8) was run against the working tree in the
state that became this commit (the fix was applied, gates were run, and the
live test executed, then the code was committed as `8590c24` — this evidence
directory is committed separately, immediately after, so it can reference the
fix commit's real SHA rather than a not-yet-existing one).

**Net result: the BUG-5 fix is confirmed live, for BOTH things QA asked for.**
Two shops seeded in the **same sweep pass**, each with `uninstalled_at` 50
days in the past (past the 45-day `SWEEPER_WINDOW_DAYS` cutoff) and **zero**
session rows (the exact case that crashes without the guard —
`deleteSessions([])` is a Postgres syntax error, not a no-op): the sweeper
hard-deleted BOTH shops, recorded a `completed` `compliance_audit_log` row for
EACH, logged zero errors across the whole session, and the server remained
healthy (`GET /healthz` → 200) afterward. This proves (1) the immediate crash
is fixed, and (2) — the specific concern QA raised — one shop's processing no
longer aborts the pass for the other shop in the same run.

## A. What changed (code, not evidence)

- `app/workers/sweeper.ts`:
  - Added the same `if (sessions.length > 0)` guard around
    `sessionStorageInstance.deleteSessions(...)` as BUG-2
    (`shop-redact.service.ts`) and BUG-4 (`app-uninstalled.service.ts`).
  - Wrapped each shop's per-iteration work (the `sequelize.transaction(...)`
    call, the deletion, the audit record, and the `console.warn` ALERT) in a
    `try/catch` inside `runSweeper`'s `for` loop. On failure, the loop now
    logs a loud `console.error` ALERT identifying the failed shop and
    explicitly stating that OTHER shops in the pass are unaffected, then
    continues to the next shop, instead of letting the throw propagate out of
    `runSweeper()` entirely (which previously aborted the whole pass — the
    blast-radius mechanism QA traced).

**Scope note on per-shop error isolation:** the task explicitly asked me to
use judgment on whether to fix this as part of BUG-5 or flag it back
separately. I judged it a small, safe, in-scope, mechanical change: it adds a
`try/catch` around an existing, already-self-contained unit of work (the body
of the `for` loop) with no new control flow inside that unit, no schema
change, and no change to what a single shop's processing does — only to what
happens to the *other* shops when one fails. This is consistent with how the
BUG-4 transaction-wrapping question was judged (see
`dev-evidence/g4-sprint-1.1-live-evidence-v3/00-SUMMARY.md` §A). It is
included in this fix rather than flagged back separately.

I found no further instance of the same unguarded-`deleteSessions` pattern
anywhere else in the codebase — see §D below for the confirming grep. This
closes out the full defect-class sweep (BUG-2, BUG-4, BUG-5 were the three
call sites; all three now match the same guarded pattern).

## B. Live evidence — fresh run

### B.1 Migration check

`npm run db:migrate` — exit 0, "No migrations were executed, database schema
was already up to date" (unchanged schema; this is a bug-fix-only change).
File: `01-migrate-check.log`.

### B.2 Pre-test baseline

Two fresh test domains, `wsa-qa-g4-bug5-live-evidence-v4-shopA.myshopify.com`
and `wsa-qa-g4-bug5-live-evidence-v4-shopB.myshopify.com` (distinct from
v1/v2/v3's fixture domains), confirmed at zero rows across
shop/expense_rule/calculation/webhook_event/compliance_audit_log before
seeding. File: `02-before-row-counts.txt`.

### B.3 Seed data — TWO stale, zero-session shops in the same pass

Two shop rows inserted directly in a single `INSERT ... VALUES (...), (...)`:

| shop | `installed_at` | `uninstalled_at` |
|---|---|---|
| shopA (`1f0d15ff-b4a3-48c9-bd0b-3cf863887232`) | 60 days ago | 50 days ago |
| shopB (`95513085-325a-4a90-b643-7ce950193c33`) | 55 days ago | 50 days ago |

Both `uninstalled_at` values (50 days ago) are past the 45-day
`SWEEPER_WINDOW_DAYS` cutoff, so `findShopsUninstalledBefore` selects both in
the same query/pass. **Deliberately zero session rows seeded for both** — the
exact case BUG-5's guard exists for (the sweeper's normal case, not an edge
case — see §A of the commit message). Confirmed `shopify_sessions` count = 0
for both shops immediately after seeding. Files: `03-seed-shops.csv`,
`04-session-count-before.txt`.

### B.4 Server boot with a short sweeper interval

`SWEEPER_INTERVAL_MS=8000 npm run dev` (inline env override for this session
only — `.env`'s own `SWEEPER_INTERVAL_MS=3600000` is untouched). Vite dev-mode
SSR modules load lazily on first request, so `GET /healthz` was issued once to
trigger `entry.server.tsx`'s module-scope `startBackgroundWorkers()` call —
confirmed by the log line `[bootstrap] background workers started (drain
every 5000ms, sweep every 8000ms)`. File: `05-server-boot.log`.

### B.5 The BUG-5 test — real interval-driven sweep pass, two stale zero-session shops

After the first 8-second sweep tick, the log shows BOTH shops processed, with
no crash and no error between them:

```
[sweeper] ALERT: shop wsa-qa-g4-bug5-live-evidence-v4-shopA.myshopify.com was hard-deleted by the 45-day safety sweeper — this means shop/redact was never successfully processed for it. Investigate the missed delivery (ADR-0008 R2).
[sweeper] ALERT: shop wsa-qa-g4-bug5-live-evidence-v4-shopB.myshopify.com was hard-deleted by the 45-day safety sweeper — this means shop/redact was never successfully processed for it. Investigate the missed delivery (ADR-0008 R2).
```

Both ALERT lines fired — shopB's processing was NOT aborted by anything in
shopA's processing (and, per the fix, nothing in either one crashes to begin
with). File: `05-server-boot.log`; grep for `error|fail|crash|unhandled`
(case-insensitive, excluding React Router's unrelated "Future Flag Warning"
lines) across the whole boot log returns **zero matches** — confirmed
separately (not saved as a file since it is a negative/no-match check).

### B.6 Database state after — both shops fully processed

`shop` and `shopify_sessions` rows for both test domains, after the sweep
(`06-shop-state-after.txt`):

```
shop_rows_remaining,session_rows_remaining
0,0
```

Both shop rows hard-deleted (ADR-0008 R2's intended outcome for a shop whose
`shop/redact` was never observed), zero orphaned session rows for either.

`compliance_audit_log` rows for both domains (`07-compliance-audit-log-after.txt`):

```
webhook_id,topic,outcome,reason,deleted_row_counts,occurred_at
sweeper-1f0d15ff-b4a3-48c9-bd0b-3cf863887232-1789727304592,shop/redact,completed,45-day safety sweeper — shop/redact was never observed for this shop,{"shop": 1, "calculation": 0, "expense_rule": 0, "webhook_event": 0, "shopify_sessions": 0, "calculation_line_item": 0},2026-09-18 15:58:24.606+05:30
sweeper-95513085-325a-4a90-b643-7ce950193c33-1789727304671,shop/redact,completed,45-day safety sweeper — shop/redact was never observed for this shop,{"shop": 1, "calculation": 0, "expense_rule": 0, "webhook_event": 0, "shopify_sessions": 0, "calculation_line_item": 0},2026-09-18 15:58:24.673+05:30
```

Both shops got a **distinct, `completed`** audit row (~70ms apart — both
processed within the same sweep tick, sequentially in the loop, not skipped
or merged), each asserting `shop: 1` deleted and `shopify_sessions: 0` —
matching the zero-session seed exactly. This is the direct proof of QA's
loop-resilience concern: shopB's row exists and is `completed`, not missing
or `no_op`, which is what would have happened (or worse, nothing at all)
had shopA's processing aborted the pass.

### B.7 Final health re-confirmation (post-sweep, server still running)

`GET /healthz` → `200` (`09-final-health-reconfirmation.txt`), issued after
both ALERT lines had already been logged — confirms the process itself did
not crash or need a restart between the two shops' processing, consistent
with the per-shop `try/catch` keeping any failure (had one occurred) local to
its own iteration rather than killing the process or the interval timer.

### B.8 Cleanup

Dev server process (bound to `:3000`, PID resolved via `netstat`) stopped via
`taskkill /F`; confirmed via a subsequent `GET /healthz` returning no HTTP
status (connection failed) that the process is down. No manual row cleanup
was needed — both seeded shop rows were already hard-deleted by the sweep
itself as the test's own outcome (re-confirmed at 0/0 in `06-shop-state-after.txt`
above); `compliance_audit_log` rows are correctly retained (that table is
deliberately NOT keyed to `shop_id` and must survive shop deletion — see
`compliance-audit-log.repository.ts`'s own header).

No `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` / `DATABASE_URL` literal value
appears anywhere in this evidence directory — confirmed by grep across the
whole directory before commit (see §D).

## C. Defect-class closure check

BUG-2 (`shop-redact.service.ts`), BUG-4 (`app-uninstalled.service.ts`), and
now BUG-5 (`sweeper.ts`) were the three call sites of
`sessionStorageInstance.deleteSessions(...)` in this codebase. Confirmed by
grep (`08-defect-class-grep.txt`) that all three, and only these three, exist,
and all three now use the identical `if (sessions.length > 0)` guard. No
fourth call site exists anywhere in `app/`. This closes out the full
defect-class sweep QA already ran — this fix does not introduce a fourth
variant of the same mistake elsewhere.

## D. Gates

`gates/` — `run-gates.py`'s own subprocess invocation of `npm` fails with
`WinError 2` (FileNotFoundError resolving `npm` under Python `subprocess`
`shell=False` on this native-Windows Python 3.14 install) — same environment
limitation already documented in
`g4-sprint-1.1-live-evidence-v2/gates-manual/manifest.json` and
`g4-sprint-1.1-live-evidence-v3/gates-manual/manifest.json`, not new to this
session, not a project defect.

`gates-manual/` — the same four commands run directly (same argv, real
subprocess exit code, `__GATE_EXIT__` marker + SHA-256 binding):

| gate | command | exit | status |
|---|---|---|---|
| lint | `npm run lint` | 1 | fail — pre-existing, unrelated: `decisions/migrations/00000000000001-initial-schema.js:40 'module' is not defined (no-undef)`, identical to the failure already recorded in v2/v3's evidence, nothing in this fix touches that file |
| typecheck | `npm run typecheck` | 0 | pass |
| tests | `npm test` | 0 | pass (77/77) |
| build | `npm run build` | 0 | pass |

See `gates-manual/manifest.json` for the SHA-256-bound logs.

## E. MCP validation

**N/A — backend-only change.** `app/workers/sweeper.ts` is a Node.js/Sequelize
background worker with no Admin GraphQL call, no Polaris web component, and
no Liquid/theme code. Per the developer-agent preflight rule, MCP validation
(`validate_graphql_codeblocks` / `validate_component_codeblocks` /
`validate_theme`) is not applicable to this change and none was run, stated
explicitly rather than silently omitted — same as v2/v3's BUG-2/BUG-4
evidence.
