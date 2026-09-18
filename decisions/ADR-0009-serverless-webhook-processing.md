# ADR-0009 — On Vercel, compliance work is invoked by a two-tier mechanism: best-effort post-response continuation, guaranteed by a single scheduled cron tick

| | |
|---|---|
| **Status** | ACCEPTED at G1.5-revision (2026-09-18, decided_by: sales@webdesksolution.ca). Supersedes the mechanism (not the correctness guarantees) of ADR-0002/ADR-0008. Implementation authorized, not yet built — re-verification scope (RV-1..RV-8) applies before this can be considered proven. |
| **Date** | 2026-09-18 |
| **Gate** | G1.5-revision |
| **Supersedes** | **ADR-0001 in part** — the hosting *class* (long-running always-on Node) and its six acceptance criteria. ADR-0001's *reasoning* is not retracted; it was correct and it was overridden by the human on 2026-09-18 (`project.json` audit_log → `hosting_decision_reversal`). **ADR-0002 §4 only** — the in-process interval drain worker. **ADR-0008 §5 in part** — "the same in-process worker as ADR-0002". |
| **Leaves standing** | ADR-0002 §§1,2,3,5,6 (ack-fast, durable inbox, `webhook_id` unique-index dedup, no session dependency, no-PII response). ADR-0008 §§1–4,6 (the whole two-phase lifecycle) and the 45-day window itself. ADR-0003/0005/0006/0007 untouched. |
| **Requires** | **ADR-0010** (Postgres connection strategy under serverless) — a companion decision, not optional. A small **G-Schema delta** (§7). |
| **Related** | ADR-0001, ADR-0002, ADR-0008, `qa-reports/G4-sprint-1.1.md`, BUG-1/2/4/5 evidence in `dev-evidence/g4-sprint-1.1-live-evidence*` |

---

## Context

The hosting class is **decided and not reopened here**. The human chose Vercel on
2026-09-18 after the app was already deployed there. This ADR does not relitigate
that; it designs the mechanism that has to work now.

What actually breaks, precisely:

- `app/workers/bootstrap.server.ts` starts two `setInterval` loops (drain every
  5s, sweep every 1h) as a **top-level side effect of `app/entry.server.tsx`**.
  That is an ADR-0001-shaped design: it assumes one process, booted once, alive
  forever.
- On Vercel, a function instance is created per invocation-burst and is **frozen
  or reclaimed after the response**. There is no guarantee any timer fires. There
  is also no single instance — several may exist concurrently, each having
  started its own timers, or none may exist at all for hours.
- So today, on Vercel, `shop/redact` would be HMAC-verified, inserted into
  `webhook_event`, acked 200 — and then **never processed**. The endpoint returns
  a correct-looking 2xx while GDPR deletion silently never happens. That is
  precisely the failure mode `shopify-webhooks-compliance` says fails app review,
  and it is *worse* than a visible crash because it is silent.

What must be preserved (this is the non-negotiable list, earned across four
rounds of live-DB QA — BUG-1, BUG-2, BUG-4, BUG-5):

1. **Ack-fast-then-process-async.** A multi-table delete must not run inside
   Shopify's 1s-connect / 5s-total delivery budget.
2. **Durable, idempotent intake.** The `webhook_event` row is written before the
   ack; dedup is the DB unique index on `webhook_id`, not application logic.
3. **The work actually completes**, with asserted row counts and a
   `compliance_audit_log` record.
4. **The 45-day safety net** for a lost / never-delivered `shop/redact`
   (ADR-0008 R2), with per-shop error isolation (BUG-5) so one shop's failure
   cannot abort the pass for every other shop.

**The reframe that drives this ADR:** the 5-second drain interval was never an
SLA. It was the cheapest cadence available to a process that happened to be
running anyway. Check the actual clocks:

| Work item | Real deadline | Source |
|---|---|---|
| `shop/redact` deletion | **30 days** from a webhook sent ~48h post-uninstall | `shopify-webhooks-compliance` |
| `customers/redact` | **30 days** | same |
| `customers/data_request` delivery | **30 days** | same |
| `app/uninstalled` (mark + kill sessions) | none — the token is already dead; there is no merchant waiting on it | ADR-0008 §1 |
| 45-day sweeper | fires on a 45-**day** threshold | ADR-0008 §5 |

**Nothing in this app has a sub-minute, or even a sub-day, processing SLA.**
Latency budget is not the constraint here; *guaranteed eventual execution* is.
Any mechanism that runs at least once per day, reliably, satisfies every deadline
with three-plus weeks of margin. That is a much easier thing to buy on serverless
than a 5-second heartbeat, and it is why this redesign is tractable at all.

The one genuinely tight budget — the **1s/5s ack** — is unchanged and is
satisfied the same way it already is: the route does one INSERT and returns.

## Decision

**Two tiers. The fast tier is an optimisation; the slow tier is the guarantee.
Correctness rests entirely on the slow tier.**

### D1 — Delete the in-process schedulers

`app/workers/bootstrap.server.ts` is **removed**, and its call site in
`app/entry.server.tsx` with it. Not disabled by an env flag, not left inert —
removed. A dormant `setInterval` in a serverless bundle is a trap: it survives
code review, it silently does nothing in production, and it would do something
unbounded and unbilled-for if the runtime model changed under us.

`drainOnce()`, `drainBacklog()`, `runSweeper()` and `runWebhookEventPruning()`
**keep their current signatures and bodies**. They stop being timer callbacks and
become functions invoked by an HTTP request. That is the entire nature of this
change: *how they get called*, not what they do.

### D2 — Fast tier: post-response continuation from the webhook route

The webhook route keeps its exact current shape — `authenticate.webhook()`,
`getRawWebhookTopic()` (BUG-1's fix), `ackAndEnqueueWebhook()`, return 200 — and
adds **one** line before the return: it schedules the drain to continue *after*
the response is flushed, via a thin app-owned wrapper:

```
app/workers/after-response.server.ts
  scheduleAfterResponse(fn: () => Promise<void>): void
```

- On Vercel, this delegates to `waitUntil` from `@vercel/functions`, which asks
  the runtime to keep the instance alive until the promise settles, **after** the
  response has already gone back to Shopify.
- Off Vercel (local `shopify app dev`, vitest), it falls back to a direct
  fire-and-forget with a caught rejection.
- It **never** rejects into the request path, and the route **never** awaits it.
  A failure in the continuation must not turn a successful ack into a 500 — the
  row is already durable; failing the ack would only buy a duplicate delivery.

The continuation drains **oldest-first, up to K rows (K=5), under a wall-clock
budget**, using the existing `claimAndProcessOne`. It is not "process my own
row" — any invocation opportunistically drains the head of the queue, which makes
the system self-healing under traffic.

**This tier is explicitly allowed to fail.** If Vercel freezes the instance, if
`waitUntil` is unsupported on the project's compute generation, if the drain
throws — the `webhook_event` row is still sitting there, `processed_at IS NULL`,
and tier two collects it. Nothing about the compliance guarantee depends on
`waitUntil` behaving the way the docs say it does. That property is deliberate
and is the main reason this design is safe to approve while §8's verify-at-build
items are still unverified.

### D3 — Slow tier: one Vercel Cron Function, one endpoint, one schedule

A single scheduled route — `app/routes/api.cron.tick.tsx` — declared in
`vercel.json`. Every tick, in order:

1. **Drain** the `webhook_event` backlog, oldest-first, under a wall-clock budget
   (§D4), using the same `claimAndProcessOne`.
2. **Sweep** — `runSweeper()`, unchanged, including BUG-5's per-shop
   `try/catch` isolation, now additionally bounded by a `LIMIT` on
   `findShopsUninstalledBefore` and the same wall-clock budget. Leftovers resume
   next tick; the 45-day threshold has 30+ days of slack, so "resume tomorrow" is
   free.
3. **Prune** — `runWebhookEventPruning()`, unchanged.
4. **Heartbeat** — record the tick (§D6).

**One endpoint, not three**, and one schedule, not three. Reasons: Vercel's cron
quota and minimum interval are plan-tier-dependent (§8, verify-at-build; the
Hobby tier is documented as roughly *one cron job execution per day* and a small
cron count, Pro tiers allow minute granularity); a single tick is portable across
both without a redesign. And the sweeper/prune queries are indexed and return
zero rows on essentially every tick — running them alongside the drain costs
nothing worth separating.

**Recommended schedule:** every 5 minutes if the plan permits; **daily is
architecturally sufficient** and must remain sufficient. If anyone ever proposes
a change that makes daily insufficient, that is an ADR supersession, not a
config tweak.

### D4 — The tick is resumable, never duration-dependent

The tick never tries to finish the whole backlog. It runs against a self-imposed
wall-clock budget (`CRON_TICK_BUDGET_MS`, default well under the function's
`maxDuration`), returns cleanly with a count of what it did, and leaves the rest
claimable.

This is deliberate insulation from a number I cannot verify and that Vercel
changes: the platform's max function duration per plan/compute generation (§8).
By never depending on it, the design survives whatever that number turns out to
be, and survives it changing.

`SELECT ... FOR UPDATE SKIP LOCKED` already makes overlapping ticks and
concurrent fast-tier drains safe — but note honestly that under ADR-0001 that
concurrency was **theoretical** (one process, one loop, one row at a time). Under
this ADR it is **routine**. The mechanism is unchanged; its exposure is not. See
RV-6 in §6.

### D5 — The cron route is a new route-authentication class

The route-auth matrix (`shopify-app-auth-and-routes`) has four classes: admin
session-token, webhook HMAC, app-proxy signature, and unauthenticated-health.
`/api/cron/tick` is **none of them**. It is a fifth class: **internal
shared-secret**.

It **must** verify `Authorization: Bearer ${CRON_SECRET}` (the header Vercel
Cron sends when `CRON_SECRET` is set — verify-at-build, §8) in **constant time**,
and return **401 with zero DB work** otherwise.

Getting this wrong ships an unauthenticated endpoint that triggers GDPR hard
deletion on demand. It is not "just an internal route". FT-03's allowlist keeps
`healthz` as the **only** unauthenticated route; the cron route is added to a new,
separate shared-secret class, never to the unauthenticated allowlist. If
`CRON_SECRET` is unset, the route **fails closed** (401 for everyone, including
the platform) rather than open.

### D6 — A heartbeat, because the cron is now a silent single point of failure

This is the risk this ADR *introduces*, and it must be paid for in the same ADR.

Under ADR-0001 a dead worker was detectable: the process was either up or it
wasn't, and unprocessed rows piled up against a 15-minute alert. Under D3, if the
cron is disabled, misconfigured, its secret rotated, or silently dropped by a
plan downgrade, then:

- webhooks still ack 200 (correct-looking),
- the fast tier still works most of the time (so the backlog looks healthy),
- and the **sweeper never runs** — the one thing that has no other trigger, and
  the one thing that exists specifically to catch a failure nobody noticed.

A backlog alert cannot see this, because a dead sweeper produces **no rows at
all**. Absence of evidence would read as health.

So: each tick writes to a **`job_heartbeat`** table (`job_name` PK,
`last_run_at`, `last_result`, `last_error`). `/healthz` — still unauthenticated,
still static-shaped — reports a single boolean:

```json
{ "status": "ok", "cronStale": false }
```

Boolean only. **No timestamps, no counts, no shop data** — a count would leak
merchant volume and a timestamp is needlessly precise operational intelligence on
a public endpoint. `cronStale` is true when `now - last_run_at` exceeds
`2 × expected interval` (env-configured, so a daily schedule doesn't alarm
hourly). An external uptime check on `/healthz` is then a dead-man's switch for
the entire compliance mechanism, for free.

ADR-0002's "inbox rows unprocessed > 15 min" alert is **re-tuned** here: the
threshold becomes `max(2 × cron interval, 30 min)`. On a daily schedule that is
~25 hours. That is not a regression in compliance terms (the deadline is 30 days)
but it *is* a real regression in operational responsiveness, and it is stated
rather than hidden.

### D7 — Handler code is not touched

`shop-redact.service.ts`, `app-uninstalled.service.ts`,
`customers-redact.service.ts`, `customers-data-request.service.ts`,
`webhook-inbox.service.ts`, `webhook-event.repository.ts`,
`webhook-topic.service.ts`, `shop.repository.ts` and the four webhook routes'
auth/ack logic are **unchanged by this ADR**, apart from the one added
`scheduleAfterResponse(...)` line per webhook route.

Every BUG-1/2/4/5 fix — raw `X-Shopify-Topic` header, the three `sessions.length
> 0` guards, the shared savepoint transaction plumbing, the per-shop `try/catch`
— survives verbatim. This ADR changes the caller, not the callee. That is the
single most important scoping property of this design and it is what keeps the
re-verification cost in §6 bounded.

## Alternatives considered

### A. Process the webhook synchronously inside the route

The simplest possible answer, and it deserves a real look rather than a reflex
rejection, because the workload is genuinely tiny: one shop's expense rules,
calculations, line items, inbox rows and (almost always zero) sessions — tens to
low hundreds of rows, a handful of indexed `DELETE`s in one transaction. On a
warm instance co-located with the DB that is single-digit to low-tens of
milliseconds. It would fit in 5 seconds with room to spare.

**Rejected**, on the timing of the one webhook that matters:

- `shop/redact` arrives **~48 hours after uninstall**. There is no plausible
  world in which that instance is warm. It is a guaranteed cold start —
  Node boot, the React Router server bundle, Sequelize + `pg`, a fresh TLS
  handshake to Postgres through a pooler — *before* the first `DELETE` is even
  issued. ADR-0001 made this exact argument and it is the one piece of ADR-0001's
  reasoning that the hosting reversal does not weaken; it strengthens it.
- It re-couples correctness to latency, which is the thing ADR-0002 deliberately
  decoupled. A slow delete becomes a timeout, becomes a retry, becomes a
  *second concurrent delete* of the same shop.
- It throws away the durable inbox, and with it the DB-enforced dedup and the
  crash-safety that four rounds of QA were spent validating.

Kept as a **degenerate fallback**, not a design: if both tiers were somehow
unavailable, the correct emergency behaviour is inline processing, not silence.

### B. A hosted queue — Upstash QStash, or Vercel's own queue primitive

Genuinely the textbook serverless answer: publish on ack, let the queue's
retry/backoff machinery call a processing endpoint. QStash in particular is
Vercel-compatible, has a free tier sized far above this app's volume, and would
work.

**Rejected**, for the same reason ADR-0002 rejected a broker, and one new one:

- It is a **fourth external dependency, a second secret, and a new inbound
  callback endpoint needing its own signature verification** — to move
  approximately **one message per uninstall** for a free app.
- We would be buying retry, backoff, dedup and durability that **we already own,
  already debugged live, and already have evidence for**. `webhook_event` +
  `SKIP LOCKED` + the unique index is a working queue with four rounds of
  bug-fixing behind it. Replacing it means re-proving all of it against a new
  substrate.
- Provider coupling (R9) gets *worse*, not better.
- **Vercel Queues specifically:** I will not build on it in this ADR. My
  knowledge of its availability, stability and plan gating is not current enough
  to assert (§8). If it is GA and free at this volume at build time, it is a
  legitimate **future** supersession of D3's drain half — but it would not remove
  the cron, because the **sweeper is time-triggered, not message-triggered**. A
  queue cannot fire an event that nobody sent; that is the entire point of
  ADR-0008 R2.

**Revisit trigger:** a future feature adding recurring, high-volume or fan-out
jobs supersedes this ADR rather than stretching it.

### C. External scheduler (GitHub Actions `schedule`, cron-job.org) hitting the endpoint

Would work — the repo is already on GitHub — and would dodge any Vercel cron
plan limits. **Rejected as the primary**, because GitHub's scheduled workflows are
explicitly best-effort (documented delays under load) and are **auto-disabled
after ~60 days of repository inactivity**. A compliance guarantee that silently
switches off when a finished, stable app stops getting commits is exactly the
wrong failure shape.

**Retained as the documented fallback** if Vercel cron turns out to be
unavailable or unusable on the chosen plan — the endpoint is plain
secret-authenticated HTTP, so swapping the trigger is a config change, not a
redesign. That portability is a deliberate property of D3/D5.

### D. Keep the timers and pay to keep an instance warm

Rejected as a contradiction in terms. Buying always-on behaviour on a platform
priced for scale-to-zero is paying serverless prices for ADR-0001's outcome
without ADR-0001's guarantees.

## Consequences

**Accepted costs — stated plainly:**

- **The cron is now load-bearing, and it is quiet when it dies.** D6 is the
  mitigation and it is not optional. Shipping D3 without D6 is strictly worse
  than what exists today, because today's failure is loud.
- **Processing latency goes from ~5 seconds to "usually immediate
  (`waitUntil`), guaranteed within one cron interval".** On a daily schedule the
  worst case is ~24 hours against a 30-day deadline. Compliant with large margin;
  a real reduction in operational responsiveness; irrelevant to every merchant-
  facing behaviour in this app.
- **Concurrency moves from theoretical to routine.** Multiple instances will
  drain simultaneously. `SKIP LOCKED` is designed for it, and now must be
  *proven* under it (RV-6), not just reasoned about.
- **Connection management becomes a real problem** where ADR-0001 got it free.
  This is ADR-0010 and it is the highest-risk unknown in this package. Note that
  `PostgreSQLSessionStorage` opens its **own** connection separately from the
  app's Sequelize pool — two per instance, times N instances.
- **"Serverless is free" is not the outcome here.** Honest accounting: a
  serverless-appropriate Postgres (Neon/Supabase class) + a Vercel plan tier that
  permits useful cron granularity + billed `waitUntil` execution time lands in
  the same rough monthly band as the small always-on instance ADR-0001 costed.
  The human's decision was made on other grounds and that is legitimate — but
  nobody should record "we saved the hosting cost" as a consequence of it.
  **Also flag (verify-at-build, §8): Vercel's Hobby tier is documented as
  non-commercial use.** A public App Store listing, even a free one, plausibly
  falls outside that. That is a question for the human, not an architectural
  finding.
- **A new table** (`job_heartbeat`) → G-Schema delta (§7).
- **Reversal remains cheap**, which is worth noting: because ADR-0002's
  ack/work split is preserved intact, moving *back* to a long-running host is
  re-adding a scheduler that calls the same four functions. This ADR does not
  burn that bridge.

**Preserved:** every compliance guarantee, every BUG-1/2/4/5 fix, the durable
inbox, DB-enforced dedup, the audit trail, the 45-day net, per-shop isolation.

## §6 — Re-verification scope

Same bar as BUG-1/2/4/5: **real HTTP requests against a real deployment and a
real Postgres.** Source review is not evidence here — BUG-1 and BUG-2 were both
invisible to source review and were caught only by a live request, and this
change moves the invocation path, which is precisely where those bugs lived.

**Carries over unchanged — re-proof not required:**

| Already proven | Why it still holds |
|---|---|
| Deletion topology (all tenant tables 1→0), asserted row counts, `compliance_audit_log` completion rows | `shop-redact.service.ts` / `hardDeleteShop` untouched (D7) |
| BUG-1 raw-topic fix | `webhook-topic.service.ts` untouched; reads a request header that Vercel forwards verbatim (confirm once in RV-1, no separate test) |
| BUG-2/4/5 `sessions.length > 0` guards (all three sites) | untouched |
| BUG-4 shared-savepoint plumbing | `claimAndProcessOne` untouched |
| BUG-5 per-shop `try/catch` isolation | `runSweeper` body untouched — but its *trigger* changes, so the end-to-end path is re-proven in RV-5 |
| HMAC 401 / missing-HMAC 400 / dedup unique index | route auth and `ackAndEnqueueWebhook` untouched |
| Unit + integration suites (79 tests) | unchanged; expect only the deleted `bootstrap.server.ts` coverage to drop |

**Must be re-proven live (new evidence artifacts):**

| ID | What | Why it can't be inferred |
|---|---|---|
| **RV-1** | FT-08 end-to-end on a real **Vercel preview deployment** + real pooled Postgres: signed `shop/redact` → 200 → every `shop_id` table 1→0 → audit row `completed` | This is the whole point. The deployment target changed. |
| **RV-2** | `waitUntil` genuinely executes *after* the response on real Vercel. Evidence: response timestamp vs. `processed_at`, plus function logs showing post-response execution | **Cannot be proven locally.** The local fallback path is a different code path. This is the single most important new unknown. |
| **RV-3** | **Fast tier disabled/forced-to-fail → the cron tick collects the orphan row and completes it.** | This is the actual guarantee. ADR-0001's architecture never had to prove a backstop because the worker was the only path. |
| **RV-4** | Cron route auth probe: no header / wrong secret / missing `CRON_SECRET` env → **401 and zero DB writes** (verified by row counts, not by reading code) | New unauthenticated-sensitive-endpoint surface. Same rigor as the F2 auth-probe transcript. |
| **RV-5** | Sweeper via the HTTP cron path: two >45-day stale zero-session shops in one tick → both deleted, two distinct `completed` audit rows, per-shop isolation intact | BUG-5's v4 evidence proved this under `setInterval`. The trigger is new. |
| **RV-6** | Concurrency: two simultaneous invocations against the same backlog → exactly one effect per row, no duplicate audit rows | Previously impossible (single process, single loop). Now the normal case. |
| **RV-7** | **Connection behaviour under the pooler** (ADR-0010): N concurrent invocations don't exhaust connections; transactions + `FOR UPDATE SKIP LOCKED` behave correctly through transaction-mode pooling | Highest-risk unknown. A pooler that breaks `FOR UPDATE` semantics or prepared statements breaks the queue silently. |
| **RV-8** | Cold-start ack latency on real Vercel: measured p95 of the webhook route from cold against **1s connect / 5s total** | If this fails, it is an **RFC back to the PM**, not something to design around. Mitigations would be a warming tick or accepting Shopify's retry — both need a human decision. |

Evidence artifacts self-embed the commit SHA and file content hashes (QA's F5
ask, already adopted in v3/v4). Note the still-open carried-forward items —
F3 (`.env` secret rotation) and F5 (no CI workflow; **must** be resolved before
G5, which needs authorized-executor artifacts, not self-produced ones).

## §7 — Handoffs

**G-Schema delta (small, needs a revision pass, not a full re-review):**

- New table **`job_heartbeat`** — `job_name` (PK, text), `last_run_at`
  (timestamptz), `last_result` (text), `last_error` (text null). One row per job.
- It is **not tenant data**: no `shop_id`, deliberately, same class of documented
  exception as `compliance_audit_log`. It must be added to the **non-tenant
  exemption list** in FT-02c and to FT-08's table-enumeration exclusion, or those
  tests will fail on a table that correctly has no `shop_id`.
- Forward-only migration. No change to any existing table.

**PM / estimate inputs** (I do not estimate; these are the cost drivers, roughly
in descending order): RV-7 and RV-2 carry the most uncertainty; RV-1/3/5 are
mechanical but need a real deployed environment and a serverless-compatible
database that does not exist yet; the code change itself (D1, D2's one line per
route, D3's endpoint, D5's auth check, D6's table + healthz field) is the
*smallest* part of this work. The prerequisite Vercel adapter/render fix
(`@vercel/react-router` preset + `vercel.json`) is separate implementation scope
and is not designed here.

## §8 — Verify-at-build (do not treat any of these as asserted fact)

Vercel's platform moves fast and my knowledge has a cutoff. Every one of these is
a check to perform at build, and each has a stated fallback so that being wrong
about it is recoverable:

1. **`waitUntil` semantics** — availability in `@vercel/functions`, behaviour on
   the project's compute generation (Fluid vs. legacy), whether the instance is
   actually kept alive to completion, and how it is billed. *Fallback if
   unavailable or unreliable: the fast tier is simply dropped. The cron alone is
   compliant.* This is why the design does not depend on it.
2. **Cron minimum interval and cron-count quota per plan tier.** My understanding
   is Hobby ≈ once-daily with a small job cap, and Pro ≈ minute granularity —
   **verify**. *Fallback: daily is architecturally sufficient (§Context).*
3. **Whether Vercel Cron sends `Authorization: Bearer $CRON_SECRET`**, and the
   exact env-var name. *Fallback: a secret in the path or a custom header from an
   external scheduler (Alternative C).*
4. **Max function duration** per plan/compute generation. *Fallback: none needed
   — D4 makes the design independent of it.*
5. **Vercel Queues** — availability, GA status, plan gating. Not designed on.
6. **Hobby-tier non-commercial-use terms** vs. a free public App Store listing.
   A question for the human.
7. **Vercel + React Router 7 adapter** (`@vercel/react-router` preset) — required
   for the render fix and a prerequisite to all of the above.
8. Carried forward from ADR-0002: the `compliance_topics` /
   `[[webhooks.subscriptions]]` TOML shape and exact retry/timeout semantics for
   API version 2026-07.

## §9 — Enforcement (fitness tests, gated at G5)

New tests. ADR-0001's "assert `min instances = 1`" check is **retired** with the
hosting decision it enforced; FT-06, FT-07, FT-08, FT-08b, FT-09 and FT-20 stand
unchanged in intent but must be re-pointed at the new invocation path.

| ID | Test | Tool | Enforces |
|---|---|---|---|
| **FT-21** | No recurring in-process scheduler anywhere in the server bundle: zero `setInterval(` at module scope, no import of a worker-bootstrap module from `entry.server`, and `app/workers/bootstrap.server.ts` does not exist | custom AST check (ts-morph) + dependency-cruiser | ADR-0009 D1 |
| **FT-22** | `/api/cron/tick` with no / wrong bearer returns **401** and performs **zero DB writes** (asserted by row counts before and after); with `CRON_SECRET` unset it fails **closed** | vitest integration | ADR-0009 D5 |
| **FT-23** | Resumability: with `N+1` pending rows and a budget allowing `N`, the tick returns 200 cleanly and the remaining row is still `processed_at IS NULL` **and claimable** (no claimed-but-unprocessed limbo) | vitest integration | ADR-0009 D4 |
| **FT-24** | No webhook route awaits drain work inline: the drain is reached only via `scheduleAfterResponse(`, and FT-06's `<500ms with work still pending` assertion holds | custom AST check + existing FT-06 | ADR-0009 D2, ADR-0002 §1 |
| **FT-25** | Deploy-config check: `vercel.json` declares the cron schedule for `/api/cron/tick`; `CRON_SECRET` is referenced and not literal; the function region env matches the DB region env | custom check over `vercel.json` + env manifest | ADR-0009 D3, ADR-0010 |
| **FT-26** | Sequelize `pool.max` is within the serverless bound, and the production connection string is the **pooled** endpoint | custom check | ADR-0010 |
| **FT-27** | `job_heartbeat` is written by the tick, and `/healthz` reports `cronStale` — with **no timestamp, no count, no shop identifier** in the body (extends FT-18) | vitest | ADR-0009 D6 |
| **Alert** | `cronStale === true` on `/healthz` (external uptime check) — dead-man's switch | — | ADR-0009 D6 |
| **Alert** | Oldest unprocessed `webhook_event` age > `max(2 × cron interval, 30 min)` — **re-tuned** from ADR-0002's 15 min | — | ADR-0002, ADR-0009 D6 |
| **Alert** | Sweeper deleted ≥ 1 shop — unchanged, still an alert, not a routine event | — | ADR-0008 R2 |

A change of hosting class, or any change that makes a daily cron insufficient, is
an **RFC → ADR supersession**, and if effort moves, a **G1 RENEGOTIATE**.
