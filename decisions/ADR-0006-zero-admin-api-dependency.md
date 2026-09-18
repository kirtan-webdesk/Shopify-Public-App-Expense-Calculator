# ADR-0006 — No Admin GraphQL call on any core path; currency and locale are merchant-configured

| | |
|---|---|
| **Status** | PROPOSED — pending G1.5 approval (Tech lead). Not self-approved. |
| **Date** | 2026-09-17 |
| **Gate** | G1.5 |
| **Related** | spec.md §4.3, §14; A1; `scopes: []`; architecture packet §5.1 |

---

## Context

`scopes: []` and `protected_scopes: false` were confirmed and **locked** at G0.5.
Revenue is merchant-entered. Walking D1–D16 (architecture packet §5.1), the app
has **no functional need for an Admin GraphQL query at all** — the only candidate
in the entire scope is cosmetic shop metadata (`shop { currencyCode name
ianaTimezone }`) for display formatting.

But spec.md §14 carries an open verify-at-build: *whether reading those `shop`
fields requires an explicit access scope in 2026-07*. If it does, `scopes: []`
either breaks or the feature does. Leaving that unresolved until M1 means the
answer arrives as a surprise on the critical path.

## Decision

**The app makes no Admin GraphQL call on any core path. Display currency (symbol,
code, minor-unit exponent) and number/locale formatting are merchant-configured
in the app's own settings, seeded with a sensible default and editable by the
merchant.**

Consequently:

- Tenancy key, shop identity, and all authorisation come from the **session
  token / verified webhook**, which require no scope.
- `shopify.app.toml` declares **no access scopes**. `scopes: []` is an
  architectural invariant, not an aspiration.
- If a future feature genuinely needs Shopify data, CI breaks (FT-11) and it
  arrives as an **RFC**, with the protected-scope consequences of spec.md §4.3
  evaluated deliberately.

## Alternative considered: query `shop` once per session for currency and name

The nicer merchant experience — zero configuration, always correct, and it
survives a merchant changing their store currency. Rejected because it buys a
cosmetic convenience with a **structural dependency**: an Admin API client on the
session path, a failure mode when that call throttles or errors, a caching
question, and — if 2026-07 requires a scope for those fields — the loss of the
cleanest property this app has, `scopes: []`, which is itself a meaningful
app-review asset and the reason G-PCD is skipped.

The cost of rejecting it is honest and small: **the merchant sets their currency
once**, and if they change store currency the app does not follow automatically.
For a calculator over merchant-entered assumptions — where the merchant is
already typing every number — a currency selector is consistent with the product,
not a wart.

**Fallback position, if approval prefers the nicer UX:** query `shop` behind a
feature flag, cache it on the `shop` row at install, treat a failure as
non-fatal and fall back to the merchant setting, and — only if 2026-07 requires
it — add the **minimum non-protected** scope via an RFC. The default stands as
written; this fallback is documented so the choice is visible, not so it is taken
by default.

## Consequences

- **The Admin GraphQL cost/rate-limit question disappears structurally**, not by
  assumption: no bulk operations, no pagination, no `extensions.cost` inspection,
  no throttle/backoff layer, no cost budget to defend. This is the evidence behind
  architecture packet §5.1.
- **API-version exposure collapses.** The 2026-07 pin (A8) carries almost no
  risk, because the app barely touches a versioned surface. A future quarterly
  bump is a library upgrade, not a query audit.
- **Accepted cost: a settings field and a small seed.** Plus a currency selector
  in the M2 configuration UI (already the milestone that builds configuration).
- **Accepted cost: drift.** A merchant who changes store currency will see a
  stale currency until they update the setting. Acceptable; it does not affect any
  computed value, only the symbol and exponent.
- REST remains prohibited regardless (Req 2.2.4) and is enforced separately
  (FT-10) so it cannot creep in via a "GraphQL doesn't have this endpoint"
  argument.

## Enforcement

| Mechanism | What it catches |
|---|---|
| **FT-11a** custom CI check: `shopify.app.toml` declares no access scopes, and the `SCOPES` env in deployment config is empty | Scope creep at the config layer, where nobody reviews it |
| **FT-11b** custom CI check: zero `admin.graphql(` call sites outside an allowlist file (currently **empty**) | A "quick" Admin call being added without an RFC |
| **FT-10** eslint `no-restricted-syntax` / custom grep: no `admin.rest`, no `/admin/api/*.json` | REST usage (Req 2.2.4) |
| **FT-11c** custom check: `ApiVersion.July26` is the only version constant referenced | A silent version bump (A8) |
| Gated at **G5**, run on every PR | |

**Verify-at-build (kept open, now non-blocking):** whether `shop { currencyCode
name ianaTimezone }` requires an access scope in 2026-07. This ADR makes the
answer informational rather than blocking.
