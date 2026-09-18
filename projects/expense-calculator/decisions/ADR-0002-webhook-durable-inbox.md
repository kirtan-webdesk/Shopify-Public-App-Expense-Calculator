# ADR-0002 — Process webhooks via a Postgres durable inbox drained in-process, with no external broker

| | |
|---|---|
| **Status** | PROPOSED — pending G1.5 approval (Tech lead). Not self-approved. |
| **Date** | 2026-09-17 |
| **Gate** | G1.5 |
| **Related** | ADR-0001 (hosting), ADR-0008 (deletion lifecycle), spec.md §10, §12 |

---

## Context

Four webhooks ship: `customers/data_request`, `customers/redact`, `shop/redact`
(mandatory compliance topics) and `app/uninstalled`. Delivery has a **1s connect
/ 5s total** timeout, deliveries **can repeat**, and the compliance webhooks must
**actually do the work** — a stub that 200s fails app review.

`shop/redact` is the one with real work: it must delete a shop's configuration
and calculation history. That deletion is a multi-table transaction whose
duration is not guaranteed to fit comfortably inside a 5s ack budget on a cold
connection pool, and must not fail because the HTTP response was slow.

spec.md §12 explicitly assigned "webhook-ack strategy under the 1s/5s window" to
this gate.

## Decision

**Split acknowledgement from work, using a Postgres table as the queue.**

1. The webhook route calls `authenticate.webhook(request)` — HMAC verified,
   **401 on invalid**. The route lives **outside the `app` layout route tree**.
2. On success the route does exactly one thing: `INSERT` the delivery into a
   `webhook_event` inbox table (topic, shop, payload, `webhook_id`,
   `received_at`), then returns a **minimal 2xx immediately**. No business logic,
   no deletion, no external call in the request path.
3. **Dedup is the unique index on `webhook_id`** (`X-Shopify-Webhook-Id`). A
   replayed delivery hits the constraint, is swallowed as a no-op, and still
   returns 2xx. Dedup is therefore a database invariant, not application logic
   that can be forgotten on a new topic.
4. An **in-process drain worker** (a simple interval loop inside the same Node
   process — ADR-0001 makes this possible) claims unprocessed rows with
   `SELECT ... FOR UPDATE SKIP LOCKED`, executes the handler, and stamps
   `processed_at`. Failures increment `attempts` and record `last_error` for
   bounded retry with backoff; exhausted rows are left visible for alerting, not
   deleted.
5. `session` may be `undefined` on a webhook (the shop may already have
   uninstalled). Handlers key off the `shop` from the webhook payload/headers,
   never off a session.
6. Response bodies are **empty or minimal and never echo merchant or customer
   PII**. *(This is WebDesk hardening policy, not a Shopify requirement — label
   it as such in the code comment.)*

**No external broker, no Redis, no platform queue service.** The app's entire
background workload is deletion; Postgres is already a hard dependency; adding a
fourth external dependency to move one message would be unjustified.

## Alternative considered: do the work inline in the webhook request

Simpler — one code path, no inbox table, no worker, no dedup index. Rejected
because it puts a multi-table transactional delete inside a 5-second delivery
budget, and it makes correctness dependent on latency: a slow delete produces a
timeout, a retry, and then a *second* concurrent delete. It also makes dedup
purely behavioural (idempotent deletes happen to be safe) which stops being true
the moment `customers/data_request` needs to compile and send something.

**Alternative also considered: a real queue** (Redis/BullMQ, SQS, or a platform
background-function primitive). Correct and conventional — and unjustified here.
It adds a fourth external dependency, a second runtime to monitor, and provider
coupling (R9), to carry a workload of roughly one job per uninstall. Postgres
`SKIP LOCKED` is a well-understood queue at this volume. **Revisit trigger:** if
a future feature adds recurring, high-volume, or fan-out jobs, this ADR is
superseded rather than stretched.

## Consequences

- **Accepted cost: we own a small queue implementation** — claim, retry, backoff,
  attempt cap, and pruning of processed rows. That is real code (~a day) and real
  test surface, and it must not grow into a general job framework.
- **Accepted cost: the inbox table needs a retention policy.** Processed rows
  must be pruned, and — importantly — `webhook_event` rows for a shop must
  themselves be deleted by `shop/redact` (FT-08 enumerates tables, so this is
  caught rather than remembered). Note the ordering subtlety: the redact handler's
  own inbox row is the one it is executing from; delete it last or mark-then-purge.
- **Accepted cost: at-least-once, not exactly-once.** Handlers must be idempotent.
  Deletion naturally is; `customers/data_request` delivery must be guarded by its
  own completion record.
- Ack latency becomes a single INSERT — comfortably inside the budget, and
  measurable (FT-06).
- A crash between INSERT and processing loses nothing; the row is still there on
  boot. This is why the inbox, not `setImmediate`, is the answer.
- This design is the thing that would make a future move to serverless cheap
  (ADR-0001 consequences): ack is already decoupled from work.

## Enforcement

| Mechanism | What it catches |
|---|---|
| **FT-04** (custom route-placement check) | A webhook route nested under the `app` layout route |
| **FT-05** (vitest) | Invalid HMAC not returning 401 — and asserts no DB write occurred on a bad-HMAC request |
| **FT-06** (vitest timing + prod alert) | Work creeping back into the request path; ack latency drift |
| **FT-07** (vitest) | Replayed `X-Shopify-Webhook-Id` producing two effects; also asserts the unique index exists |
| **FT-09** (vitest) | PII in a webhook response body; missing reason-coded audit row |
| **Alert: inbox rows unprocessed > 15 min, or `attempts` at cap** | The worker being dead while the endpoint still returns 200 — the exact failure this split introduces, and the reason the alert is not optional |

**Verify-at-build:** the `compliance_topics` / `[[webhooks.subscriptions]]` TOML
shape and the exact retry/timeout semantics for 2026-07.
