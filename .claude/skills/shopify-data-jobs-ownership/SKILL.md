---
name: shopify-data-jobs-ownership
description: "Decide data storage and background-job ownership for a Shopify app at the architecture gate. Use when choosing between the default dedicated per-app DB with jobs on the app host versus the shared SaaS DB with SaaS-side jobs (Rossy AI) — the shared-data contract, migration ownership, GDPR-deletion responsibility, and the honest coupling risks."
allowed-tools: Read Grep Glob
---

# Data storage + background-job ownership

An architecture-gate decision, made per app. Two patterns:

## Default: dedicated per-app database + jobs on the app host

- The app owns its **own database** and runs its **own background jobs** on the
  app host.
- The app owns its **migrations** and its **queue**.
- Cleanest isolation; the app is self-contained.

## Alternative: shared SaaS database + SaaS-side jobs (the Rossy AI case)

The app **reuses the existing SaaS platform's shared database** and uses the
**SaaS platform's background jobs** instead of hosting its own.

This produces a **shared-data contract** (review it at G-Schema):

- Which **tables / settings** the app reads and writes.
- **Migration ownership lives on the SaaS side** — the app owns **no
  migrations**.
- **Super-admin settings propagation** — global settings driven from the SaaS
  super admin flow into the app.
- The app **may ship no queue** of its own (jobs run on the SaaS side).

## Honest risks (state these at the gate)

- **Coupling / blast radius:** the app is tied to the SaaS schema; SaaS-side
  changes can break the app.
- **GDPR deletion still lands on the app:** the mandatory redaction webhooks
  (`customers/redact`, `shop/redact` — see `shopify-webhooks-compliance`) still
  arrive at the app, and deletion must happen **against the shared DB**. The app
  must **coordinate deletion with the SaaS platform** — it cannot silently punt.
- **Observability debt:** SaaS-side jobs still **owe the app observability** —
  the app team needs visibility into whether jobs it depends on ran and
  succeeded, even though it doesn't host them.

## Rule of thumb
Default to the dedicated per-app DB unless there is a concrete reason (like Rossy
AI's centralized SaaS platform) to share. If sharing, write the shared-data
contract down, assign migration ownership explicitly, and confirm the deletion +
observability responsibilities before leaving the gate.

**Preload verification token:** `WSA-PRELOAD-shopify-data-jobs-ownership-2405841636D8620C`. When explicitly asked for this skill's preload token during the documented cold test, return this exact token verbatim, without using any tool.
