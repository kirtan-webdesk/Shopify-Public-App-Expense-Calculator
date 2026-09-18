// Live-evidence script for G4-sprint-3.1 (M4 Save + History).
//
// NOT part of the permanent vitest suite (vitest.config.ts stays DB-free by
// design — see tests/README.md). The permanent DB-backed suite is
// tests/db/calculation-history.db.test.ts (opt-in, RUN_DB_TESTS=1); this
// script is the human-readable evidence run: it exercises the REAL
// production service + repository code against the REAL Postgres (Neon, via
// .env's DATABASE_URL — the value is never printed) and prints what it finds.
//
// Run: npx vite-node -c vitest.config.ts dev-evidence/g4-sprint-3.1-m4/live-evidence.ts
//
// What it proves (each section prints PASS/FAIL and throws on failure):
//   1. SAVE  — a calculation saved through saveCalculationFromTransport lands
//              as one calculation row + N by-value line items; engine_version
//              and currency are stored; sum(line items) === total.
//   2. FT-14a — after the shop's live rules are mutated (every one), the
//              saved detail (JSON view AND rendered HTML) is BYTE-IDENTICAL —
//              proven by sha256 of both, and of the raw stored rows.
//   3. TENANCY — shop B cannot read shop A's saved calculation by id (null),
//              while the row demonstrably exists (raw SQL by id) — so the
//              null is tenancy, not absence. Nonexistent/malformed ids give
//              the identical null.
//   4. ATOMICITY — failure injection: (a) a CHECK violation on a later line
//              item, (b) a unique violation, (c) a deferred-trigger
//              reconciliation failure at COMMIT. For each, the SQL trace of
//              the transaction is printed and zero rows remain. A valid save
//              afterwards succeeds (pool.max:1 not wedged).
//   5. TAMPER — a payload whose amounts were altered is rejected by the
//              server-side recompute; nothing is written.
//   6. APPEND-ONLY — a raw UPDATE against either table is rejected by the DB.
//   7. PAGINATION — 25 saved calculations -> page 1 = 20, page 2 = 5,
//              newest-first, contiguous, no overlap; junk/out-of-range page
//              params are handled.
//   8. DUPLICATE — the "Duplicate as new calculation" prefill comes from the
//              snapshot, not the live rules, and writes nothing.
//   9. CLEANUP — every row created is deleted and verified gone.
//
// Every shop domain is genuinely fresh (randomUUID per run).

import { createHash, randomUUID } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryTypes } from "sequelize";
import { sequelize } from "~/db/sequelize";
import { upsertInstalledShop } from "~/db/repositories/shop.repository";
import { listExpenseRulesForShop, replaceExpenseRulesForShop } from "~/db/repositories/expense-rule.repository";
import { insertCalculationSnapshot } from "~/db/repositories/calculation.repository";
import {
  buildDuplicatePrefill,
  getHistoryPage,
  getSavedCalculation,
  saveCalculationFromTransport,
} from "~/services/calculation-history.service";
import { getOrSeedExpenseRules } from "~/services/expense-rule.service";
import { SavedCalculationPage } from "~/components/saved-calculation-page";
import { encodeCalculationResult } from "~/domain/calculation-transport";
import { DEFAULT_EXPENSE_RULES } from "~/domain/expense-rule-defaults";
import { calculateExpenses, ENGINE_VERSION, type EngineResult } from "~/domain/expense-engine";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const log = (section: string, data?: unknown) => {
  console.log(`\n=== ${section} ===`);
  if (data !== undefined) console.log(typeof data === "string" ? data : JSON.stringify(data, null, 2));
};
function check(cond: unknown, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`PASS: ${msg}`);
}

function defaultResult(revenueMinor = 5_000_000, currencyCode = "USD"): EngineResult {
  return calculateExpenses({
    revenueMinor,
    currencyCode,
    rules: DEFAULT_EXPENSE_RULES.map((r) => ({
      categoryKey: r.categoryKey,
      enabled: true,
      ruleType: r.ruleType,
      rateBasisPoints: r.rateBasisPoints,
      fixedAmountMinor: r.fixedAmountMinor,
      formulaKey: r.formulaKey,
    })),
  });
}

async function counts(shopId: string) {
  const [c] = await sequelize.query<{ c: string }>(
    "SELECT count(*)::text AS c FROM calculation WHERE shop_id = :shopId",
    { replacements: { shopId }, type: QueryTypes.SELECT },
  );
  const [l] = await sequelize.query<{ c: string }>(
    "SELECT count(*)::text AS c FROM calculation_line_item WHERE shop_id = :shopId",
    { replacements: { shopId }, type: QueryTypes.SELECT },
  );
  return { calculations: Number(c?.c), lineItems: Number(l?.c) };
}

/** Runs `fn` while capturing every SQL statement Sequelize issues. */
async function withSqlTrace<T>(fn: () => Promise<T>): Promise<{ value?: T; error?: unknown; sql: string[] }> {
  const opts = (sequelize as unknown as { options: { logging: unknown } }).options;
  const original = opts.logging;
  const sql: string[] = [];
  opts.logging = (s: string) => {
    sql.push(String(s).replace(/^Executing \([^)]*\): /, "").slice(0, 220));
  };
  try {
    return { value: await fn(), sql };
  } catch (error) {
    return { error, sql };
  } finally {
    opts.logging = original;
  }
}

// Module-level so the failure path below can clean up too: a run that throws
// midway must not leave rows behind in the shared dev database.
const createdShopIds: string[] = [];

async function deleteCreatedShops() {
  if (createdShopIds.length === 0) return;
  // ON DELETE CASCADE removes calculation / calculation_line_item / expense_rule.
  await sequelize.query("DELETE FROM shop WHERE id IN (:ids)", { replacements: { ids: createdShopIds } });
}

async function main() {
  const fresh = async (label: string) => {
    const ctx = await upsertInstalledShop(`m4-live-${label}-${randomUUID()}.myshopify.com`);
    createdShopIds.push(ctx.shopId);
    return ctx;
  };

  const shopA = await fresh("a");
  const shopB = await fresh("b");
  log("0. Fresh shops (never used before)", {
    A: shopA.shopDomain,
    B: shopB.shopDomain,
    poolMax: (sequelize as unknown as { options: { pool: { max: number } } }).options.pool.max,
  });
  await replaceExpenseRulesForShop(shopA, DEFAULT_EXPENSE_RULES.map((r) => ({ ...r, enabled: true })));

  // ----------------------------------------------------------------- 1. SAVE
  const expected = defaultResult();
  const saveOutcome = await saveCalculationFromTransport(shopA, encodeCalculationResult(expected));
  check(saveOutcome.ok, "saveCalculationFromTransport accepted an honest payload");
  const idA = (saveOutcome as { ok: true; id: string }).id;
  const [calcRow] = await sequelize.query<Record<string, unknown>>(
    "SELECT id, shop_id, revenue_minor::text, currency_code, total_expenses_minor::text, net_amount_minor::text, engine_version, created_at FROM calculation WHERE id = :id",
    { replacements: { id: idA }, type: QueryTypes.SELECT },
  );
  const lineRows = await sequelize.query<Record<string, unknown>>(
    "SELECT category_key, category_label_at_save, rule_type_at_save, rate_basis_points_at_save, fixed_amount_minor_at_save::text AS fixed_at_save, formula_key_at_save, computed_amount_minor::text AS amount, sort_order FROM calculation_line_item WHERE calculation_id = :id ORDER BY sort_order",
    { replacements: { id: idA }, type: QueryTypes.SELECT },
  );
  log("1a. Stored calculation row", calcRow);
  log("1b. Stored line items (snapshot by value)", lineRows);
  check(calcRow?.engine_version === ENGINE_VERSION, `engine_version stored = ${ENGINE_VERSION}`);
  check(calcRow?.currency_code === "USD", "currency_code stored");
  check(calcRow?.shop_id === shopA.shopId, "row is scoped to shop A");
  check(lineRows.length === expected.lineItems.length, `one line item per applied category (${lineRows.length})`);
  const sum = lineRows.reduce((acc, r) => acc + Number(r.amount), 0);
  check(sum === expected.totalExpensesMinor && String(sum) === calcRow?.total_expenses_minor, `sum(line items) ${sum} === stored total`);
  const [fk] = await sequelize.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM pg_constraint c JOIN pg_class cl ON cl.oid=c.conrelid JOIN pg_class rf ON rf.oid=c.confrelid
      WHERE c.contype='f' AND cl.relname IN ('calculation','calculation_line_item') AND rf.relname='expense_rule'`,
    { type: QueryTypes.SELECT },
  );
  check(fk?.n === "0", "no foreign key from calculation / calculation_line_item to expense_rule");

  // -------------------------------------------------------- 2. FT-14a byte-identical
  const renderDetail = async () => {
    const saved = await getSavedCalculation(shopA, idA);
    if (!saved) throw new Error("saved calculation not found for its own shop");
    const json = JSON.stringify(saved);
    const html = renderToStaticMarkup(createElement(SavedCalculationPage, { saved }));
    const raw = JSON.stringify(
      await sequelize.query(
        "SELECT * FROM calculation_line_item WHERE calculation_id = :id ORDER BY sort_order",
        { replacements: { id: idA }, type: QueryTypes.SELECT },
      ),
    );
    return { json, html, raw };
  };
  const liveSnapshot = async () =>
    JSON.stringify((await listExpenseRulesForShop(shopA)).map((r) => [r.categoryKey, r.ruleType, r.rateBasisPoints, r.fixedAmountMinor, r.formulaKey, r.enabled]));

  const before = await renderDetail();
  const liveBefore = await liveSnapshot();
  await replaceExpenseRulesForShop(
    shopA,
    DEFAULT_EXPENSE_RULES.map((r, i) =>
      i % 2 === 0
        ? { categoryKey: r.categoryKey, ruleType: "fixed" as const, rateBasisPoints: null, fixedAmountMinor: 777_777 + i, formulaKey: null, enabled: false }
        : { categoryKey: r.categoryKey, ruleType: "percentage" as const, rateBasisPoints: 9_999 - i, fixedAmountMinor: null, formulaKey: null, enabled: false },
    ),
  );
  const liveAfter = await liveSnapshot();
  const after = await renderDetail();
  log("2. FT-14a — live rules before vs after mutation (sha256)", { liveBefore: sha(liveBefore), liveAfter: sha(liveAfter) });
  check(liveBefore !== liveAfter, "live expense rules genuinely changed (every rule rewritten + disabled)");
  log("2. FT-14a — saved detail sha256 before vs after", {
    jsonBefore: sha(before.json),
    jsonAfter: sha(after.json),
    htmlBefore: sha(before.html),
    htmlAfter: sha(after.html),
    storedRowsBefore: sha(before.raw),
    storedRowsAfter: sha(after.raw),
    htmlBytes: Buffer.byteLength(after.html),
  });
  check(before.json === after.json, "detail JSON view byte-identical after live rules changed");
  check(before.html === after.html, "rendered detail HTML byte-identical after live rules changed");
  check(before.raw === after.raw, "stored line-item rows byte-identical");
  check(after.html.includes("32.50% of revenue") && !after.html.includes("777777"), "detail still shows the rule AS SAVED, not the mutated live rule");

  // ------------------------------------------------------------ 3. TENANCY
  const [existsRaw] = await sequelize.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM calculation WHERE id = :id",
    { replacements: { id: idA }, type: QueryTypes.SELECT },
  );
  check(existsRaw?.n === "1", "the row exists in the database (raw SQL by id, no tenancy predicate)");
  const asB = await getSavedCalculation(shopB, idA);
  const nonexistent = await getSavedCalculation(shopB, randomUUID());
  const malformed = await getSavedCalculation(shopB, "not-a-uuid");
  log("3. Cross-tenant read attempt (shop B requests shop A's id)", { asB, nonexistent, malformed });
  check(asB === null, "shop B cannot read shop A's calculation (null = not found)");
  check(asB === nonexistent && asB === malformed, "other-shop / nonexistent / malformed ids are indistinguishable");
  const bPage = await getHistoryPage(shopB, 1);
  check(bPage.totalCount === 0 && bPage.items.length === 0, "shop B's history list is empty (A's rows invisible)");

  // ----------------------------------------------------------- 4. ATOMICITY
  const base = defaultResult();
  const injections: Array<{ name: string; result: EngineResult; expectMsg: RegExp }> = [
    {
      name: "4a. CHECK violation on the 4th line item (negative amount)",
      result: { ...base, lineItems: base.lineItems.map((li, i) => (i === 3 ? { ...li, computedAmountMinor: -5 as never } : li)) },
      expectMsg: /chk_cli_amount_nonneg|violates check/i,
    },
    {
      name: "4b. unique violation (duplicate category in one calculation)",
      result: { ...base, lineItems: [...base.lineItems, base.lineItems[0]!] },
      // Sequelize wraps a unique violation as SequelizeUniqueConstraintError
      // (message "Validation error"); the database's own text is on .parent.
      expectMsg: /uq_calc_line_item_calc_category|duplicate key|unique/i,
    },
    {
      name: "4c. deferred reconciliation trigger fails at COMMIT (total off by 1)",
      result: { ...base, totalExpensesMinor: (base.totalExpensesMinor + 1) as never },
      expectMsg: /do not reconcile/i,
    },
  ];
  for (const inj of injections) {
    const shop = await fresh("atomic");
    const trace = await withSqlTrace(() => insertCalculationSnapshot(shop, inj.result));
    log(`${inj.name} — SQL trace`, trace.sql);
    const err = trace.error as (Error & { name: string; parent?: { message?: string } }) | undefined;
    const errText = [err?.name, err?.message, err?.parent?.message].filter(Boolean).join(" | ");
    log(`${inj.name} — error (name | message | database message)`, errText || "NO ERROR");
    check(trace.error !== undefined, `${inj.name}: the save failed`);
    check(inj.expectMsg.test(errText), `${inj.name}: failed for the injected reason`);
    const c = await counts(shop.shopId);
    log(`${inj.name} — rows remaining for that shop`, c);
    check(c.calculations === 0 && c.lineItems === 0, `${inj.name}: ZERO rows remain (atomic rollback)`);
    const ok = await insertCalculationSnapshot(shop, defaultResult());
    const c2 = await counts(shop.shopId);
    check(!!ok.id && c2.calculations === 1 && c2.lineItems === 10, `${inj.name}: a valid save afterwards succeeds under pool.max=1 (pool not wedged)`);
  }

  // -------------------------------------------------------------- 5. TAMPER
  {
    const shop = await fresh("tamper");
    const good = encodeCalculationResult(defaultResult());
    const payload = JSON.parse(Buffer.from(good, "base64url").toString("utf8")) as { li: Array<{ amt: number }> };
    payload.li[0]!.amt += 1;
    const tampered = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const outcome = await saveCalculationFromTransport(shop, tampered);
    log("5. Tampered payload (one line-item amount +1 cent)", outcome);
    check(!outcome.ok, "server-side recompute rejected the tampered payload");
    const c = await counts(shop.shopId);
    check(c.calculations === 0 && c.lineItems === 0, "nothing was written for the tampered payload");
  }

  // ---------------------------------------------------------- 6. APPEND-ONLY
  for (const stmt of [
    "UPDATE calculation SET revenue_minor = 1 WHERE id = :id",
    "UPDATE calculation_line_item SET computed_amount_minor = 1 WHERE calculation_id = :id",
  ]) {
    let message = "NO ERROR";
    try {
      await sequelize.query(stmt, { replacements: { id: idA } });
    } catch (e) {
      message = (e as Error).message;
    }
    log(`6. ${stmt}`, message);
    check(/append-only/i.test(message), "UPDATE rejected by the append-only trigger");
  }

  // --------------------------------------------------------- 7. PAGINATION
  const shopP = await fresh("paging");
  const idsNewestFirst: string[] = [];
  for (let i = 0; i < 25; i += 1) {
    const r = await insertCalculationSnapshot(shopP, defaultResult(1_000_000 + i * 1000));
    idsNewestFirst.unshift(r.id);
  }
  const p1 = await getHistoryPage(shopP, 1);
  const p2 = await getHistoryPage(shopP, 2);
  const p99 = await getHistoryPage(shopP, 99);
  log("7. Pagination", {
    totalCount: p1.totalCount,
    totalPages: p1.totalPages,
    page1: { page: p1.page, rows: p1.items.length, first: p1.items[0]?.savedAtIso, last: p1.items.at(-1)?.savedAtIso },
    page2: { page: p2.page, rows: p2.items.length, first: p2.items[0]?.savedAtIso, last: p2.items.at(-1)?.savedAtIso },
    page99_clampedTo: p99.page,
  });
  check(p1.totalCount === 25 && p1.totalPages === 2, "25 rows -> 2 pages");
  check(p1.items.length === 20 && p2.items.length === 5, "page 1 = 20 rows, page 2 = 5 rows");
  const allIds = [...p1.items, ...p2.items].map((i) => i.id);
  check(JSON.stringify(allIds) === JSON.stringify(idsNewestFirst), "newest first, contiguous across pages, no overlap/gap");
  check(p99.page === 2, "out-of-range page clamps to the last page");
  const empty = await getHistoryPage(await fresh("empty"), 1);
  check(empty.items.length === 0 && empty.totalPages === 1, "a shop with no history gets an empty page (empty state)");

  // -------------------------------------------------------- 8. DUPLICATE
  {
    const rulesBefore = JSON.stringify((await listExpenseRulesForShop(shopA)).map((r) => r.toJSON()));
    const countBefore = (await counts(shopA.shopId)).calculations;
    const saved = await getSavedCalculation(shopA, idA);
    const liveRules = await getOrSeedExpenseRules(shopA);
    const prefill = buildDuplicatePrefill(saved!, liveRules);
    const cogs = prefill.rules.find((r) => r.categoryKey === "cost_of_goods")!;
    const shipping = prefill.rules.find((r) => r.categoryKey === "shipping")!;
    log("8. Duplicate prefill (live rules were mutated in step 2)", {
      revenueMinor: prefill.revenueMinor,
      currencyCode: prefill.currencyCode,
      cost_of_goods: cogs,
      shipping,
    });
    check(prefill.revenueMinor === 5_000_000 && cogs.rateBasisPoints === 3250, "prefill comes from the SNAPSHOT (32.50%), not the mutated live rule");
    check(shipping.ruleType === "fixed" && shipping.fixedAmountMinor === 45_000, "prefill uses the snapshot's rule type/value");
    const rulesAfter = JSON.stringify((await listExpenseRulesForShop(shopA)).map((r) => r.toJSON()));
    check(rulesBefore === rulesAfter && (await counts(shopA.shopId)).calculations === countBefore, "duplicate wrote nothing (live rules and history unchanged)");
  }

  // ------------------------------------------------------------- 9. CLEANUP
  await deleteCreatedShops();
  const [residue] = await sequelize.query<{ c: string }>(
    `SELECT ((SELECT count(*) FROM shop WHERE id IN (:ids)) + (SELECT count(*) FROM calculation WHERE shop_id IN (:ids))
           + (SELECT count(*) FROM calculation_line_item WHERE shop_id IN (:ids)) + (SELECT count(*) FROM expense_rule WHERE shop_id IN (:ids)))::text AS c`,
    { replacements: { ids: createdShopIds }, type: QueryTypes.SELECT },
  );
  log("9. Cleanup — residual rows across shop/calculation/line_item/expense_rule for the test shops", residue);
  check(residue?.c === "0", "every row created by this run was deleted");

  log("RESULT", "ALL CHECKS PASSED");
  await sequelize.close();
}

main()
  .then(() => {
    console.log("\nEXIT:0");
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("\nEXIT:1", err);
    try {
      await deleteCreatedShops();
      console.error(`(failure-path cleanup: deleted ${createdShopIds.length} test shop(s) and their rows)`);
    } catch (cleanupErr) {
      console.error("failure-path cleanup itself failed:", cleanupErr);
    }
    process.exit(1);
  });
