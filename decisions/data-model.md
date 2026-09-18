# G-Schema Data Model — expense-calculator

| | |
|---|---|
| **Gate** | G-Schema (schema-approval, project.json v7) |
| **Status** | **DRAFT — for Tech lead review. No migration has been run against any database. Not self-approved.** |
| **Author** | shopify-developer agent, 2026-09-18 |
| **Approver** | Tech lead (role — named approver TBD, OQ-7 open; project stakeholder in the interim) |
| **Inputs** | `project.json` v7 · `spec.md` §9 (draft data model) · `decisions/architecture-packet.md` §8 (G-Schema handoff) · ADR-0002, ADR-0003, ADR-0005, ADR-0007, ADR-0008 · `decisions/fitness-test-plan.md` (FT-02, FT-08, FT-13e, FT-14, FT-17, FT-20) |
| **Companion files** | `decisions/migrations/00000000000001-initial-schema.js` (DRAFT/UNAPPLIED Sequelize migration, up/down) |
| **Rule enforced** | No migration runs before G-Schema is approved. This document and the migration file are inputs to that approval, not evidence that it happened. |

This document does not scaffold the app (no `npm create @shopify/app`, no project
skeleton) — that is G3, which has not happened yet. It is the schema-design
deliverable for the open G-Schema gate.

---

## 1. Table list (one line each)

| Table | Purpose | Tenant-scoped (`shop_id`)? |
|---|---|---|
| `shop` | Root tenant record: shop domain, install/uninstall lifecycle timestamps | is the tenant root — no `shop_id` column on itself |
| `expense_rule` | Per-shop configured rule (percentage / fixed / formula) for one of the 10 fixed categories | Yes |
| `calculation` | A saved calculation: revenue input, computed totals, currency, engine version | Yes |
| `calculation_line_item` | Per-category computed result for a calculation, **plus the snapshotted rule as applied** (no FK to `expense_rule`) | Yes |
| `webhook_event` | Durable inbox for the four webhook deliveries (ADR-0002): dedup, claim, retry | Yes |
| `compliance_audit_log` | GDPR/compliance evidence that a redaction or no-op decision happened — **deliberately not tenant-scoped**, see §5 | **No** (by design — must survive shop deletion) |
| `shopify_sessions` | Shopify session storage | **Not ours** — library-managed by `@shopify/shopify-app-session-storage-postgresql`, no app columns, no app migration (see §7) |
| `job_heartbeat` | Dead-man's-switch for the serverless cron tick (ADR-0009 D6, G1.5-revision) — one row per named job, overwritten on every run | **No** (global operational table, same documented exception class as `compliance_audit_log` — see §4.7) |

`ExpenseCategory` is **not a table** — see §2. There is no `ExpenseFormula` table
either, for the same reasoning.

---

## 2. `ExpenseCategory`: code constant, not a table — recommendation

The architecture packet (§8.2) flagged this as a live question and leaned toward
a code constant. I evaluated both and agree with that lean.

### Option A — a table (`expense_category`, global, app-seeded)

- Pro: category metadata (label, sort order, allowed rule types) is queryable
  and joinable; a future admin tool could edit labels without a deploy.
- Con: it is a **global** table with no `shop_id` — the one table in the schema
  that structurally cannot carry a tenancy key, which breaks the uniform
  "every tenant table has `shop_id`" invariant FT-02c and FT-08 rely on
  (nothing wrong with a global table existing, but every engineer reading
  `information_schema` output has to remember it's the one exception).
- Con: it needs a seed migration, and reseeding a fixed 10-row table across
  environments (dev / CI / staging / prod) is exactly the kind of thing that
  drifts — a category added in dev with a different `id` than prod turns "stable
  string key" into "stable string key, as long as the seed ran correctly."
- Con: A4 (confirmed: 10 categories are fixed, app-seeded, merchants cannot
  create categories) means the category set is a **product decision**, not
  **tenant data**. There is no per-shop customization of the category list
  itself (only of the *rule* attached to a category). A table implies rows
  that get created/updated/deleted through normal CRUD; nothing here does that.
  A table also raises a real question nobody wants: is `shop/redact` allowed
  to delete `expense_category` rows? No — they're global, not this shop's data
  — so it becomes the "don't delete this global row" special case the
  architecture packet flagged, sitting awkwardly next to a redaction sweep that
  is designed to delete everything belonging to a shop.

### Option B — a code constant (recommended)

A single TypeScript module (e.g. `app/domain/expense-categories.ts`) exporting
a frozen array/map of the 10 categories:

```ts
export const EXPENSE_CATEGORIES = [
  { key: 'cost_of_goods',        label: 'Cost of Goods',      sortOrder: 0 },
  { key: 'marketing',            label: 'Marketing',          sortOrder: 1 },
  { key: 'platform_fees',        label: 'Platform Fees',      sortOrder: 2 },
  { key: 'payment_processing',   label: 'Payment Processing', sortOrder: 3 },
  { key: 'shipping',             label: 'Shipping',           sortOrder: 4 },
  { key: 'apps_software',        label: 'Apps/Software',      sortOrder: 5 },
  { key: 'payroll',              label: 'Payroll',            sortOrder: 6 },
  { key: 'overhead',             label: 'Overhead',           sortOrder: 7 },
  { key: 'taxes',                label: 'Taxes',              sortOrder: 8 },
  { key: 'misc',                 label: 'Misc',               sortOrder: 9 },
] as const;
```

- `category_key` is guaranteed stable **by construction** — there is no id to
  renumber, no seed to rerun, no environment drift possible.
- No seed migration, no "did the seed run" class of bug, no
  what-does-redaction-do-to-this-row question.
- The fixed set (A4) is enforced in two independent places instead of one: the
  TS constant (compile-time) and a DB `CHECK (category_key IN (...))`
  constraint on `expense_rule` and `calculation_line_item` (runtime,
  belt-and-suspenders — catches a bad key from a bug or a manual DB edit even
  though the app should never generate one).
- Cost, honestly stated: if the product ever needs merchant-visible category
  metadata edits, or localized labels, or more than 10 categories, this becomes
  a real table at that point — a migration, not a redesign. That is explicitly
  out of scope for V1 (A4), so the cost is deferred, not eliminated.

**Recommendation: Option B.** Ship it as a code constant. The DB-level `CHECK`
constraints on `category_key` columns are the schema's stake in the ground —
if the category set ever needs to change, that CHECK constraint is the reminder
that it's a migration, not a config edit, keeping the "merchants cannot create
categories" boundary honest at the database layer too.

**Formula rules get the identical treatment for the identical reason.** D6 /
A3 confirm formula-based rules are drawn from **a fixed, app-defined set**, not
user-authored. `formula_key` is a `TEXT` column validated against a code
constant (`app/domain/expense-formulas.ts`), the same way `category_key` is.
I did **not** add a DB `CHECK` constraint enumerating formula keys the way I
did for category keys, because OQ-4 (default rates/values) is still open and
the exact formula set is not yet finalized — spec.md explicitly says D13 is
"unbuildable" without that sign-off. Locking a `CHECK (formula_key IN (...))`
list now would mean amending this migration (or issuing a follow-up one)
before M2 can even start. The application-level enum is the safety net until
the set is confirmed; a `CHECK` constraint can be added in a follow-up
migration once OQ-4 closes, with no data-shape change required.

---

## 3. Entity-relationship map (text)

```
shop (root tenant)
 │  id UUID PK · shop_domain UNIQUE · installed_at · uninstalled_at (nullable)
 │
 ├──1:N──> expense_rule            (expense_rule.shop_id → shop.id, ON DELETE CASCADE)
 │
 ├──1:N──> calculation             (calculation.shop_id → shop.id, ON DELETE CASCADE)
 │           │
 │           └──1:N──> calculation_line_item
 │                        (calculation_line_item.calculation_id → calculation.id, ON DELETE CASCADE)
 │                        (calculation_line_item.shop_id → shop.id, ON DELETE CASCADE — denormalized,
 │                         redundant with the calculation_id path, kept per architecture packet §8.3)
 │
 └──1:N──> webhook_event           (webhook_event.shop_id → shop.id, ON DELETE CASCADE)

calculation_line_item ──X──> expense_rule     NO FK. category_key / rule_type_at_save /
                                                rate_basis_points_at_save / fixed_amount_minor_at_save /
                                                formula_key_at_save / rule_snapshot (JSONB) are a
                                                value-copy taken at save time. See §4.

calculation_line_item ──X──> (no ExpenseCategory table)   category_key is a value against the
                                                             EXPENSE_CATEGORIES code constant (§2),
                                                             backed by a DB CHECK constraint, not a join.

compliance_audit_log             NO FK to shop, NO shop_id column at all — intentionally outside
                                    the shop's cascade graph. Keyed by shop_domain (plain text) +
                                    webhook_id. Must outlive the shop row it describes. See §5.

shopify_sessions                 Library-managed by @shopify/shopify-app-session-storage-postgresql.
                                    No FK from/to our tables (rule #10 — no app migration touches it).
                                    Correlated to a shop only via its own `shop` text column, read/written
                                    exclusively through the library's session-storage API. See §7.
```

---

## 4. Table-by-table schema

Types below are the Postgres types the migration creates; Sequelize model field
types are noted only where they'd otherwise be ambiguous (e.g. `BIGINT` ↔
JS `number`/`string` handling).

### 4.1 `shop`

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | `UUID` | PK, `DEFAULT gen_random_uuid()` | Tenant root key referenced by every child table |
| `shop_domain` | `TEXT` | `NOT NULL UNIQUE` | e.g. `foo.myshopify.com`; the natural external identity |
| `installed_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT now()` | Set at token-exchange install |
| `uninstalled_at` | `TIMESTAMPTZ` | `NULL` | **Constraint #9.** Null while installed; set by `app/uninstalled`; cleared on reinstall (ADR-0008 step 2); read by the 45-day sweeper |
| `created_at` / `updated_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT now()` | Standard Sequelize timestamps; `shop` is the one row that legitimately mutates (unlike calculations) |

Index: `idx_shop_uninstalled_at` — partial `WHERE uninstalled_at IS NOT NULL`,
serves both the sweeper's range scan and any "currently uninstalled shops"
operational query.

`shop` itself has **no `shop_id` column** — it is the tenant root, not a tenant
table, and is correctly excluded from the FT-02c/FT-08
"every table with a `shop_id` column" enumeration. Redaction deletes the `shop`
row directly by `id`, as the last step (§5), not through a `shop_id` predicate.

### 4.2 `expense_rule`

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | `UUID` | PK | |
| `shop_id` | `UUID` | `NOT NULL REFERENCES shop(id) ON DELETE CASCADE` | Tenancy (ADR-0003), redaction cascade |
| `category_key` | `TEXT` | `NOT NULL`, `CHECK (category_key IN (10 keys))` | Stable string key (constraint #2); DB-level backstop for A4's fixed set even though there's no `ExpenseCategory` table to FK to |
| `rule_type` | `TEXT` | `NOT NULL`, `CHECK IN ('percentage','fixed','formula')` | D6's three rule types |
| `rate_basis_points` | `INTEGER` | `NULL`, `CHECK (>= 0)` when set | Percentage rule value, integer basis points (e.g. 15.5% = 1550) — never a float (ADR-0005) |
| `fixed_amount_minor` | `BIGINT` | `NULL`, `CHECK (>= 0)` when set | Fixed rule value, integer minor units |
| `formula_key` | `TEXT` | `NULL` | Formula rule value — app-defined set (§2), validated in application code pending OQ-4 |
| `enabled` | `BOOLEAN` | `NOT NULL DEFAULT true` | S2.1: rules can be disabled per shop without deleting them |
| `created_at` / `updated_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT now()` | Mutable table — rules are edited in place; this is exactly the live config the snapshot protects history from |

Constraints:
- `uq_expense_rule_shop_category` — `UNIQUE (shop_id, category_key)`: one
  configured rule per category per shop, matching D6/S2.1 ("a rule ... can be
  created, updated, and disabled per shop" — singular per category, not a
  history of rule versions).
- `chk_expense_rule_value_shape` — exactly one of
  `rate_basis_points` / `fixed_amount_minor` / `formula_key` is non-null,
  matching `rule_type`. This is the DB enforcing "typed columns, not a
  same-shaped free-for-all" for the live config table, the same discipline
  the snapshot columns get on the line-item table.

Index: `idx_expense_rule_shop_id` (also the leading column of the unique
constraint, so this is close to free).

### 4.3 `calculation`

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | `UUID` | PK | |
| `shop_id` | `UUID` | `NOT NULL REFERENCES shop(id) ON DELETE CASCADE` | Tenancy, redaction cascade |
| `revenue_minor` | `BIGINT` | `NOT NULL CHECK (>= 0)` | Merchant-entered revenue input, integer minor units (ADR-0005) |
| `currency_code` | `TEXT` | `NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$')` | **Constraint #5** — currency stored per calculation, merchant-configured (ADR-0006), never inferred at render time |
| `total_expenses_minor` | `BIGINT` | `NOT NULL CHECK (>= 0)` | Sum of the calculation's line items — see reconciliation trigger in §4.4 |
| `net_amount_minor` | `BIGINT` | `NOT NULL` | `revenue_minor - total_expenses_minor`; deliberately **no** `>= 0` check — expenses can legitimately exceed revenue in a merchant's assumptions and the engine must not clamp or hide that |
| `engine_version` | `TEXT` | `NOT NULL` | **Constraint #4** — identifies which engine build produced this row; history renders stored values and never recomputes |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT now()` | The single timestamp for an append-only row — no `updated_at` (there is nothing to update) |

There is deliberately **no `label`/`name` column.** Spec D11 (history list +
detail) doesn't call for merchant-supplied naming, and I'm not inventing UI
surface at the schema gate. Flagged as an open question in §9 for the PM/
designer, not built.

Indexes: `idx_calculation_shop_id`; `idx_calculation_shop_created` on
`(shop_id, created_at DESC)` for the history-list query (D11), which is the
one query this table exists to serve efficiently.

Append-only enforcement: see §6.

### 4.4 `calculation_line_item`

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | `UUID` | PK | |
| `calculation_id` | `UUID` | `NOT NULL REFERENCES calculation(id) ON DELETE CASCADE` | Owning calculation |
| `shop_id` | `UUID` | `NOT NULL REFERENCES shop(id) ON DELETE CASCADE` | **Constraint #7** — denormalized even though it's reachable via `calculation_id`; this is what makes FT-02c/FT-08's `information_schema` enumeration and the tenancy predicate uniform across every tenant table, including this one |
| `category_key` | `TEXT` | `NOT NULL`, `CHECK IN (10 keys)` | Snapshot value, not a join key — see below |
| `category_label_at_save` | `TEXT` | `NOT NULL` | Display label **as it existed at save time** — renaming a category (should that ever happen) does not rewrite history |
| `rule_type_at_save` | `TEXT` | `NOT NULL CHECK IN ('percentage','fixed','formula')` | Snapshot of the rule shape applied |
| `rate_basis_points_at_save` | `INTEGER` | `NULL` | Snapshot value |
| `fixed_amount_minor_at_save` | `BIGINT` | `NULL` | Snapshot value |
| `formula_key_at_save` | `TEXT` | `NULL` | Snapshot value |
| `rule_snapshot` | `JSONB` | `NOT NULL` | Full audit copy of the rule as applied — the typed columns above are what history is *rendered from*; this blob is the audit record, additive per architecture packet §8.1 item 2, never the source of a query |
| `computed_amount_minor` | `BIGINT` | `NOT NULL CHECK (>= 0)` | This category's contribution to the total, already rounded (ADR-0005) |
| `sort_order` | `SMALLINT` | `NOT NULL` | **Snapshot of the category's display/tie-break order at save time**, for the same reason the label is snapshotted — ADR-0005's largest-remainder reconciliation breaks ties "by the fixed category order," and that order must be reproducible byte-for-byte on replay (FT-14a) even if the app's category ordering ever changes later |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT now()` | Matches the parent calculation's timestamp; no `updated_at` |

**Constraint #1, applied literally: no FK at all to `expense_rule`.** Not a
nullable "informational" one either. Every value that describes the rule as
applied is copied by value onto this row at save time. There is no `include:`
/ join path from a saved calculation back to `expense_rule` for the engine or
the history view to accidentally take.

`category_key` here is a **value**, not a reference — it carries the same
`CHECK IN (...)` constraint as `expense_rule.category_key` for the same
belt-and-suspenders reason (catch a bad key at the DB layer), but there is no
FK and no `ExpenseCategory` table to point at. Renaming or reordering
categories in the code constant does not touch this column or any row that
already has one.

Constraint: `uq_calc_line_item_calc_category` — `UNIQUE (calculation_id,
category_key)`: one line item per category per calculation.

Indexes: `idx_cli_shop_id`, `idx_cli_calculation_id`.

**Reconciliation defense-in-depth (ADR-0005 item 4).** The invariant
`sum(lineItems) === total` is primarily an engine-level guarantee (FT-13d), but
I added a deferred constraint trigger,
`assert_calculation_line_items_reconcile()`, that re-checks
`SUM(computed_amount_minor)` against the parent `calculation.total_expenses_minor`
at transaction commit. It fires after `INSERT`/`DELETE` on this table (not
`UPDATE` — that's already blocked, see §6). This is cheap, catches a bug the
engine's own assertion missed before it ever reaches history, and costs nothing
at this write volume (a handful of rows inserted once per calculation, in the
same transaction). If the team considers this redundant with FT-13d, it can be
dropped in review — it's additive, not load-bearing for correctness elsewhere
in the schema.

### 4.5 `webhook_event` (durable inbox — ADR-0002)

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | `UUID` | PK | |
| `webhook_id` | `TEXT` | `NOT NULL UNIQUE` | **Constraint #8.** The `X-Shopify-Webhook-Id` header value. This unique index **is** the dedup mechanism — a replayed delivery hits the constraint and is swallowed |
| `shop_id` | `UUID` | `NOT NULL REFERENCES shop(id) ON DELETE CASCADE` | Tenancy + the mechanism by which this table gets swept on redaction (§5) |
| `shop_domain` | `TEXT` | `NOT NULL` | Raw domain from the delivery, kept alongside `shop_id` for ops debugging of insert/lookup failures without a join — this is the one place I added a column beyond the minimum for operational reasons on a compliance-critical queue table |
| `topic` | `TEXT` | `NOT NULL CHECK IN (4 topics)` | `customers/data_request`, `customers/redact`, `shop/redact`, `app/uninstalled` |
| `payload` | `JSONB` | `NOT NULL` | Raw webhook body, for the handler to act on |
| `received_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT now()` | Ack timestamp; also the claim-query ordering column |
| `processed_at` | `TIMESTAMPTZ` | `NULL` | Set by the drain worker on success |
| `attempts` | `INTEGER` | `NOT NULL DEFAULT 0` | Bounded retry with backoff |
| `last_error` | `TEXT` | `NULL` | For alerting when `attempts` hits its cap |

Indexes: `idx_webhook_event_shop_id`; `idx_webhook_event_unprocessed` — a
partial index on `received_at` `WHERE processed_at IS NULL`, exactly matching
the drain worker's claim query (`SELECT ... FOR UPDATE SKIP LOCKED WHERE
processed_at IS NULL ORDER BY received_at`).

**`shop_id` is `NOT NULL`, not nullable.** All four webhook topics only ever
fire for a shop that has already completed install (the `shop` row is created
at token exchange, before any webhook subscription can deliver), so resolution
should always succeed. The edge case worth naming: a genuine **second, distinct**
`shop/redact` delivery (a new `webhook_id`, not a replay of one already in the
inbox) arriving after the shop row has already been hard-deleted by a first,
successful redaction. In that case there is no `shop.id` to attach an FK to.
**Resolution: the repository looks up the shop by domain before inserting.** If
no shop row exists, it does not insert an inbox row at all — it acks 2xx
immediately and writes a `compliance_audit_log` row with `outcome='no_op'`,
`reason='shop already redacted'` (§5). This keeps `shop_id NOT NULL` honest and
keeps the "every tenant table has `shop_id`" invariant literal, at the cost of
that one case being handled in the repository rather than by the inbox table
itself. This is a genuine judgment call, flagged for Tech lead review — the
alternative (nullable `shop_id`) is defensible too and is a one-line change if
preferred.

**Pruning strategy (constraint #8).** Processed rows are pruned by the same
in-process worker loop (ADR-0002/ADR-0008), batched, on a rolling window:
`DELETE FROM webhook_event WHERE processed_at IS NOT NULL AND processed_at <
now() - interval '30 days'`. 30 days is a starting recommendation (well past
any conceivable audit-debugging need for a queue table whose durable evidence
lives in `compliance_audit_log`, not here) — **verify at build** against
whatever operational retention preference the team settles on; it's a constant
in one place, matching the ADR-0008 pattern for the 45-day sweeper window.

### 4.6 `compliance_audit_log` — see §5 for the full reasoning

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | `UUID` | PK | |
| `shop_domain` | `TEXT` | `NOT NULL` | **Not an FK to `shop.id`.** Deliberately — see §5 |
| `webhook_id` | `TEXT` | `NOT NULL` | Correlates to the delivering `webhook_event` row (which may since have been pruned or cascaded away) |
| `topic` | `TEXT` | `NOT NULL CHECK IN (3 compliance topics)` | `customers/data_request`, `customers/redact`, `shop/redact` — `app/uninstalled` doesn't need an audit row, it isn't a GDPR action |
| `outcome` | `TEXT` | `NOT NULL CHECK IN ('completed','no_op')` | `completed` = real deletion/delivery happened; `no_op` = documented reason (ADR-0008 step 4) |
| `reason` | `TEXT` | `NULL` | Required in practice for `no_op` rows — the "this app holds no customer-identified data" statement G-Review will ask for |
| `deleted_row_counts` | `JSONB` | `NULL` | Per-table counts for `completed` `shop/redact` rows (§5) |
| `occurred_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT now()` | |

Constraint: `uq_compliance_audit_webhook_topic` — `UNIQUE (webhook_id, topic)`,
so a replayed delivery writes at most one audit row (FT-08b's "second delivery
is a safe no-op," extended to the audit trail itself).

Index: `idx_compliance_audit_shop_domain` (operational lookup only — this
table is explicitly excluded from the tenancy/redaction machinery, see §5).

---

## 4.7 `job_heartbeat` (added at G1.5-revision — ADR-0009 D6/§7)

| Column | Type | Constraints | Why |
|---|---|---|---|
| `job_name` | `TEXT` | PK | One row per named job — currently just `'cron_tick'` |
| `last_run_at` | `TIMESTAMPTZ` | `NOT NULL` | Overwritten every run (success or failure) — the entire signal `/healthz`'s `cronStale` boolean derives from |
| `last_result` | `TEXT` | `NOT NULL CHECK IN ('ok', 'error')` | |
| `last_error` | `TEXT` | `NULL` | Set only on `last_result = 'error'` |

Migration: `db/migrations/20260918130000-add-job-heartbeat.cjs`. Forward-only,
additive — no existing table touched.

**Deliberately NO `shop_id` column, same documented exception class as
`compliance_audit_log` (§5):** this is a global operational table, not
tenant data — one row describes the health of the cron mechanism itself, not
any shop. It is excluded from the tenant-table conventions the same way
`compliance_audit_log` is, for a related but distinct reason:
`compliance_audit_log` must survive shop deletion to remain evidence;
`job_heartbeat` was never about a shop in the first place. **This table must
be added to fitness-test-plan.md's FT-02c (non-tenant exemption list) and
FT-08 (redaction table-enumeration exclusion list)** — done in this same
change — or both checks would wrongly flag a table that correctly has no
`shop_id`.

Written by the cron tick (`app/routes/api.cron.tick.tsx`, ADR-0009 D3/D6) at
the end of every invocation via
`app/db/repositories/job-heartbeat.repository.ts` — the only file that
touches this table (ADR-0003 layering). Read only by `/healthz`
(`app/routes/healthz.tsx`), and only as a derived boolean — the raw row
(timestamp, error text) is never exposed in that route's response.

---

## 5. `compliance_audit_log` — why it has no `shop_id`, and why that's correct

Constraint #7 says `shop_id` denormalized onto **every tenant-scoped table**.
`compliance_audit_log` is not a tenant-scoped table — it is compliance
**evidence about** a tenant, and its entire reason to exist is to prove that a
redaction happened **after** the tenant's data (and the tenant's `shop` row
itself) is gone. If it carried a `shop_id` FK to `shop.id`, one of two bad
things would be true: either the FK would have to be `ON DELETE SET NULL`
(discarding the correlation at exactly the moment it matters most), or FT-08's
automated "enumerate every table with a `shop_id` column, assert zero rows for
that shop" sweep would **delete the very row that proves the deletion
happened** — turning the audit trail into something that erases itself on
success. Neither is acceptable, so the table is built to be structurally
outside that sweep: no column literally named `shop_id`, no FK to `shop`,
correlated only by the plain-text `shop_domain` and `webhook_id`. This is a
deliberate, load-bearing exception to constraint #7, not an oversight — flagged
explicitly here because it's exactly the kind of thing a table-enumerating
fitness test could otherwise "catch" as a false positive if someone later
renames a column without reading this section.

### Deletion topology (constraint #11)

On `shop/redact`, the redaction handler runs one transaction that:

1. Resolves the shop by domain; if no `shop` row exists, this is the
   already-redacted case (§4.5) — write a `no_op` audit row and stop.
2. Otherwise, deletes from each tenant table **explicitly**, in dependency
   order, capturing the affected row count from each statement:
   `calculation_line_item` → `calculation` → `expense_rule` → `webhook_event`
   (excluding the row currently being processed — see the ordering note
   below) → the session-storage library's `deleteSessions()` for the shop
   domain (its own count, from its own API, not our SQL) → finally `shop`
   itself (`DELETE FROM shop WHERE id = $1`).
3. Writes the `compliance_audit_log` row with `outcome='completed'` and
   `deleted_row_counts` (a small JSON object, one key per table, including the
   session count) as part of the **same transaction**, so the evidence and the
   deletion are atomic.

The `ON DELETE CASCADE` FKs on every child table remain in place as a
**structural safety net** — if a future table is added and a developer forgets
to wire it into the explicit delete list, the cascade from step 2's final
`shop` delete still removes it, and FT-08's `information_schema` enumeration
still catches the omission in CI. But the explicit per-table deletes with
captured counts are what the audit row is built from — this is the "assert
row counts, don't trust the cascade silently" instruction (constraint #11)
taken literally: the cascade is the backstop, not the mechanism the app
reports success from.

**Ordering note carried from ADR-0002's own consequence:** the redact handler
is executing from its own `webhook_event` row. Step 2 deletes
`webhook_event` rows for the shop **excluding the currently-executing row**,
and the worker marks that specific row `processed_at` immediately after the
transaction commits (mark-then-purge, per ADR-0002) rather than deleting it
mid-transaction. The next pruning pass removes it along with any other
processed rows on the normal 30-day cycle. This means, for one shop, exactly
one `webhook_event` row (the redact delivery itself) survives redaction for a
bounded window — documented here so it isn't mistaken for an FT-08 failure;
FT-08's assertion should be written to drain the worker (which marks
`processed_at`) but should **not** assume the row is physically deleted
immediately — only that it carries no undeleted *shop data*. **Flagging this
for QA/Tech-lead attention**: if FT-08 as specified expects zero
`webhook_event` rows too, the test and this ordering note are in tension, and
one of them should change at review rather than being silently reconciled by
whichever gets built first.

---

## 6. Append-only enforcement (constraint #6)

`calculation` and `calculation_line_item` have no application `UPDATE` path,
per architecture and per D11/FT-14c. The repository layer is the primary
enforcement point (no `update()` method exists on those repositories), but
per ADR-0003's own admission — "the database will not save us" from a raw
query bypassing the repository — I added a `BEFORE UPDATE` trigger on both
tables:

```sql
CREATE OR REPLACE FUNCTION prevent_row_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only; UPDATE is not permitted (id=%)',
    TG_TABLE_NAME, OLD.id;
END;
$$ LANGUAGE plpgsql;
```

attached to both tables. `DELETE` is **not** blocked — the redaction cascade
(§5) must still be able to remove these rows, and blocking `DELETE` would
break GDPR compliance to enforce an append-only guarantee that was never about
deletion in the first place. This directly satisfies FT-14c ("an UPDATE
against `calculation`/`calculation_line_item` is rejected") at the database
layer, independent of whether the repository boundary holds.

---

## 7. Session storage wiring note (deliverable 3)

- Session storage is `@shopify/shopify-app-session-storage-postgresql`
  (`PostgreSQLSessionStorage`), pointed at the same Postgres instance/database
  as the app's own Sequelize models (ADR-0007 — one dependency, no Redis).
- The `shopify_sessions` table (exact name/shape is whatever that library's
  own internal bootstrapping creates) is **entirely library-owned**. This
  migration set defines **no** app-authored table by that name, adds **no**
  columns to it, and creates **no** FK from any app table to it. That is
  constraint #10, applied literally: not "we'll be careful," but "there is no
  code path in this migration set that could touch it."
- All reads/writes against session state go through the `sessionStorage`
  instance's own API (`loadSession` / `storeSession` / `deleteSession` /
  `deleteSessions` / `findSessionsByShop`, exact method names per the
  installed library version — **verify at build**), called from
  `authenticate.admin` / `authenticate.webhook` internals or from the
  uninstall/redact handlers. No repository or service in this app queries
  `shopify_sessions` directly via Sequelize or raw SQL.
- **Important consequence for FT-08:** `shopify_sessions` almost certainly
  does **not** have a column literally named `shop_id` (session-storage
  libraries commonly use a `shop` text column holding the domain). That means
  FT-08's `information_schema`-driven "every table with a `shop_id` column"
  enumeration will **not** automatically include it. Session deletion on
  `app/uninstalled` (ADR-0007 step 5) and on `shop/redact` (§5 step 2, "its
  own count, from its own API") must therefore be an **explicit, separately
  asserted step** in both handlers — it is not swept for free by the generic
  cascade/enumeration pattern that covers every other table in this schema.
  I've called this out in §5's deletion topology; flagging it again here
  because it's the one place "library-managed" and "must still be provably
  deleted for GDPR" pull in slightly different directions, and it's easy to
  assume FT-08 covers it when it structurally can't.
- `future.expiringOfflineAccessTokens: true` and the 60-minute offline-token
  refresh are entirely the library's internal concern; nothing in this schema
  models it.

---

## 8. Money and rate columns — how ADR-0005 lands in the schema

| Requirement (ADR-0005) | Where it lands |
|---|---|
| Integer minor units everywhere, never a float column | Every money column is `BIGINT`: `revenue_minor`, `total_expenses_minor`, `net_amount_minor`, `fixed_amount_minor` (+ `_at_save`), `computed_amount_minor`. FT-13e (no `FLOAT`/`DOUBLE PRECISION`/`REAL` on a money/rate column) holds by construction — none exist in this schema |
| Rates as integer basis points, never a float | `rate_basis_points` (+ `_at_save`) is `INTEGER` |
| Currency carried alongside the amount, minor-unit exponent is currency-dependent | `calculation.currency_code`; the engine (not the schema) looks up the exponent per currency — the schema stores the raw integer minor-unit count regardless of exponent, which is correct: the column doesn't need to know if it's 100 or 1000 per major unit, only the engine's formatting layer does |
| Round half-away-from-zero, largest-remainder reconciliation, deterministic tie-break by fixed category order | Engine-level algorithm, not a schema construct — the schema's contribution is (a) `sort_order` snapshotted per line item so the tie-break order is reproducible on replay (§4.4), and (b) the deferred reconciliation trigger asserting `sum(lineItems) === total` at the database layer as well as in the engine (§4.4) |
| `BIGINT far beyond any plausible merchant revenue figure` | Confirmed — `BIGINT` max (~9.2×10¹⁸) has enormous headroom over any minor-unit revenue figure a merchant would plausibly enter |

---

## 9. Deviations, pushback, and open questions

**No deviation from the architect's 12 structural constraints.** Everything in
§8 of the architecture packet is implemented as specified: no FK from line
items to rules, `category_key` as a stable string, `engine_version` on
calculations, currency per calculation, append-only calculations,
`shop_id` denormalized onto every genuinely tenant-scoped table, the
`webhook_event` inbox with its dedup unique index, `shop.uninstalled_at`,
library-managed sessions untouched by app migrations, and `ON DELETE CASCADE`
plus an explicit counted-assertion step for redaction.

Three things are worth the Tech lead's explicit attention rather than being
silently decided by me:

1. **`compliance_audit_log` has no `shop_id` column, by design (§5).** This is
   the one table that looks like it violates constraint #7 at a glance and
   doesn't — it's compliance evidence, not tenant data, and it must
   structurally survive the tenant's deletion. Flagging it so it isn't
   "fixed" by a future PR that adds a `shop_id` column and breaks the thing
   this table exists for.
2. **`webhook_event.shop_id` is `NOT NULL`, with the repository skipping
   insertion (not the table allowing a null) for the "second delivery to an
   already-redacted shop" edge case (§4.5).** Reasonable to prefer nullable
   instead; I chose `NOT NULL` to keep the tenancy invariant uniform and
   literal, at the cost of pushing one edge case into application logic. Flag
   for review, not a hill to die on.
3. **A possible tension between FT-08 as currently worded and ADR-0002's own
   "delete-last or mark-then-purge" guidance for the executing inbox row
   (§5, ordering note).** I resolved it by having FT-08 (as I'd write it)
   assert "no shop data remains" rather than "zero `webhook_event` rows,"
   but the fitness-test plan's literal wording should be checked against this
   before M1 builds against it, so the test isn't written to fail on day one
   against a design the same architecture packet asked for.

**Not built, flagged instead of invented:** a `label`/`note` column on
`calculation` for merchant-facing history naming (§4.3). Spec doesn't call for
it; it's a plausible near-term UX want; adding it later is a trivial additive
migration (a new nullable column, no backfill, no append-only conflict) rather
than a structural change, so there's no cost to deferring it to a design
review instead of guessing now.

---

## 10. Verify-at-build items carried/added at this gate

| Item | Why | Carried from |
|---|---|---|
| Exact `shopify_sessions` schema and session-storage API method names for the installed library version | §7 wiring depends on it | New at this gate |
| `compliance_topics` / `[[webhooks.subscriptions]]` TOML shape for 2026-07 | Affects how `webhook_event.topic` values arrive | architecture packet §9 |
| Whether 30-day `webhook_event` pruning and 45-day `shop.uninstalled_at` sweeper windows are still right against 2026-07's documented delivery timings | §4.5, ADR-0008 | architecture packet §9 |
| Whether the hosting provider's managed Postgres allows `CREATE EXTENSION pgcrypto` (needed for `gen_random_uuid()`) | Migration prerequisite | New at this gate |
| Final formula-key set once OQ-4 closes, and whether to add the deferred `CHECK` constraint on `formula_key` at that point | §2 | New at this gate, tied to OQ-4 |

---

_This document and the companion migration file are DRAFT inputs to the open
G-Schema gate in `project.json`. Neither has been applied to any database.
Approval, like every other gate, belongs to a human (Tech lead) — this agent
does not self-approve._
