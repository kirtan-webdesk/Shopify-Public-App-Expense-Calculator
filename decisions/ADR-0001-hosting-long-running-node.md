# ADR-0001 — Host the app as a long-running always-on Node process, not serverless

| | |
|---|---|
| **Status** | ACCEPTED at G1.5 (2026-09-18, decided_by: sales@webdesksolution.ca). PARTIALLY SUPERSEDED at G1.5-revision (2026-09-18) by ADR-0009 (webhook processing mechanism) and ADR-0010 (Postgres connection strategy) — the hosting-class decision itself (long-running vs serverless) was overridden by an explicit human decision to use Vercel serverless hosting; this ADR's reasoning for why long-running was originally preferred remains valid documentation of the tradeoff, just no longer the active choice. |
| **Date** | 2026-09-17 |
| **Gate** | G1.5 |
| **Closes** | OQ-1 (architectural half). Provider/plan/region selection remains human-owned. |
| **Supersedes** | `project.json → shopify.hosting: "tbd"` |
| **Related** | ADR-0002 (webhook inbox), ADR-0007 (session storage), A6 in spec.md §11.2 |

---

## Context

`hosting: tbd` was deliberately deferred to this gate (spec.md §8). The decision
is long-running Node process vs serverless, and it is genuinely non-trivial for
this app for four reasons that pull in the same direction.

**Assumptions this rests on (state them, don't bury them):**

- Traffic is **low-volume and bursty**. A merchant opens a calculator
  occasionally; there is no background polling, no sync, no scheduled work
  (spec.md §9 — `jobs_ownership: app`, "note how little there is").
- The app is **free** (`app_pricing.model: free`). There is no revenue funding
  infrastructure, and no ops team on call.
- The **only** real background work is compliance redaction.
- Compliance-webhook delivery has a **1s connect / 5s total** timeout, and
  repeated delivery failure eventually costs you the subscription.
  **Verify-at-build:** the exact retry schedule and removal threshold for 2026-07
  are version-specific and are not asserted here as fact. The 1s/5s window is the
  documented delivery timeout and is the number the design is budgeted against.

## Decision

**Deploy the app as a single, always-on, long-running Node 22 process** (a
container or equivalent managed service instance) with **`min instances = 1`**,
co-located in the **same region** as its managed PostgreSQL.

A hosting target is acceptable if and only if it satisfies all six:

1. **Always-on. No scale-to-zero, no idle sleep, no "spins down after N minutes"
   free tier.** This is the requirement, not a preference.
2. Managed PostgreSQL available **in the same region** as the app instance.
3. A **release/pre-deploy command hook** so migrations run as a release step,
   never at request time (FT-17).
4. **Health-check-gated rolling deploys** (old instance serves until the new one
   is healthy).
5. Environment-variable/secret management, with secrets never in the repo.
6. Persistent local disk **not** required — all state is in Postgres (FT-15).

**Recommended shortlist** (any satisfies the six; this is an ops preference, not
an architectural constraint): Render, DigitalOcean App Platform, Railway, Fly.io,
Heroku. If WebDesk has no standing provider, **Render or DigitalOcean App
Platform** are the lowest-ops picks — same-region managed Postgres, a release
command, health checks, and no container-registry operations to own. Fly.io is
fine but its auto-stop/scale-to-zero behaviour **must be explicitly disabled**.

**Explicitly not recommended for this app:** Vercel, Netlify, Cloudflare Workers,
raw AWS Lambda / API Gateway — the serverless class this ADR rejects.

**Region:** choose by merchant geography and co-locate app + DB. Default for an
internal WebDesk North American app: a US-East or Canada-Central region.
Cross-region app↔DB is the most common self-inflicted latency bug in this shape
of app. Data-residency pressure is low (no customer PII is stored — see
ADR-0008), but the shop domain is merchant data; note it, don't overclaim it.

## Alternative considered: serverless functions

Genuinely attractive on paper — scale-to-zero costs nothing at this app's traffic
level, and there is no instance to patch or restart. It was rejected on four
grounds, in order of weight:

1. **Webhook delivery continuity is the load-bearing requirement, and this app's
   traffic shape guarantees cold containers.** Low-frequency, bursty traffic is
   the exact profile that keeps a serverless container cold. Worse, the one
   webhook that carries real work — `shop/redact` — arrives **~48 hours after
   uninstall**, i.e. it lands on a provably cold app, and it always will. A cold
   SSR + Sequelize + `pg` boot is hundreds of milliseconds to low seconds. On most
   modern platforms TCP/TLS connect terminates at an always-on edge, so the 1s
   *connect* timeout is usually survived and the cold start eats the 5s *total*
   budget instead — but "usually survived, variance unmeasured" is a poor basis
   for the one endpoint whose failure is a **GDPR and app-review failure**, not a
   dropped pageview.
2. **Async-after-ack is the prescribed pattern, and serverless makes it cost
   infrastructure instead of giving it away.** The rule is: ack 2xx fast, do the
   work asynchronously. A long-running process can return the response and keep
   working (ADR-0002). Serverless freezes or kills the execution context at
   response time, so "ack fast, delete later" requires a queue, a background/
   durable-function primitive, or a scheduled trigger. For an app whose entire
   background workload is *one deletion job*, that is **more** moving parts, not
   fewer — and `jobs_ownership: app` means we would own and operate them.
3. **Connection model.** Sequelize expects a stable pool. Serverless gives you N
   concurrent invocations each wanting connections, so you add PgBouncer / a proxy
   / a serverless driver — and transaction-mode pooling has known friction with
   prepared statements and session-level features (**verify-at-build** against the
   Sequelize + `pg` versions in use). One process = one pool = the default config
   is correct.
4. **Embedded-admin first paint.** The app renders in an iframe inside Admin;
   App Bridge boot and session-token exchange are already on the critical path.
   Adding cold-start latency to the first navigation of a merchant session is the
   worst possible place to spend it — and because usage is infrequent, *most*
   sessions would pay it.

Cost is not the tiebreaker, and it is honest to say so: an always-on small
instance plus a small managed Postgres is a low fixed monthly cost (confirm
actual figures at procurement — provider pricing is not asserted here), while
serverless's nominal idle savings are partly consumed by the pooler and queue
that grounds 2 and 3 force you to add. Predictable and few-parts beats
scale-to-zero for a free app with no ops rotation.

## Consequences

**Accepted costs — say them out loud:**

- **You pay for idle.** The instance is idle the overwhelming majority of the
  time. That idle is the insurance premium on the webhook connect budget, and it
  is the deliberate purchase being made here.
- **No automatic scale-to-zero and no automatic scale-out.** Acceptable at this
  volume. Because the app holds no in-process state (ADR-0007, FT-15), scaling
  out later is "add instances", not a re-architecture.
- **A single instance is briefly unavailable during deploy/restart.** Mitigated by
  health-check-gated rolling deploys, and by ADR-0002's durable inbox plus
  Shopify's retries — a webhook arriving mid-restart is retried and still lands.
- **We own patching, backups, and monitoring of a host.** Managed platforms
  reduce this to near-zero, which is why the shortlist is managed-platform only.
- **Reversal is not free.** Moving to serverless later is A6 (+10–25hr: webhook-ack
  and pooling rework). Note that ADR-0002's design deliberately makes that
  reversal *cheaper*, because ack is already decoupled from work.

**Enabled:** in-process drain worker with no broker (ADR-0002), a single Sequelize
pool, no cold-start budget to defend, and a three-dependency system.

## Enforcement

| Mechanism | What it catches |
|---|---|
| **FT-06** (webhook ack latency, vitest) + production alert on webhook p95 response time | A sleeping/cold tier being chosen anyway (R1), or ack drifting behind the work |
| **FT-15** (statelessness / restart-survival, vitest) | In-process state creeping in, which would block both redeploys and any future scale-out |
| **FT-17** (no migration in the request path) | Migrations being run per-request, a serverless-shaped anti-pattern |
| Deployment config review at **G5** — assert `min instances = 1` and same-region DB in the platform config committed to the repo | Silent downgrade to a sleeping tier during cost trimming |

A change of hosting class is an **RFC → ADR supersession**, and if effort moves,
a **G1 RENEGOTIATE** (A6).
