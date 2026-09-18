# Shop-install fix (ShopModel.installedAt defaultValue) — live evidence

Approved, human-authorized fix. Bug: found live in G4-sprint-2.1's evidence
run (`dev-evidence/g4-sprint-2.1-m2-m3/00-SUMMARY.md`), logged in
`project.json`. `app/db/repositories/shop.repository.ts`'s
`upsertInstalledShop()` could not create a brand-new shop row:
`ShopModel.installedAt` (`app/db/models/shop.model.ts`) had no client-side
`defaultValue` — only the database column had `DEFAULT now()` — so
Sequelize's own client-side attribute validator rejected the insert before
any SQL reached Postgres. This blocked every real token-exchange install for
a new merchant.

## Fix commit

**SHA (full):** `3922723de6f2d9312ec3ea5dcaf35ec7026f2359`
**SHA (short):** `3922723`
**Parent commit:** `967c3a19dc9211bf34ac9d64b19359dd5d2e1eba` (M2/M3 evidence)

Only file changed: `app/db/models/shop.model.ts` — added
`defaultValue: DataTypes.NOW` to the `installedAt` attribute.

| file | SHA-256 of file content at commit `3922723` |
|---|---|
| `app/db/models/shop.model.ts` | `ddd198948c6e5fcee3f8f9d5d8d276b49a580c22ca83efaeca89a12cccaf673a` |

(Reproduce with `git show 3922723de6f2d9312ec3ea5dcaf35ec7026f2359:app/db/models/shop.model.ts | sha256sum`.)

## Migration DDL checked before writing the fix

`db/migrations/20260918120000-initial-schema.cjs`, `shop` table:

```sql
CREATE TABLE shop (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_domain    TEXT NOT NULL,
  installed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  uninstalled_at TIMESTAMPTZ NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_shop_domain UNIQUE (shop_domain)
);
```

`installed_at`'s DB-side default is exactly `now()`. The fix uses
`DataTypes.NOW`, which Sequelize compiles to SQL `NOW()` for the postgres
dialect — the same expression, not a second, slightly-different definition
of "now" (e.g. not a JS `new Date()` default computed at model-definition
time, which would be wrong — it would be fixed at process-boot time, not
per-insert).

## Files in this directory

- `live-evidence.ts` — the evidence script (run via `vite-node`, not part of
  the permanent `vitest` suite — same established convention as every other
  `dev-evidence/*/live-evidence.ts` in this repo: DB integration is
  deliberately kept out of CI, no `DATABASE_URL` secret there).
- `00-live-evidence-output.log` — full captured stdout of the script run
  below (`EXIT:0`).
- `01-db-state-after-evidence-run.txt` — independent follow-up query
  confirming the script's own cleanup left the database exactly as found (0
  matching `shop` rows, 0 matching `shopify_sessions` rows).
- `gates/` — `npm run lint` / `typecheck` / `test` / `build` output, manual
  equivalent of `run-gates.py` (see `remaining_warnings` in
  `mcp-validation-evidence.json` for why the script itself still fails on
  this Windows environment — same disclosed gap since G4-sprint-1.1).
- `mcp-validation-evidence.json` — structured evidence artifact (schema
  `mcp-validation-evidence.schema.json`). `validations: []` — MCP validation
  is **not applicable** to this change (backend Sequelize model fix only, no
  GraphQL/Polaris/Liquid surface), stated explicitly rather than skipped
  silently.

## How to reproduce

```
npx vite-node -c vitest.config.ts dev-evidence/g4-sprint-2.2-shop-install-fix/live-evidence.ts
```

## What was proven live (real Neon Postgres, real production code path)

1. **A genuinely fresh shop domain** (`randomUUID()` per run, never reused
   from any prior evidence run in this repo — the exact property whose
   absence let the original defect go undetected for three prior rounds)
   installs successfully through the REAL `upsertInstalledShop()` function —
   no SQL-insert workaround, unlike the prior sprint's evidence script, which
   had to bypass this exact defect (`seedShopDirectlyBypassingTheKnownDefect`,
   `dev-evidence/g4-sprint-2.1-m2-m3/live-evidence.ts`).
2. **`installed_at` is set correctly**: an independent read-back query
   (separate from the `create()` call's own return value) confirms a non-null
   timestamp within the actual wall-clock window of the call (§2, §2a).
3. **Idempotent reinstall** (ADR-0008 step 2): calling `upsertInstalledShop()`
   again for the same domain does not create a duplicate row and does not
   change `installed_at` (§3).
4. **Whatever normally happens right after install**: `auth.$.tsx`'s loader
   body is `authenticate.admin(request)` (library-owned token exchange, which
   internally calls `sessionStorage.storeSession()`) followed by
   `upsertInstalledShop(session.shop)`. A real `authenticate.admin()` call
   needs a live Shopify session-token JWT this sandbox cannot fabricate, so
   §4 exercises the identical `sessionStorageInstance`
   (`app/shopify.server.ts`, the same `PostgreSQLSessionStorage` instance the
   real app uses) directly with a realistic offline `Session`, for a SECOND
   fresh domain, then calls the real `upsertInstalledShop()` — confirming
   both the `shopify_sessions` row and the `shop` row exist afterward and
   agree on the shop domain (§4a–4c).
5. **Cleanup is real and independently verified** — both seeded domains'
   rows (shop + session) are deleted at the end of the script, and a
   follow-up count query (both inline, §5, and in the separate
   `01-db-state-after-evidence-run.txt` file) confirms zero residue.

## Broader sweep: same class of gap (DB-side-only default, no client-side default)

Checked every model in `app/db/models/` against
`db/migrations/20260918120000-initial-schema.cjs` and
`db/migrations/20260918130000-add-job-heartbeat.cjs`:

| Model.attribute | DB-side default | Client-side `defaultValue`? | Safe? Why |
|---|---|---|---|
| `shop.installedAt` | `now()` | **was missing — FIXED** | now `DataTypes.NOW` |
| `shop.createdAt` / `updatedAt` | `now()` | none set explicitly | **Safe** — Sequelize's own `timestamps: true` machinery sets `createdAt`/`updatedAt` at the JS layer unconditionally on every `create()`/`save()`, independent of the attribute's own `defaultValue`. Same for `expense_rule.createdAt`/`updatedAt`. |
| `expense_rule.enabled` | `true` | `defaultValue: true` | Already correct. |
| `webhook_event.attempts` | `0` | `defaultValue: 0` | Already correct. |
| `webhook_event.receivedAt` | `now()` | none set | **Safe in practice, not by a client-side default** — `webhook-event.repository.ts` always passes `receivedAt: new Date()` explicitly at `create()` time (verified: `app/db/repositories/webhook-event.repository.ts:37`), so the missing `defaultValue` is never actually relied upon. Still a latent gap: if any future call site ever calls `WebhookEventModel.create()` without `receivedAt`, it will hit the identical class of defect `installedAt` just had. Recommend adding `defaultValue: DataTypes.NOW` defensively in a follow-up round — not done here, out of this fix's commanded scope. |
| `compliance_audit_log.occurredAt` | `now()` | none set | Same situation as `receivedAt` — `compliance-audit-log.repository.ts` always passes `occurredAt: new Date()` explicitly (verified: `app/db/repositories/compliance-audit-log.repository.ts:42`). Same latent-gap recommendation as above. |
| `job_heartbeat.lastRunAt` | none (plain `NOT NULL`, no DB default) | none set | **Safe** — no DB-side default exists to silently diverge from; `job-heartbeat.repository.ts`'s `recordHeartbeat()` always passes `lastRunAt: now` explicitly, and there being no DB default means there's nothing for a client-side default to "match" in the first place. |

**Conclusion**: `installedAt` was the only LIVE instance of this defect class
(the only column where nothing — neither a client-side `defaultValue` nor an
always-set repository call — populated a `NOT NULL` DB-defaulted column, and
where the model would be inserted via `.create()` without that field). Two
more columns (`webhook_event.receivedAt`, `compliance_audit_log.occurredAt`)
share the same *shape* of gap (DB-side-only default, no client-side
`defaultValue`) but are not currently live bugs because every existing call
site always supplies the value explicitly — flagged as a defensive follow-up
recommendation, not fixed here (no command given to touch those files, and
they are not broken today).

## Local gates

lint / typecheck / test / build all **pass** (exit 0). Full detail, commands,
and output hashes in `mcp-validation-evidence.json`'s `local_gates`.

## MCP validation

**Not applicable.** This fix touches `app/db/models/shop.model.ts` only — a
backend Sequelize model attribute definition, no Admin GraphQL, no Polaris
web components, no Liquid/theme. Stated explicitly per the no-silent-skip
rule; `validations: []` in `mcp-validation-evidence.json`.
