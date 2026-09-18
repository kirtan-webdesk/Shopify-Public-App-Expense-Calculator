# G1.5-revision implementation — ADR-0009 (serverless webhook processing) + ADR-0010 (serverless Postgres connection strategy)

Session date: 2026-09-18. Environment: local Postgres 18 (`expense_calculator`,
`postgres://postgres:root@localhost:5432/expense_calculator`, `PGSSLMODE=disable`
— **never** the live Neon production database referenced by the committed
`.env`'s `DATABASE_URL`; every command in this evidence run passed local
connection strings as inline shell env var overrides, never written to
`.env`). Dev server via `npm run dev` on `http://localhost:3100`
(non-default port to avoid clashing with any other local instance),
`CRON_SECRET` set to a throwaway local-only test value never reused anywhere
real. This directory covers the full ADR-0009/ADR-0010 implementation: the
two-tier drain mechanism, the cron route, the cron-auth shared secret, the
`job_heartbeat` dead-man's switch, and two genuine defects this
implementation surfaced live (both fixed, both re-verified live below).

## Self-embedded provenance

**Commit SHA (full):** `6fabae8a62972d69c7bed8e1c2f91cf65b049bf5`
**Commit SHA (short):** `6fabae8`

The live evidence in this directory (§A, §B) was gathered against the
working tree in the state that became this commit — code was written, gates
were run, the live tests below were executed (including finding and fixing
the two regressions in §B), and the result was committed as `6fabae8`. This
evidence directory is committed separately, immediately after, so it can
reference the real commit SHA rather than a not-yet-existing one (same
pattern as `g4-sprint-1.1-live-evidence-v4/00-SUMMARY.md`).

## What was built (see the developer handoff message for the full list)

1. **Fast tier** (ADR-0009 D2) — `app/workers/after-response.server.ts`
   (`scheduleAfterResponse`) + `app/workers/drain-worker.ts`
   (`drainUpTo`/`continueDrainAfterResponse`), wired into all 4 webhook
   routes with one added line each.
2. **Slow tier** (ADR-0009 D3/D4) — `app/routes/api.cron.tick.tsx`: drain →
   sweep → prune → heartbeat, wall-clock-budgeted, resumable.
3. **Cron auth** (ADR-0009 D5) — `app/services/cron-auth.service.ts`,
   constant-time (SHA-256-then-`timingSafeEqual`) `Bearer $CRON_SECRET`
   check, fails closed if unset.
4. **Sweeper bounding** (ADR-0009 D3) — `app/workers/sweeper.ts`'s
   `runSweeper` gained an optional `{limit, budgetMs}` and now returns an
   outcome summary; the per-shop try/catch body (BUG-5) is untouched.
   `app/db/repositories/shop.repository.ts`'s `findShopsUninstalledBefore`
   gained an optional `limit` + oldest-first ordering.
5. **Dead-man's switch** (ADR-0009 D6) — new `job_heartbeat` table
   (`db/migrations/20260918130000-add-job-heartbeat.cjs`,
   `app/db/models/job-heartbeat.model.ts`,
   `app/db/repositories/job-heartbeat.repository.ts`); `app/routes/healthz.tsx`
   now returns `{"status":"ok","cronStale":bool}`.
6. **G-Schema delta** — `decisions/data-model.md` §4.7 (new),
   `decisions/fitness-test-plan.md` FT-02c and FT-08 exemption lists updated.
7. **`app/workers/bootstrap.server.ts` deleted**, its call site in
   `app/entry.server.tsx` removed (ADR-0009 D1, explicit "removed, not
   flagged" instruction).
8. **ADR-0010** — `app/db/sequelize.ts` pool changed to `max:1, min:0`;
   `db/config/config.cjs` now prefers `DIRECT_DATABASE_URL` for migrations
   (falls back to `DATABASE_URL` in dev only, with a loud warning); verified
   (not just asserted) that the installed `pg`/`sequelize` pair never uses
   named prepared statements by default (read `node_modules/pg/lib/query.js`
   and `node_modules/sequelize/lib/dialects/postgres/query.js` directly).
9. **Two genuine live-discovered regressions, both fixed** (see §B.3/§B.6
   below) — `pool.max:1` deadlocking against three call sites that opened a
   second standalone connection while an outer transaction already held the
   pool's only one.
10. **New tests**: `tests/architecture/no-in-process-scheduler.test.ts`
    (FT-21 approximation), `tests/services/cron-auth.service.test.ts` (FT-22's
    pure-logic half), `tests/architecture/route-auth-matrix.test.ts` extended
    with the 5th shared-secret auth class.
11. `vercel.json` — `crons` declaration for `/api/cron/tick`
    (`0 0 * * *`, daily — matches the `CRON_INTERVAL_MINUTES=1440` default in
    `.env.example`, which `/healthz`'s staleness threshold is computed from).

## A. Local, fully-verified-here (no live Vercel needed)

### A.1 Gates

`gates/` — `run-gates.py` itself fails on this Windows environment (exit 127,
`FileNotFoundError`: `subprocess.run(["npm",...], shell=False)` cannot
resolve `npm.cmd`) — the same pre-existing cross-platform gap (F4) disclosed
in every prior round since G3. Reproduced manually with the identical
contract (real `npm` invocation via the Bash tool, real exit code,
`__GATE_EXIT__` marker, SHA-256 over the log):

| gate | command | exit | status |
|---|---|---|---|
| lint | `npm run lint` | 1 | fail — **pre-existing, unrelated**: `decisions/migrations/00000000000001-initial-schema.js:40 'module' is not defined (no-undef)`. Nothing in this round's diff touches that file; confirmed the same finding across every prior round since G4-sprint-1.1 |
| typecheck | `npm run typecheck` | 0 | pass |
| tests | `npm test` | 0 | pass (95/95 — 77 baseline + 18 new: 3 no-in-process-scheduler, 7 cron-auth unit, 8 route-auth-matrix extensions) |
| build | `npm run build` | 0 | pass |

See `gates/manifest.json` for the SHA-256-bound logs.

### A.2 Cron-auth probes (RV-4 / FT-22 approximation) — real HTTP, real Postgres

Files `01`–`03`. Before-counts captured (`01`), then three unauthorized
requests to `GET /api/cron/tick` (`02`): no `Authorization` header, a
wrong-value bearer, and a header missing the `Bearer ` prefix — **all three
returned 401**. After-counts (`03`) are **byte-identical** to before-counts
across `job_heartbeat`, `webhook_event`, and `compliance_audit_log` — **zero
DB writes on an unauthorized request**, confirmed by row count, not by
reading the code. The `CRON_SECRET`-unset fail-closed case is proven
separately and permanently by the unit test
`tests/services/cron-auth.service.test.ts` (same function, same code path —
starting a second dev server with the env var unset to re-prove it live
would exercise identical logic for a higher cost, so it was not duplicated
here).

### A.3 RV-3 (orphan-row) + RV-5 (sweeper via cron) equivalent — one real tick

Seeded (`04`): one `customers/redact` `webhook_event` row with
`processed_at IS NULL` (simulating "the fast tier never ran" — the exact
scenario the slow tier exists to backstop) and two shops with
`uninstalled_at` 60 days in the past and zero sessions (the BUG-5 scenario).
One authorized `GET /api/cron/tick` (`05`):

```json
{"ok":true,"elapsedMs":101,"drained":{"drained":1,"failed":0,"backlogExhausted":true},"swept":{"consideredCount":2,"deletedCount":2,"failedCount":0,"resumable":false},"pruned":"completed","errors":[]}
```

DB state after (`06`): the orphaned row's `processed_at` is set and it has a
`no_op` `compliance_audit_log` row; **both** stale shops are hard-deleted
with **two distinct `completed`** audit rows ~11ms apart (per-shop isolation,
BUG-5's guarantee, intact under the new trigger). `job_heartbeat` shows one
`cron_tick` row, `last_result: "ok"`.

### A.4 `/healthz` `cronStale` — all three states, live

`07`: immediately after a fresh successful tick, `cronStale: false`. Then,
directly against Postgres: backdated the heartbeat to 49 hours ago →
`cronStale: true` (exceeds `max(2×1440min, 30min) = 48h` at the default
`CRON_INTERVAL_MINUTES=1440`); backdated to 47 hours → `cronStale: false`
(under the threshold); deleted the heartbeat row entirely (never-ran case) →
`cronStale: true`. All three boundary cases confirmed live, not just by
reading the threshold formula.

### A.5 RV-6 (concurrency) — two real, simultaneous HTTP requests

Seeded 6 unprocessed `customers/redact` rows (`09`'s seed step). Fired two
concurrent `GET /api/cron/tick` requests via the shell's own `&`/`wait`
(`08a`, `08b`): tick 1 drained 3, tick 2 drained 3 — **exactly 6 total, no
overlap, no double-processing**. DB state (`09`): all 6 rows have
`processed_at` set and **exactly one** `compliance_audit_log` row each (no
duplicates) — `SELECT ... FOR UPDATE SKIP LOCKED` correctly partitions the
backlog under real concurrent requests against the actual HTTP route, not
just direct function calls.

### A.6 FT-23 (resumability) — real budget-bounded tick, twice

Restarted the server with `CRON_DRAIN_MAX_ROWS=2`. Seeded 3 rows (N+1 over
the cap). Tick 1 (`10a`): `drained:2, backlogExhausted:false`; DB state
(`10b`) shows the third row still `processed_at: null, attempts: 0` —
**claimable, not stuck in a claimed-but-unprocessed limbo**. Tick 2 (`10c`):
`drained:1, backlogExhausted:true`; DB state (`10d`) shows all 3 now
processed. Resumability confirmed live across two real ticks, not inferred
from the code.

### A.7 Fast-tier off-Vercel fallback — real HTTP, immediate DB check

A correctly-HMAC-signed `customers/redact` webhook POSTed directly to
`/webhooks/customers-redact` (`11` computes the real HMAC, `12a` is the
200 response). DB checked immediately after, with **no cron tick called in
between** (`12b`): `processed_at` is set, **18ms** after `received_at`. This
proves the off-Vercel fallback described in
`app/workers/after-response.server.ts`'s own comment — `fn()` starts running
the instant `scheduleAfterResponse` is called, independent of whether
`waitUntil()` does anything — genuinely runs, not just that the code compiles.
**This is NOT RV-2** (RV-2 is specifically about Vercel's real `waitUntil()`
keeping a frozen/reclaimed instance alive after the response on the actual
platform, which cannot be exercised outside a real Vercel deployment — see
the developer handoff for what to check there).

## B. The two live-discovered regressions (found, fixed, re-verified — all in this session)

### B.1 How they were found

Not by source review. `app/db/sequelize.ts`'s `pool.max` change from `10` to
`1` (ADR-0010 point 2) is architecturally correct and explicitly required,
but it turns "a repository call that doesn't thread the caller's
transaction" from harmless (under `pool.max:10`, Sequelize just grabs a
second free connection) into a hard deadlock (under `pool.max:1`, the second
connection request blocks on `acquire: 30000` until it times out with
`"Operation timeout"`, while the caller's own transaction is still holding
the pool's one connection). This is exactly the class of bug BUG-1/2/4/5
were: invisible from reading the handler code in isolation, only visible
once a real claimed-transaction → nested-handler-call → repository-query
chain is actually executed against a real, connection-limited pool.

### B.2 Regression 1 — `customers/redact` and `customers/data_request`

`app/services/compliance/customers-redact.service.ts` and
`customers-data-request.service.ts` both called
`recordComplianceOutcome(...)` with **no transaction argument** — a
pre-existing pattern that was harmless under the old `pool.max:10`. First
live probe (before either fix; not saved as a numbered artifact — this was
the initial failing run, superseded by the clean re-run in §A.3/§B.4) showed
a seeded `customers/redact` row stuck at `attempts: 2,
last_error: "Operation timeout"` after ~60+ seconds. **Fix**: both handlers
now accept and thread the caller's `Transaction` through to
`recordComplianceOutcome`, matching the existing `handleShopRedact` /
`handleAppUninstalled` pattern; `app/workers/drain-worker.ts`'s `dispatch()`
updated to pass it. Re-verified clean in §A.3/§A.5 above (all 7 seeded
`customers/redact` rows across those two tests processed in well under
200ms combined, zero timeouts).

### B.3 Regression 2 — `shop/redact`'s own shop lookup

`app/services/compliance/shop-redact.service.ts` already threaded the
transaction into `hardDeleteShop` and `recordComplianceOutcome` (BUG-2/BUG-4
era work), but its **first line**,
`findShopContextByDomain(shopDomain)` (`shop.repository.ts`), did not accept
a transaction at all. Live probe (`13a`–`13d`): seeded a real shop with a
rule, a calculation, and a line item; sent a signed `shop/redact` webhook;
got a 200 immediately (ack is unaffected — it's a single INSERT before any
of this); then confirmed **nothing was actually deleted** — `13c` shows all
four row counts still at 1, no audit row. Waited out the full 30-second
acquire timeout (`13d`): `attempts: 1, last_error: "Operation timeout"` —
identical failure mode to B.2, this time hitting the flagship GDPR handler
itself. **Fix**: `findShopContextByDomain` gained an optional `transaction`
parameter (only `shop-redact.service.ts`'s call site needed it — the other
call site, `webhook-inbox.service.ts`'s `ackAndEnqueueWebhook`, runs before
any claim transaction is open and is unaffected either way).

### B.4 Re-verification after both fixes — full deletion topology, real webhook, `pool.max:1`

Fresh server restart, fresh shop seeded (`14a`), same signed `shop/redact`
webhook POSTed (`14b`) → 200 → DB state (`14c`): **all four row counts
1→0** (`shop`, `expense_rule`, `calculation`, `calculation_line_item`), one
`completed` `compliance_audit_log` row with asserted
`deleted_row_counts` matching exactly (`shop:1, expense_rule:1,
calculation:1, calculation_line_item:1, shopify_sessions:0`), and the
executing `webhook_event` row itself gone too — consistent with the
documented ADR-0002/data-model.md §5 ordering note (the row survives the
explicit exclusion inside the transaction but is still removed by the
`ON DELETE CASCADE` when `shop` itself is deleted at the end of the same
transaction; this is the same, already-accepted BUG-3 behavior from prior
rounds, not a new issue).

### B.5 Exhaustiveness check

Every function accepting an (optional-or-required) `transaction: Transaction`
parameter across `app/db/repositories/` was enumerated (`grep -n "transaction
Transaction" app/db/repositories`) and every call site inside the drain
worker's dispatch chain (`app/workers/drain-worker.ts`,
`app/workers/sweeper.ts`, and all four `app/services/compliance/*.service.ts`
files) was checked against it. `markShopUninstalled` and `hardDeleteShop`
require a transaction at the type level (not optional — a caller cannot
forget). `recordComplianceOutcome` and `findShopContextByDomain` are
optional-by-type but now threaded at **every** call site that executes from
inside an already-open transaction; the two call sites that correctly run
**outside** any open transaction (`webhook-inbox.service.ts`'s ack-and-enqueue,
and `sweeper.ts`'s top-level `findShopsUninstalledBefore` query before its
per-shop transactions begin) are left without one, correctly.

## C. Genuinely NOT verifiable here — needs the human against the real deployment

See the developer handoff message for the full, actionable list (RV-2, RV-7,
RV-8 and the §8 verify-at-build items) — not duplicated here to avoid drift
between two copies of the same list.

## D. MCP validation

**N/A — backend/infra-only change.** Every file touched or added this round
is Node.js/TypeScript/Sequelize/Postgres/Vercel-config — zero Admin GraphQL
calls, zero Polaris web components, zero Liquid/theme code. Per the
developer-agent preflight rule, `validate_graphql_codeblocks` /
`validate_component_codeblocks` / `validate_theme` are not applicable to this
change and none was run — stated explicitly, not silently omitted, same as
every prior backend-only round (BUG-2/4/5, G-Schema).

No `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` / any `DATABASE_URL` literal
value appears anywhere in this directory — confirmed by grep across the
whole directory before commit.
