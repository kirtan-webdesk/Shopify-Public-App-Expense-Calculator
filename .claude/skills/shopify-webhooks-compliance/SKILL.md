---
name: shopify-webhooks-compliance
description: "Implement Shopify's mandatory privacy/compliance webhooks. Use when handling customers/data_request, customers/redact, or shop/redact — HMAC verification (401 on failure), the 2xx timing/ack requirement, the 30-day action windows, delivery timing, the legal-retention exception, dedup, and toml config."
allowed-tools: Read Grep Glob
---

# Mandatory compliance (privacy) webhooks

Every public app must implement the **three mandatory privacy webhooks**:

- `customers/data_request`
- `customers/redact`
- `shop/redact`

Configure them in `shopify.app.toml` under **`compliance_topics`**.

## Universal requirements

- **Acknowledge with a 2xx quickly** — the delivery has a **1s connect / 5s
  total** timeout. Do the real work asynchronously; ack fast.
- **HMAC verification is MANDATORY.** Validate `X-Shopify-Hmac-SHA256` and
  **return 401 on an invalid HMAC** (use `authenticate.webhook` — see
  `shopify-app-auth-and-routes`).
- **Dedup** using `X-Shopify-Webhook-Id` (deliveries can repeat).

## Per-topic behavior

### `customers/data_request`
Deliver the requested data to the **store owner directly**, within the **30-day**
window. Async completion is the intended pattern (ack the webhook, then compile
and deliver).

### `customers/redact`
- Shopify sends it **10 days after** the request **if the customer has no order
  in the last 6 months**; if they do have a recent order, it is **withheld until
  6 months** have passed.
- Act within **30 days**.
- **Legal-retention exception (confirmed):** do NOT complete the redaction if you
  are **legally required to retain** the data.

### `shop/redact`
Shopify sends it **48 hours after** the app is uninstalled. Act within **30
days** (redact/delete that shop's data).

## WebDesk security policy (NOT a Shopify requirement)

Label this clearly as **WebDesk policy / best practice**, not an official Shopify
rule: **return an empty or minimal 2xx acknowledgment and never echo customer or
merchant PII in the response body.** Do not present the no-PII-in-response rule
as a Shopify requirement — it is a WebDesk hardening choice.

## App-review tie-in

These webhooks must **actually delete/deliver data** — a stub that 200s without
doing the work fails review. Pair with real deletion jobs (see
`shopify-data-jobs-ownership`).

**Preload verification token:** `WSA-PRELOAD-shopify-webhooks-compliance-3BE5344894CDC3CA`. When explicitly asked for this skill's preload token during the documented cold test, return this exact token verbatim, without using any tool.
