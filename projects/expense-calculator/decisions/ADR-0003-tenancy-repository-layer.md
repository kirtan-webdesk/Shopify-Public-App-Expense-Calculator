# ADR-0003 — Enforce per-shop tenancy in a repository layer, not at call sites

| | |
|---|---|
| **Status** | PROPOSED — pending G1.5 approval (Tech lead). Not self-approved. |
| **Date** | 2026-09-17 |
| **Gate** | G1.5 |
| **Related** | spec.md §9 ("enforced centrally, not per call-site"), D12, ADR-0008 |

---

## Context

Every row belongs to exactly one installing shop. A cross-shop read is an
app-review failure and a data-protection incident, and it is the single most
common way a multi-tenant Shopify app leaks. spec.md §12 assigned the "tenancy
enforcement pattern" to this gate.

The app has no customer PII, which lowers the severity of a leak but does not
change its nature: a merchant's cost structure and margins are commercially
sensitive.

## Decision

**A repository layer is the only place Sequelize models are touched, and every
repository function takes a `ShopContext` as its first parameter.** The
`shop_id` predicate is applied inside the repository; no call site outside it can
construct a query without one.

Concretely:

1. `app/db/repositories/*` is the only module group permitted to import from
   `app/db/models/*`. Routes and services import repositories.
2. Every repository function signature starts with a `ShopContext` derived from
   the authenticated session (`authenticate.admin`) or, on a webhook path, from
   the verified webhook `shop`. It is never a plain string pulled from a request
   parameter, a query string, or a form field.
3. `shop_id` is denormalised onto **every** tenant table — including
   `calculation_line_item` — rather than reached through a join (see the G-Schema
   handoff in the architecture packet §8.3). This makes the predicate uniform and
   the fitness tests mechanically enumerable.
4. Negative tests are a deliverable, not a nicety: for each tenant entity, a test
   proves shop A cannot read, update, or delete shop B's rows (D12, S1.2 AC).

## Alternative considered: PostgreSQL Row-Level Security

Genuinely stronger — RLS enforces isolation in the database, below any
application bug, and would survive a careless raw query. Rejected for V1 on three
grounds: it requires a per-request `SET LOCAL app.current_shop`, which is
fragile under connection pooling and easy to get subtly wrong; Sequelize has no
first-class support, so it becomes hand-managed SQL in a hook; and it is
materially harder to test and debug for a team whose standard is Sequelize
repositories. The cost of that rejection is honest: a raw-SQL escape hatch or a
repository bug is not caught by the database. FT-02's negative tests and FT-01's
import ban are what stand in for it.

**Alternative also considered: a global Sequelize `defaultScope` / beforeFind
hook** applying `shop_id` automatically. Rejected because it makes the predicate
invisible — a developer reading a query cannot see that it is scoped, and
`unscoped()` silently disables it. Explicit-and-mandatory beats
implicit-and-bypassable.

## Consequences

- **Accepted cost: boilerplate.** Every read goes through a repository function
  even for trivial queries; no ad-hoc `Model.findAll()` in a loader. This is the
  price of having exactly one choke point, and it is cheap at this app's size.
- **Accepted cost: the database will not save us.** An unreviewed raw query
  bypasses everything. Mitigation is FT-01 (import ban) plus a raw-SQL ban outside
  migrations.
- Enables uniform GDPR deletion (ADR-0008) and makes FT-08's table enumeration
  meaningful: any tenant table without `shop_id` is visible as a violation.
- Makes the history read path structurally provable — the history repository
  simply does not import the rule model, which is half of FT-14.
- **Revisit trigger:** if the app ever stores customer-identified data or
  protected-scope data, re-open the RLS decision at that gate. At that point the
  defence-in-depth is worth the operational cost.

## Enforcement

| Mechanism | What it catches |
|---|---|
| **FT-01** dependency-cruiser + eslint-plugin-boundaries: `routes/` and `services/` may not import `db/models/`; only `db/repositories/` may | The layering collapsing under deadline pressure |
| **FT-02a** custom check: `findAll(` / `findOne(` / `.query(` / `.destroy(` outside `db/repositories/` fails CI | The choke point being bypassed with a "just this once" query |
| **FT-02b** vitest integration, seeded two-shop database: for every tenant entity, shop A reading/updating/deleting shop B's row fails | The predicate being wrong rather than absent |
| **FT-02c** schema check: every table in the tenant-table list has a `shop_id` column and an index on it | A new table added without a tenancy key |
| Gated at **G5** per milestone, and run on every PR | |
