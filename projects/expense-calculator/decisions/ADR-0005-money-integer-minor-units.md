# ADR-0005 — Represent and compute money as integer minor units, with a documented rounding and remainder policy

| | |
|---|---|
| **Status** | PROPOSED — pending G1.5 approval (Tech lead). Not self-approved. |
| **Date** | 2026-09-17 |
| **Gate** | G1.5 |
| **Related** | D7 (determinism), S3.1 acceptance criteria, spec.md §12, ADR-0004, G-Schema |

---

## Context

D7 requires a **deterministic** engine: identical inputs plus identical config
produce identical output. S3.1 additionally requires that per-category figures
**reconcile to the revenue input**. spec.md §12 assigned the decimal/currency
precision approach to this gate.

The engine multiplies a revenue figure by percentage rules, adds fixed amounts,
and evaluates a fixed set of app-defined formulas. IEEE-754 floats make both
requirements unachievable: `0.1 + 0.2`, percentage chains that drift a cent, and
totals that don't add up are not edge cases in this app — they are the main path.

## Decision

**Money is an integer count of minor units (cents) everywhere: in the database,
in the engine, in the API/loader payloads, and in the snapshot. It is converted
to a display string exactly once, at the render boundary.**

1. **Type.** A branded TypeScript type (e.g. `type MinorUnits = number & { __brand:
   'MinorUnits' }`) so a raw `number` cannot be passed where money is expected.
   Persisted as `BIGINT` (G-Schema confirms).
2. **Rates.** Percentages are stored as integer **basis points** (or a fixed-scale
   `NUMERIC`), never as `0.155` floats. Fixed-amount rules are minor units.
   G-Schema picks the column type; the invariant is *no binary float column ever
   holds money or a rate*.
3. **Rounding.** One documented policy, applied in one shared helper, used by
   every rule type: **round half away from zero** at the point a category amount
   becomes a whole minor unit. It is documented in the engine module header and in
   the runbook, because "what rounding do you use" is a merchant-facing question.
4. **Reconciliation.** After rounding every category, the sum of categories is
   compared to the sum computed from unrounded intermediates; any residual minor
   units are allocated by the **largest-remainder method** to the categories with
   the largest fractional parts (ties broken by the fixed category order, so the
   result is deterministic). The invariant `sum(lineItems) === total` holds
   **exactly**, always, and is asserted in the engine, not just in tests.
5. **Purity.** The engine is a pure function: no I/O, no `Date.now()`, no
   `Math.random()`, no locale-dependent behaviour. An `engine_version` constant is
   stamped onto every saved calculation (see G-Schema handoff).
6. **Currency.** The currency code is carried alongside the amount and stored on
   the calculation. Minor-unit exponent is currency-dependent (most currencies
   are 2, some are 0 or 3) — the helper takes the exponent from the currency,
   it is not hard-coded to 100.

## Alternative considered: `NUMERIC`/`DECIMAL` in Postgres with `decimal.js` in the engine

A perfectly respectable choice — arbitrary precision, no minor-unit exponent
bookkeeping, and rounding is explicit in the library. Rejected because it adds a
dependency on the hottest path, makes every value a wrapped object that must be
serialised carefully across the loader boundary (a `Decimal` that becomes a string
that becomes a float is exactly the bug class we are eliminating), and because it
does **not** by itself solve reconciliation — you still need the largest-remainder
policy in item 4. Integer arithmetic gives determinism from the language itself,
with `BIGINT` far beyond any plausible merchant revenue figure.

The accepted cost of rejecting it: intermediate percentage maths must be done
carefully in integer space (multiply before divide, and keep the unrounded
intermediate for the remainder pass), and developers must remember the exponent
when reading raw DB values.

**Alternative also considered: floats with rounding at display time.** Rejected
outright — it fails D7 and S3.1 by construction.

## Consequences

- Determinism becomes a property of the type system and the arithmetic, not of
  test discipline.
- `sum(categories) === total` is guaranteed, so the chart and the table cannot
  disagree (ADR-0004) and a merchant cannot find a missing cent.
- **Accepted cost: conversion discipline.** Every input parse (merchant types
  "12,500.50") and every render must go through the shared helpers. This is the
  most likely place for a regression, which is why FT-13 bans the raw conversions
  rather than merely testing outputs.
- **Accepted cost: a schema migration if reversed.** This is a hard-to-reverse
  decision; that is exactly why it is being made before M3 rather than during it.
- Rounding policy becomes documentation, not folklore — it will be asked about.
- Directly constrains the G-Schema column types (`BIGINT` money, integer/NUMERIC
  rates, currency code, `engine_version`).

## Enforcement

| Mechanism | What it catches |
|---|---|
| **FT-13a** TypeScript branded `MinorUnits` type + `strict` mode | A raw number reaching a money parameter |
| **FT-13b** eslint `no-restricted-syntax`: `parseFloat`, `Number(` on money-named identifiers, and float literals in the engine module | Float creeping into the arithmetic path |
| **FT-13c** vitest golden-file determinism test: a fixed input matrix produces byte-identical JSON output across runs and across a process restart | Non-determinism from any source, including a library upgrade |
| **FT-13d** vitest property/invariant test: for randomised rule sets, `sum(lineItems) === total` exactly, and no category is negative | A reconciliation bug in the largest-remainder pass |
| **FT-13e** schema check: no `FLOAT`/`DOUBLE PRECISION`/`REAL` column on a money or rate field | The decision being lost at the database layer |
| Gated at **G5** (M3) | |
