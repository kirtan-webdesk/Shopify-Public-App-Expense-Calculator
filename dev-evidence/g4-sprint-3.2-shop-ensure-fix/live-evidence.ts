// Live-evidence script for G4-sprint-3.2 (P1 fix: no `shop` row for a real
// managed-install / token-exchange session).
//
// NOT part of the permanent vitest suite (vitest.config.ts stays DB-free — see
// tests/README.md). The permanent opt-in DB suite is
// tests/db/shop-ensure.db.test.ts (real route loaders/actions); this script is
// the human-readable evidence run: it drives the REAL production service +
// repository code (requireShopContext -> ensureShopContext -> Postgres) against
// the REAL Postgres in .env (DATABASE_URL — never printed) and prints the SQL
// trace and row state for each scenario. It throws (non-zero exit) on any FAIL.
//
// Run: npx vite-node -c vitest.config.ts dev-evidence/g4-sprint-3.2-shop-ensure-fix/live-evidence.ts
//
// Scenarios (every shop domain is genuinely fresh — randomUUID — and NO shop
// row is created by any helper; rows appear only as a side effect of
// requireShopContext, the request-path choke point):
//   1. THE OUTAGE STATE: a real session row in shopify_sessions (written via the
//      session-storage library's own API, ADR-0007) + NO shop row. The old code
//      path (findShopContextByDomain) returns null => the old 404. The fix
//      creates the row on the request path for that EXISTING session.
//   2. The default rules seed for the freshly created shop.
//   3. Two concurrent first requests: both succeed, both attempt
//      INSERT ... ON CONFLICT DO NOTHING, exactly ONE row remains.
//   4. Repeat requests: SELECT only, zero shop writes; row unchanged.
//   5. Reinstall (uninstalled_at set, not redacted): cleared, SAME row id,
//      rules + history retained (ADR-0008 step 2).
//   6. Post-shop/redact (hard-deleted) then a session: a NEW empty row.
//   7. Cross-tenant: shop B cannot read shop A's calculation (null, while the
//      row demonstrably exists).
//   8. Cleanup (+ verification): every row and session this run created is gone.
//   9. Read-only observation of the real dev store's state (never modified).

import { randomUUID } from "node:crypto";
import { QueryTypes } from "sequelize";
import { Session } from "@shopify/shopify-api";
import { sequelize } from "~/db/sequelize";
import { sessionStorageInstance } from "~/shopify.server";
import {
  findShopContextByDomain,
  hardDeleteShop,
  markShopUninstalled,
} from "~/db/repositories/shop.repository";
import { requireShopContext } from "~/services/shop-context.service";
import { getOrSeedExpenseRules } from "~/services/expense-rule.service";
import { getHistoryPage, getSavedCalculation, saveCalculationFromTransport } from "~/services/calculation-history.service";
import { encodeCalculationResult } from "~/domain/calculation-transport";
import { calculateExpenses } from "~/domain/expense-engine";
import { DEFAULT_EXPENSE_RULES } from "~/domain/expense-rule-defaults";

// Display-only compaction of a SQL trace: head + tail, so the clause that
// matters (WHERE / ON CONFLICT DO NOTHING) stays visible. Checks always run
// against the full, uncompacted statements.
const compact = (sql: string[]) => sql.map((q) => (q.length > 190 ? `${q.slice(0, 110)} ... ${q.slice(-70)}` : q));
const log = (section: string, data?: unknown) => {
  console.log(`\n=== ${section} ===`);
  if (data !== undefined) console.log(typeof data === "string" ? data : JSON.stringify(data, null, 2));
};
function check(cond: unknown, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`PASS: ${msg}`);
}

const RUN = randomUUID().slice(0, 8);
const domains: string[] = [];
const sessionIds: string[] = [];
const fresh = (label: string) => {
  const d = `ensure-live-${RUN}-${label}.myshopify.com`;
  domains.push(d);
  return d;
};

interface ShopRow { id: string; uninstalled_at: string | null; installed_at: string; created_at: string }
const shopRows = (domain: string) =>
  sequelize.query<ShopRow>(
    "SELECT id, uninstalled_at::text, installed_at::text, created_at::text FROM shop WHERE shop_domain = :domain",
    { replacements: { domain }, type: QueryTypes.SELECT },
  );
const count = async (table: string, shopId: string) => {
  const [r] = await sequelize.query<{ c: string }>(`SELECT count(*)::text AS c FROM ${table} WHERE shop_id = :shopId`, {
    replacements: { shopId },
    type: QueryTypes.SELECT,
  });
  return Number(r?.c);
};

async function withSqlTrace<T>(fn: () => Promise<T>): Promise<{ value: T; sql: string[] }> {
  const opts = (sequelize as unknown as { options: { logging: unknown } }).options;
  const original = opts.logging;
  const sql: string[] = [];
  opts.logging = (s: string) => {
    sql.push(String(s).replace(/^Executing \([^)]*\): /, ""));
  };
  try {
    return { value: await fn(), sql };
  } finally {
    opts.logging = original;
  }
}

function defaultTransport(revenueMinor = 5_000_000): string {
  return encodeCalculationResult(
    calculateExpenses({
      revenueMinor,
      currencyCode: "USD",
      rules: DEFAULT_EXPENSE_RULES.map((r) => ({
        categoryKey: r.categoryKey,
        enabled: true,
        ruleType: r.ruleType,
        rateBasisPoints: r.rateBasisPoints,
        fixedAmountMinor: r.fixedAmountMinor,
        formulaKey: r.formulaKey,
      })),
    }),
  );
}

async function cleanup() {
  for (const id of sessionIds) await sessionStorageInstance.deleteSession(id);
  if (domains.length) await sequelize.query("DELETE FROM shop WHERE shop_domain IN (:d)", { replacements: { d: domains } });
}

async function main() {
  log("0. Environment", {
    poolMax: (sequelize as unknown as { options: { pool: { max: number } } }).options.pool.max,
    runId: RUN,
  });

  // -------------------------------------------- 1. THE OUTAGE STATE
  const a = fresh("a");
  const sid = `offline_${a}`;
  sessionIds.push(sid);
  await sessionStorageInstance.storeSession(
    new Session({ id: sid, shop: a, state: "evidence", isOnline: false, accessToken: "evidence-placeholder-not-a-real-token" }),
  );
  const sessions = await sessionStorageInstance.findSessionsByShop(a);
  check(sessions.length === 1 && (await shopRows(a)).length === 0, "1a. outage state reproduced: a session exists for the shop, NO shop row exists");
  check((await findShopContextByDomain(a)) === null, "1b. the OLD request path (findShopContextByDomain) returns null here => this is what threw the 404");
  const t1 = await withSqlTrace(() => requireShopContext({ shop: a }));
  log("1c. SQL trace of the first request via requireShopContext", compact(t1.sql));
  const rowsA = await shopRows(a);
  check(rowsA.length === 1 && rowsA[0]!.uninstalled_at === null && t1.value.shopId === rowsA[0]!.id, "1d. requireShopContext created the shop row for the EXISTING session (no new token exchange needed)");
  log("1e. shop row", { id: rowsA[0]!.id, installed_at: rowsA[0]!.installed_at, uninstalled_at: rowsA[0]!.uninstalled_at });

  // -------------------------------------------- 2. rules seed
  const rules = await getOrSeedExpenseRules(t1.value);
  check(rules.length === 10 && (await count("expense_rule", t1.value.shopId)) === 10, "2. calculator path: default rules seeded (10) for the fresh shop");

  // -------------------------------------------- 3. concurrent first requests
  const race = fresh("race");
  check((await shopRows(race)).length === 0, "3a. precondition: no row for the race shop");
  const t3 = await withSqlTrace(() => Promise.all([requireShopContext({ shop: race }), requireShopContext({ shop: race })]));
  log("3b. SQL trace of two simultaneous first requests", compact(t3.sql));
  const raceRows = await shopRows(race);
  const inserts = t3.sql.filter((s) => /INSERT INTO "shop"/.test(s));
  check(t3.value[0].shopId === t3.value[1].shopId && raceRows.length === 1, "3c. both requests succeeded and resolved the SAME single row (exactly ONE shop row)");
  check(inserts.length >= 2 && inserts.every((s) => /ON CONFLICT DO NOTHING/.test(s)), "3d. the losing request really hit the unique(shop_domain) conflict path (>=2 INSERT ... ON CONFLICT DO NOTHING attempts)");

  // -------------------------------------------- 4. hot path
  const before = (await shopRows(a))[0]!;
  const t4 = await withSqlTrace(async () => {
    await requireShopContext({ shop: a });
    await requireShopContext({ shop: a });
    await requireShopContext({ shop: a });
  });
  log("4a. SQL trace of three repeat requests", compact(t4.sql));
  const after = (await shopRows(a))[0]!;
  check(t4.sql.every((s) => /^SELECT/.test(s)) && t4.sql.length === 3, "4b. hot path is one SELECT per request, zero writes");
  check(JSON.stringify(before) === JSON.stringify(after), "4c. row unchanged (id / installed_at / created_at)");

  // -------------------------------------------- 5. reinstall (uninstalled, not redacted)
  const saved = await saveCalculationFromTransport(t1.value, defaultTransport());
  check(saved.ok === true, "5a. one calculation saved for shop A");
  await sequelize.transaction(async (t) => {
    await markShopUninstalled(a, t);
  });
  check((await shopRows(a))[0]!.uninstalled_at !== null, "5b. app/uninstalled repository step applied: uninstalled_at is set");
  const t5 = await withSqlTrace(() => requireShopContext({ shop: a }));
  log("5c. SQL trace of the first request after reinstall", compact(t5.sql));
  const reRows = await shopRows(a);
  check(reRows.length === 1 && reRows[0]!.id === before.id && reRows[0]!.uninstalled_at === null, "5d. reinstall: uninstalled_at cleared, SAME shop row (ADR-0008 step 2)");
  check((await count("expense_rule", before.id)) === 10 && (await getHistoryPage(t5.value, 1)).totalCount === 1, "5e. rules (10) and history (1) retained across the reinstall");

  // -------------------------------------------- 6. after shop/redact
  const ctxA = await findShopContextByDomain(a);
  await sequelize.transaction(async (t) => {
    await hardDeleteShop(ctxA!, randomUUID(), t);
  });
  check((await shopRows(a)).length === 0, "6a. shop/redact repository step applied: shop row hard-deleted");
  const fresh6 = await requireShopContext({ shop: a });
  const rows6 = await shopRows(a);
  check(rows6.length === 1 && rows6[0]!.id !== before.id && fresh6.shopId === rows6[0]!.id, "6b. a session after redact recreates a NEW row (new id)");
  check((await getHistoryPage(fresh6, 1)).totalCount === 0 && (await count("expense_rule", fresh6.shopId)) === 0, "6c. nothing from the redacted shop is resurrected (empty history, no rules until first calculator load)");

  // -------------------------------------------- 7. cross-tenant
  const ctxAgain = await requireShopContext({ shop: a });
  const savedA = await saveCalculationFromTransport(ctxAgain, defaultTransport(2_468_000));
  check(savedA.ok === true, "7a. shop A saves a calculation");
  const idOfA = (savedA as { id: string }).id;
  const b = fresh("b");
  const ctxB = await requireShopContext({ shop: b });
  const [exists] = await sequelize.query<{ c: string }>("SELECT count(*)::text AS c FROM calculation WHERE id = :id", {
    replacements: { id: idOfA },
    type: QueryTypes.SELECT,
  });
  check(Number(exists?.c) === 1, "7b. the row demonstrably exists (raw SQL by id)");
  check((await getSavedCalculation(ctxB, idOfA)) === null, "7c. shop B (first-ever request) cannot read shop A's calculation by id (null => identical 404 in the route)");
  check((await getSavedCalculation(ctxB, randomUUID())) === null, "7d. a nonexistent id gives the identical null");
  check((await getHistoryPage(ctxB, 1)).totalCount === 0, "7e. shop B's history is empty");

  // -------------------------------------------- 8. cleanup
  await cleanup();
  const [left] = await sequelize.query<{ c: string }>("SELECT count(*)::text AS c FROM shop WHERE shop_domain IN (:d)", {
    replacements: { d: domains },
    type: QueryTypes.SELECT,
  });
  const leftoverSessions = (await Promise.all(domains.map((d) => sessionStorageInstance.findSessionsByShop(d)))).flat();
  check(Number(left?.c) === 0 && leftoverSessions.length === 0, "8. cleanup verified: zero shop rows and zero sessions remain for this run's domains");

  // -------------------------------------------- 9. real dev store (read-only)
  const wds = await shopRows("wds55.myshopify.com");
  const wdsSessions = (await sessionStorageInstance.findSessionsByShop("wds55.myshopify.com")).length;
  log("9. Real dev store wds55.myshopify.com, READ-ONLY observation (this script never writes to it)", {
    shopRowCount: wds.length,
    shopRow: wds[0] ? { id: wds[0].id, created_at: wds[0].created_at, uninstalled_at: wds[0].uninstalled_at } : null,
    sessionCount: wdsSessions,
    note:
      "observed as found. If the row is absent, the deployed fix creates it on the store's next /app request " +
      "(existing session, no new token exchange). If present, it was created outside this run (this script " +
      "cannot have created it: it never writes to this domain) and requireShopContext leaves it as-is.",
  });
}

main()
  .then(async () => {
    console.log("\nALL LIVE CHECKS PASSED");
    await sequelize.close();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error(String(e instanceof Error ? e.message : e));
    try {
      await cleanup();
      console.error("(cleanup executed after failure)");
    } catch (c) {
      console.error("cleanup failed:", String(c instanceof Error ? c.message : c));
    }
    process.exit(1);
  });
