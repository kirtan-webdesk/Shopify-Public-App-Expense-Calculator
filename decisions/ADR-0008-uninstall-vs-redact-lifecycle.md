# ADR-0008 — Uninstall soft-marks and kills sessions; `shop/redact` hard-deletes; a 45-day sweeper covers undelivered redacts

| | |
|---|---|
| **Status** | ACCEPTED at G1.5 (2026-09-18, decided_by: sales@webdesksolution.ca). Uninstall-vs-redact lifecycle distinction and the 45-day safety sweeper concept remain valid and unchanged; PARTIALLY SUPERSEDED at G1.5-revision (2026-09-18) only regarding the sweeper's *trigger mechanism* (hourly in-process timer → daily Vercel Cron tick), per ADR-0009. |
| **Date** | 2026-09-17 |
| **Gate** | G1.5 |
| **Related** | ADR-0002, ADR-0003, ADR-0007, spec.md §10, D3, D12, G-Schema |

---

## Context

Two deletion-adjacent events arrive at different times with different meanings:

- **`app/uninstalled`** — the merchant removed the app. The access token is dead.
- **`shop/redact`** — sent **~48 hours after** uninstall; the app must act within
  **30 days** and actually delete that shop's data.
- **`customers/redact`** — sent 10 days after the request if the customer has no
  order in the last 6 months, otherwise withheld until 6 months have passed; act
  within 30 days. **Legal-retention exception:** do not complete a redaction the
  app is legally required to retain (not applicable here — nothing is retained
  for legal reasons).
- **`customers/data_request`** — deliver to the store owner within **30 days**.

The app **stores no customer PII** — only the shop domain, merchant-entered
figures, and rule configuration. That reduces what must be deleted; it does not
reduce what must be *implemented*. A stub that 200s without doing the work fails
app review.

The under-discussed failure mode: **what if `shop/redact` never arrives?**
Delivery is retried, not guaranteed forever. A design that deletes *only* on
webhook receipt silently retains shop data indefinitely — a GDPR exposure with no
alarm attached to it.

## Decision

**A two-phase lifecycle, plus a time-based safety net.**

1. **On `app/uninstalled`:** delete all session rows for the shop (ADR-0007), set
   `shop.uninstalled_at = now()`, and **retain** the shop's rules and calculation
   history. Rationale: the merchant has a ~48-hour window before redaction in
   which a reinstall should restore their configuration, and Shopify's own
   sequencing assumes the app still holds the data when `shop/redact` arrives.
2. **On reinstall before redaction:** clear `uninstalled_at`; existing rules and
   history are available again. (If the merchant reinstalls after redaction, they
   start clean — this is correct, not a bug, and should be stated in support docs.)
3. **On `shop/redact`:** hard-delete **every** row belonging to that shop —
   sessions, expense rules, calculations, calculation line items, inbox rows, and
   the shop row itself — in a single transaction, with **deleted row counts
   asserted and logged** rather than trusting a cascade silently. Write a
   completion audit record (shop domain hash or shop domain, topic, timestamp,
   counts) that survives the deletion, so the app can prove it acted.
4. **On `customers/redact` and `customers/data_request`:** verify HMAC, dedup,
   ack 2xx fast, and execute a **documented, logged no-op with a stated reason** —
   *"this app stores no customer-identified data; the app holds no records keyed
   to a customer."* The reason is written in the handler, in the runbook, and in
   the privacy policy, because **G-Review will ask for it**. The audit row is the
   evidence.
5. **45-day safety sweeper:** a scheduled pass (the same in-process worker as
   ADR-0002) hard-deletes any shop with `uninstalled_at` older than 45 days,
   regardless of whether `shop/redact` ever arrived, and logs that it fired.
   **A sweeper firing is an alert**, not a routine event — it means a webhook was
   lost and we want to know. The window sits inside the 30-day action requirement
   measured from the ~48-hour-post-uninstall send, with margin for a late delivery.
   **Verify at build** that 45 days remains the right number against 2026-07's
   documented timings; it is a constant in one place, not scattered.
6. Response bodies are minimal and **never echo merchant or customer PII**
   (WebDesk hardening policy, not a Shopify rule).

## Alternative considered: delete everything immediately on `app/uninstalled`

Simpler and maximally privacy-forward — no retention window, no sweeper, and
`shop/redact` becomes a trivially satisfied no-op. Rejected on two grounds: a
merchant who uninstalls and reinstalls within hours (a common accident, and
common during a plan or theme migration) loses all their configuration and
history with no recovery path; and it makes `shop/redact` untestable as real
behaviour — there would be nothing left to delete, which reads to a reviewer
exactly like the stub that fails review.

Cost of rejecting it: shop data lives for up to ~48 hours (typically) or up to 45
days (worst case, undelivered redact) after uninstall. That is the retention
window we are explicitly choosing, and it must be stated in the privacy policy.

**Alternative also considered: rely on `shop/redact` alone, no sweeper.** Rejected
— it is the R2 failure mode: silent indefinite retention with no alarm.

## Consequences

- GDPR deletion is a **real, verifiable** behaviour with an audit trail, which is
  what app review actually checks.
- **Accepted cost: a retention window** that must appear in the privacy policy and
  the listing, and a `shop.uninstalled_at` column plus sweeper code (G-Schema
  handoff §8.3).
- **Accepted cost: the sweeper is a scheduled job** — a small amount of the
  background machinery the app otherwise doesn't need. It rides on ADR-0002's
  existing worker loop rather than adding a scheduler.
- Deletion completeness depends on every tenant table having `shop_id`
  (ADR-0003) — which is why FT-08 enumerates tables from the live schema instead
  of from a hand-maintained list.
- Note for the redact handler: it executes from its own inbox row (ADR-0002).
  Delete-last or mark-then-purge, or the transaction removes the record it is
  running from.

## Enforcement

| Mechanism | What it catches |
|---|---|
| **FT-08** vitest integration, the flagship test: seed a shop with rules, calculations, line items, sessions and inbox rows; deliver `shop/redact` with a valid HMAC; drain the worker; then **enumerate every table with a `shop_id` column from `information_schema`** and assert zero rows for that shop | A table added in a later milestone that nobody wired into redaction — it fails the test instead of shipping |
| **FT-08b** vitest: assert the completion audit record exists with non-zero counts, and that a *second* delivery of the same redact is a safe no-op | Unprovable deletion; non-idempotent redaction |
| **FT-09** vitest: `customers/redact` and `customers/data_request` return a minimal 2xx with **no PII in the body**, and write a reason-coded audit row | The no-op becoming an undocumented stub — the thing app review rejects |
| **FT-20** vitest: a shop with `uninstalled_at` older than the window is purged by the sweeper; one inside the window is not; reinstall inside the window restores configuration | Sweeper off-by-window errors in both directions |
| **Alert:** sweeper fired ≥ 1 shop | A lost `shop/redact` delivery (R2) |
| Gated at **G5** (M1, re-run at M5) | |
