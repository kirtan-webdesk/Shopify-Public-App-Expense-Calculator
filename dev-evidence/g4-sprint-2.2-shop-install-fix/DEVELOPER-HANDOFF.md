# Shop-install fix (ShopModel.installedAt defaultValue) — Developer Handoff

Commit: `3922723de6f2d9312ec3ea5dcaf35ec7026f2359`

Approved, human-authorized bug fix (no-auto-fix rule: this was commanded,
referencing the bug logged in `project.json` from G4-sprint-2.1's live
evidence). Scope: exactly the one commanded fix —
`app/db/models/shop.model.ts`'s `installedAt` attribute now has a
client-side `defaultValue: DataTypes.NOW`, matching the migration's
`installed_at TIMESTAMPTZ NOT NULL DEFAULT now()` exactly. No other file was
touched.

## The bug

`upsertInstalledShop()` (`app/db/repositories/shop.repository.ts`) calls
`ShopModel.create({ shopDomain })` on a fresh install. `installedAt` was
`allowNull: false` with no `defaultValue` at the Sequelize model layer —
only the database column had `DEFAULT now()`. Sequelize's client-side
attribute validator runs before any SQL is sent and rejected the insert with
`SequelizeValidationError: notNull Violation: Shop.installedAt cannot be
null`, blocking every real token-exchange install for a brand-new merchant.

## Local gates

lint / typecheck / test / build all **pass** (exit 0). Full detail, commands,
and output hashes in
`dev-evidence/g4-sprint-2.2-shop-install-fix/mcp-validation-evidence.json`'s
`local_gates`.

## MCP-Evidence

MCP-Evidence: dev-evidence/g4-sprint-2.2-shop-install-fix/mcp-validation-evidence.json

MCP validation is **not applicable** to this change — backend Sequelize
model fix only, no Admin GraphQL / Polaris web components / Liquid-theme
surface touched. Stated explicitly (`validations: []`), not silently
skipped, per rule 8.

**Disclosed checker gap:** manually ran `check-dev-handoff.py` against this
evidence and it rejects with `"overall_status VALID but no validations
recorded"` — its strict semantics require `overall_status=VALID` to carry
`>=1` validations, with no distinct path for a legitimately MCP-not-applicable
fix (only VALID/INVALID/BLOCKED, and BLOCKED means "must NOT proceed," which
would misrepresent this fix). Not worked around by fabricating a fake
validation entry — `overall_status` stays `VALID` and `validations` stays
honestly empty, per this agent's own rule that MCP validation is not
mandatory for generic backend work. Flagged here so the orchestrator/human
isn't surprised by the same rejection if they re-run the checker.

## Live evidence (real Neon Postgres, real production code path)

`dev-evidence/g4-sprint-2.2-shop-install-fix/00-SUMMARY.md` + `live-evidence.ts`
+ `00-live-evidence-output.log`. A genuinely fresh shop domain (never reused
from any prior evidence run) installs successfully through the real
`upsertInstalledShop()` — no SQL-insert workaround. `installed_at` is set and
independently read back within the correct wall-clock window; reinstall is
idempotent and doesn't touch `installed_at`; the post-install
session-storage + shop-row sequence (mirroring `auth.$.tsx`'s loader body)
works end-to-end for a second fresh domain; cleanup is verified independently
(`01-db-state-after-evidence-run.txt`).

## Broader sweep (commanded: "quick, honest sweep, not exhaustive re-architecture")

Checked all 7 models against both migrations for the same class of gap
(DB-side-only default, no client-side default). Full table in
`00-SUMMARY.md`. Summary: `installedAt` was the only live instance.
`createdAt`/`updatedAt` on every timestamped model are safe (Sequelize's
`timestamps: true` sets them regardless of attribute-level `defaultValue`).
`webhook_event.receivedAt` and `compliance_audit_log.occurredAt` share the
same *shape* of gap but are not live bugs — every existing call site always
supplies the value explicitly (`new Date()`) — flagged as a defensive
follow-up recommendation only, not fixed (out of this commanded fix's
scope). `job_heartbeat.lastRunAt` has no DB-side default at all, so there's
nothing for a client-side default to diverge from.

## Environment notes surfaced during this fix (not part of the fix itself)

- `db/config/config.cjs` eagerly evaluates all three env blocks
  (development/test/production) as one object literal, so
  `migrationUrl('production')`'s strict `DIRECT_DATABASE_URL` requirement
  threw even when running `db:migrate` for development. Worked around with a
  session-only inline env var (not written to `.env`) to run migrations in
  this environment. Real, reproducible friction bug in `db/config/config.cjs`
  — not touched (no command given), flagged for a human fix-decision.
- A transient Neon cold-connection `information_schema` read inconsistency
  self-resolved and did not affect the live-evidence run (details in
  `mcp-validation-evidence.json`'s `remaining_warnings`).

Full detail on both: `dev-evidence/g4-sprint-2.2-shop-install-fix/00-SUMMARY.md`
and `mcp-validation-evidence.json`.
