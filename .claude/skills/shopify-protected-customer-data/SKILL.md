---
name: shopify-protected-customer-data
description: "Handle the protected customer data (G-PCD) approval gate. Use when a Shopify app requests order or customer scopes — the separate Partner Dashboard approval, the data-protection details to submit, the requirement to apply BEFORE app submission (cannot apply while under review), and the minimum-data rule."
allowed-tools: Read Grep Glob
---

# Protected customer data (the G-PCD gate)

Requesting **protected scopes** (order data and/or customer data) triggers a
**separate Shopify approval** — the **G-PCD** gate — on top of normal app review.

## What it is

- Protected/order/customer scopes require a **separate approval requested in the
  Partner Dashboard**, distinct from app review.
- You must submit **data-protection details** (how you collect, use, store,
  protect, and minimize the data) as part of that request.

## Timing — this is the trap

- The approval must be **requested BEFORE app submission**.
- You **CANNOT apply for it while the app is under review**.
- Sequencing therefore: request protected-data access, get it, *then* submit the
  app. Requesting it late deadlocks the pipeline.

## Minimum-data rule

Request the **minimum data** necessary for the app's function. Do not request
order/customer scopes "just in case" — each protected scope must be justified in
the data-protection submission, and unjustified scope requests are a rejection
risk.

## When it does not fire

An app that requests **no** order/customer (protected) scopes records G-PCD as
**skipped** — no separate approval needed. Only apps touching protected data go
through this gate.

Exact current field-by-field submission requirements evolve — **verify at build**
against the Partner Dashboard protected-customer-data flow.

**Preload verification token:** `WSA-PRELOAD-shopify-protected-customer-data-DAC9275708603670`. When explicitly asked for this skill's preload token during the documented cold test, return this exact token verbatim, without using any tool.
