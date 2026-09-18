# G4-sprint-2.1 — M2 Configuration + M3 Engine — live evidence

Scope: `app/routes/app.calculator.tsx` and `app/routes/app.results.tsx` made
real (expense-rule CRUD, the deterministic calculation engine, and the
results view), replacing the M1 static shells. Run against a real Neon
Postgres instance (the same `DATABASE_URL` this dev environment already uses
— `.env`, gitignored, not committed).

## Files in this directory

- `live-evidence.ts` — the evidence script (run via `vite-node`, not part of
  the permanent `vitest` suite — see its header comment for why: CI has no
  `DATABASE_URL` secret, matching this project's established convention of
  keeping `tests/` DB-free).
- `00-live-evidence-output.log` — full captured stdout/stderr of the script
  run below (`EXIT:0`).
- `01-db-state-after-evidence-run.txt` — independent `information_schema` +
  row-count check confirming the script's own cleanup step left the database
  exactly as it found it (0 `shop` rows, 0 `expense_rule` rows).
- `gates/` — `npm run lint` / `typecheck` / `test` / `build` output, produced
  by `.claude/tools/scripts/run-gates.py` (or its documented manual-equivalent
  fallback if that script fails on this Windows environment, same disclosed
  substitution pattern as prior rounds).

## How to reproduce

```
npx vite-node -c vitest.config.ts dev-evidence/g4-sprint-2.1-m2-m3/live-evidence.ts
```

## What was proven live (not just unit-tested against fixtures)

1. **expense-rule repository CRUD is real**, against a real `expense_rule`
   table: a fresh shop has zero rows; `getOrSeedExpenseRules()` seeds the 10
   PLACEHOLDER defaults and they are independently re-readable via
   `listExpenseRulesForShop()` (§1); `saveExpenseRules()` (the same function
   the calculator's "Save" action calls) persists edits — a disabled
   category, a changed percentage, and a rule-type change to `formula` — and
   a fresh re-fetch from the database confirms all three (§2).
2. **The engine runs against rows read back from the database**, not just
   in-memory fixtures (§3a) — closing the gap between "the pure function is
   unit-tested" and "the whole path (DB row → engine input → result) works."
3. **Money/rounding correctness, specifically the case the task asked for**:
   revenue (`5,000,007` minor units) was chosen so it does **not** divide
   evenly across the configured basis-point rates. §3b confirms
   `sum(lineItems) === totalExpensesMinor` exactly (`2,761,004` both sides).
   §3c shows the *naive* per-category-rounded sum (excluding the formula
   category) would total `2,728,503` — after adding back the formula
   category's exact `32,500`, that's `2,761,003`, still **one minor unit
   short** of the engine's correctly-reconciled `2,761,004`. That missing
   unit is exactly the largest-remainder allocation (ADR-0005 item 4) doing
   real work, not an incidental match. Hand-verified arithmetic (in the
   developer handoff) traces the exact remainder values, the leftover count
   (2), and confirms the two winning categories (`marketing`, `taxes`) are
   the two with the largest fractional remainders — the tie-break-by-
   category-order logic is exercised separately in
   `tests/domain/expense-engine.test.ts`'s dedicated tie-break test.
4. **Determinism**: the same DB-sourced input run twice produces
   byte-identical JSON (§4).
5. **The Calculator → Results transport round-trips exactly** (§5) — the
   mechanism `app/domain/calculation-transport.ts` uses to hand a live,
   unsaved preview from the calculator's action to the results loader.
6. **Cleanup is real and verified independently** (§6, plus
   `01-db-state-after-evidence-run.txt`) — the script does not leave
   evidence-run residue in a shared dev database.

## NEW FINDING surfaced by this live run (NOT fixed, NOT authorized)

`app/db/repositories/shop.repository.ts`'s `upsertInstalledShop()` calls
`ShopModel.create({ shopDomain })` without setting `installedAt`.
`ShopModel.installedAt` (`app/db/models/shop.model.ts`) is `allowNull: false`
with **no `defaultValue`** at the Sequelize model layer — only the database
column has `DEFAULT now()`. Sequelize's client-side instance validator
checks `allowNull` **before** issuing SQL and has no knowledge of a DB-side
default, so creating a genuinely new shop domain (one with no existing row)
throws `SequelizeValidationError: notNull Violation: Shop.installedAt cannot
be null` and the insert never reaches the database.
`createdAt`/`updatedAt` are unaffected because Sequelize's own
`timestamps: true` machinery sets those two at the JS layer unconditionally
— `installedAt` is a separate, hand-authored "DB-defaulted" column
(ADR-0008 relies on it) that nothing populates at the JS layer.

This was found because `live-evidence.ts` seeds a **genuinely fresh**
random shop domain every run (`seedShopDirectlyBypassingTheKnownDefect()`,
see its header comment) — every prior live-evidence round in this project
appears to have exercised an **already-existing** or **directly-SQL-seeded**
shop row rather than the real token-exchange `upsertInstalledShop()` create
path for a brand-new domain, so this is plausibly a previously-undetected
defect, not a regression introduced this sprint (no file inside
`app/db/repositories/shop.repository.ts` or `app/db/models/shop.model.ts`
was touched by this sprint's diff — `git log -p` on those two files shows no
change in this commit).

**Not fixed** (no-auto-fix rule — this sprint was commanded for M2
Configuration + M3 Engine only). The evidence script works around it
**only within itself** (a direct SQL insert for the test shop row,
documented inline) — nothing in `app/db/*` was changed to accommodate this.
**This blocks every brand-new shop's real token-exchange install in
production** and should be treated as the next authorized bug-fix command,
same severity class as the BUG-1/2/4/5 chain found in G4-sprint-1.1.

## Why this does not block or invalidate the M2/M3 evidence above

No route in this sprint's scope creates a shop row. `app.calculator.tsx` and
`app.results.tsx` both resolve an **already-installed** shop's context via
`findShopContextByDomain(session.shop)` (existing M1 code, unchanged) — the
calculator/results flow has no dependency on `upsertInstalledShop()` at all.
The defect is real and urgent, but orthogonal to this sprint's deliverable.
