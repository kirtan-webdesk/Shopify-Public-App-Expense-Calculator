# ADR-0010 — Reach Postgres through a server-side connection pooler with a per-instance pool of 1, keeping the `pg` driver and Sequelize unchanged

| | |
|---|---|
| **Status** | PROPOSED — pending G1.5-revision approval (Tech lead). Not self-approved. Not implemented. |
| **Date** | 2026-09-18 |
| **Gate** | G1.5-revision |
| **Supersedes** | **ADR-0001 §"Connection model"** (its alternative-analysis point 3) and the comment block in `app/db/sequelize.ts` that asserts "the default pool config is correct here … those only bite under serverless, which this app deliberately isn't." |
| **Companion to** | ADR-0009 — required, not optional. ADR-0009's queue mechanics are only as correct as the connection semantics underneath them. |
| **Related** | ADR-0007 (session storage), ADR-0003 (repository layer) |

---

## Context

ADR-0001 got connection management for free: one process, one Sequelize pool
(`max: 10`), one stable set of TCP connections. That assumption is now false.

Under ADR-0009's model, every function instance that boots creates **its own**
Sequelize pool, and `PostgreSQLSessionStorage` opens **its own connection
separately** from that pool (ADR-0007 keeps app SQL out of `shopify_sessions`,
which also means it is a second client). With `pool.max: 10`, a handful of
concurrent instances can request more backend connections than a small managed
Postgres allows, and Postgres answers `too many connections` — which, in this
app, surfaces as **a failed compliance drain**, not a failed page load.

There is a second, subtler hazard specific to ADR-0009: the inbox queue depends
on `SELECT ... FOR UPDATE SKIP LOCKED` inside a transaction, and on nested
transactions (`SAVEPOINT`) that BUG-4's fix made load-bearing. Those are
**session-scoped** Postgres behaviours. A pooler in the wrong mode, or a driver
that silently multiplexes, can break them in ways that do not throw — they just
stop providing the guarantee. That is the failure shape this ADR exists to
prevent.

## Decision

1. **Connect through a server-side connection pooler**, not directly to Postgres.
   Provider-agnostic requirement: the production `DATABASE_URL` must be the
   provider's **pooled** endpoint (Neon's pooled host, Supabase's pooler port,
   or an equivalent PgBouncer-class front end). The provider choice is
   human-owned, like ADR-0001's was; the requirement is not.
2. **Use transaction-mode pooling**, and set the app's own pool to **`max: 1`,
   `min: 0`**, with a short `idle`. One in-flight query per instance; the pooler
   does the real multiplexing. A per-instance pool larger than 1 buys nothing on
   an execution model that handles one request per instance at a time and costs
   backend connections that are the scarce resource.
3. **Keep `pg` and Sequelize.** No serverless HTTP driver, no ORM change.
4. **Disable driver-side prepared statements / statement caching** where the
   driver or Sequelize would use named prepared statements, because transaction-
   mode pooling does not guarantee the same backend session across statements.
   *(Verify-at-build: `pg` does not use named prepared statements by default
   unless asked — confirm for the installed `pg` / Sequelize 6 versions rather
   than assuming.)*
5. **Migrations connect to the DIRECT (unpooled) endpoint**, never the pooler.
   DDL, advisory locks and `sequelize-cli`'s meta table want a stable session.
   Two connection strings in the environment: `DATABASE_URL` (pooled, runtime)
   and `DIRECT_DATABASE_URL` (unpooled, migrations only). FT-17's "no migration
   in the request path" stands and now has a second reason to.
6. **Co-locate the Vercel function region with the database region.** A
   cross-region hop on every query is the fastest way to lose the 1s/5s ack
   budget that ADR-0009 RV-8 has to measure. ADR-0001 said the same thing about
   app↔DB co-location; the reasoning survives the hosting change intact.

## Alternative considered: a serverless HTTP driver (Neon serverless driver class)

The idiomatic serverless answer — HTTP/WebSocket to the database, no TCP pool, no
pooler to operate, and it removes connection exhaustion as a category.

**Rejected**, on one decisive point: over HTTP, "one statement, one request" and
interactive transaction support is a distinct, more constrained mode. The inbox
queue is built on a multi-statement interactive transaction holding `FOR UPDATE
SKIP LOCKED` row locks across a handler call, with a nested `SAVEPOINT` inside
it (`claimAndProcessOne`). That is exactly the pattern these drivers support
least well, it would require a driver/ORM swap, and it would invalidate the live
evidence already gathered for BUG-2/4/5. Changing the transaction substrate
underneath a mechanism that took four rounds of live QA to get right is the
worst possible place to spend novelty budget.

**Also considered: connect directly, no pooler, and just lower `pool.max`.**
Rejected — it makes the connection ceiling a function of concurrent instance
count, which is exactly the variable serverless refuses to bound for you. It
would work right up until it didn't, under load, silently, on the compliance
path.

## Consequences

- **Accepted cost: two connection strings** and the discipline to keep them
  straight. A migration accidentally run through the pooler is a confusing,
  intermittent failure.
- **Accepted cost: one more piece of infrastructure in the path**, with its own
  limits and its own failure modes, where ADR-0001 had none.
- **Accepted cost: transaction-mode pooling forecloses session-level features**
  (session variables, `LISTEN/NOTIFY`, advisory locks held across statements).
  The app uses none today. If a future feature wants one, this ADR is superseded,
  not worked around.
- **Accepted risk, stated honestly: this is the least-verified part of the
  ADR-0009 package.** ADR-0009 RV-7 exists specifically to prove it live, and it
  is the item most likely to produce a surprise.
- **Enabled:** the queue's concurrency story (ADR-0009 D4/RV-6) becomes safe at
  arbitrary instance counts, and the existing `claimAndProcessOne` code stands
  unchanged.

## Enforcement

| Mechanism | What it catches |
|---|---|
| **FT-26** (custom check) | `pool.max` drifting back up; a production config pointing at the direct endpoint instead of the pooled one |
| **FT-25** (custom check over `vercel.json` + env manifest) | Function region and DB region silently diverging |
| **FT-17** (existing) + a check that migration config uses `DIRECT_DATABASE_URL` | A migration run through the pooler; a migration in the request path |
| **FT-23 / RV-6** (existing + new) | `SKIP LOCKED` and `SAVEPOINT` semantics failing to hold through the pooler — the silent failure this ADR is written to prevent |
| **RV-7** (live, pre-G5) | Connection exhaustion under real concurrent invocations |

**Verify-at-build:** pooler mode names and port conventions are provider-specific
and change; `pg` / Sequelize 6 prepared-statement behaviour must be confirmed
against the installed versions, not assumed from this ADR.
