// Live-evidence script for G4-sprint-2.1 (M2 Configuration + M3 Engine).
// NOT part of the permanent vitest suite (vitest.config.ts deliberately
// excludes DB integration — no DATABASE_URL secret in CI, see
// .github/workflows/app-ci.yml) — run manually via vite-node against a real
// Postgres, output captured to 00-live-evidence-output.log by the caller.
//
// Run: npx vite-node -c vitest.config.ts dev-evidence/g4-sprint-2.1-m2-m3/live-evidence.ts
//
// Exercises, against the REAL database (not mocks):
//   1. expense_rule repository CRUD (ADR-0003 ShopContext pattern) — seed
//      defaults, read back, update/disable via the same path the
//      calculator's "Save" action uses (expense-rule.service.ts).
//   2. The calculation engine against rows read back from the database
//      (not just in-memory fixtures), with a revenue figure deliberately
//      chosen so naive per-category rounding would NOT reconcile to the
//      total — proving the largest-remainder pass is real, not incidental.
//   3. The encode/decode transport round trip (app.calculator.tsx ->
//      app.results.tsx handoff).
//   4. Cleanup — deletes everything it created so this script is safe to
//      re-run and leaves no residue in a shared dev database.

import { randomUUID } from "node:crypto";
import { sequelize } from "~/db/sequelize";
import { hardDeleteShop } from "~/db/repositories/shop.repository";
import { createShopContext, type ShopContext } from "~/db/repositories/shop-context";
import { listExpenseRulesForShop } from "~/db/repositories/expense-rule.repository";
import { getOrSeedExpenseRules, saveExpenseRules } from "~/services/expense-rule.service";
import { calculateExpenses, type EngineRuleInput } from "~/domain/expense-engine";
import { decodeCalculationResult, encodeCalculationResult } from "~/domain/calculation-transport";
import { EXPENSE_CATEGORIES } from "~/domain/expense-categories";

/**
 * NEW FINDING (discovered by this live-evidence run, NOT fixed, NOT
 * authorized — no command was given to fix it, per the no-auto-fix rule):
 * app/db/repositories/shop.repository.ts's upsertInstalledShop() calls
 * ShopModel.create({ shopDomain }) without setting installedAt.
 * ShopModel.installedAt is `allowNull: false` with NO `defaultValue` at the
 * Sequelize model layer (app/db/models/shop.model.ts) — only the DB column
 * has `DEFAULT now()`. Sequelize's client-side instance validator checks
 * allowNull BEFORE issuing SQL and does not know about the DB-side default,
 * so a genuinely NEW shop domain (one with no existing row) throws
 * `SequelizeValidationError: notNull Violation: Shop.installedAt cannot be
 * null` and the insert never reaches the database. createdAt/updatedAt are
 * unaffected because Sequelize's own `timestamps: true` machinery sets
 * those two at the JS layer regardless of the model's allowNull config —
 * installedAt is a separate, hand-rolled "DB-defaulted" column that ADR-0008
 * relies on, and nothing populates it at the JS layer.
 *
 * This is why this script inserts the evidence shop row directly via SQL
 * below rather than through upsertInstalledShop — working around the defect
 * ONLY for this evidence script, never touching app/db/* itself. M2/M3 (the
 * commanded scope of this sprint) do not depend on shop creation at all —
 * every route in this app resolves an ALREADY-installed shop's context via
 * findShopContextByDomain(session.shop); nothing in app.calculator.tsx or
 * app.results.tsx creates a shop row. This defect therefore does not block
 * or invalidate the M2/M3 evidence below, but it is real, it is live, and it
 * blocks every brand-new install's token-exchange flow in production —
 * flagged prominently for a human fix-decision, same discipline as the
 * BUG-1/2/4/5 chain found in G4-sprint-1.1.
 */
async function seedShopDirectlyBypassingTheKnownDefect(shopDomain: string): Promise<ShopContext> {
  const [row] = (await sequelize.query(
    `INSERT INTO shop (shop_domain, installed_at, created_at, updated_at)
     VALUES (:shopDomain, now(), now(), now())
     RETURNING id, shop_domain;`,
    { replacements: { shopDomain }, type: "SELECT" },
  )) as unknown as [{ id: string; shop_domain: string }];
  return createShopContext(row.id, row.shop_domain);
}

function log(section: string, data: unknown) {
  console.log(`\n=== ${section} ===`);
  console.log(typeof data === "string" ? data : JSON.stringify(data, null, 2));
}

async function main() {
  const shopDomain = `g4-sprint-2-1-evidence-${randomUUID().slice(0, 8)}.myshopify.com`;
  log("0. Test shop domain", shopDomain);

  // --- 1. Seed + read back --------------------------------------------
  // See seedShopDirectlyBypassingTheKnownDefect()'s header comment above —
  // upsertInstalledShop() itself currently cannot create a BRAND NEW shop
  // row (a real, newly-discovered defect, not something this evidence
  // script works around silently).
  const ctx = await seedShopDirectlyBypassingTheKnownDefect(shopDomain);
  log("1a. Seeded shop (ShopContext) — via direct SQL, see NEW FINDING comment above", ctx);

  const beforeRules = await listExpenseRulesForShop(ctx);
  log("1b. expense_rule rows BEFORE seeding defaults (expect 0)", beforeRules.length);
  if (beforeRules.length !== 0) throw new Error("EVIDENCE FAILED: expected a fresh shop with zero rules");

  const seeded = await getOrSeedExpenseRules(ctx);
  log(
    "1c. getOrSeedExpenseRules() result (PLACEHOLDER defaults from app/domain/expense-rule-defaults.ts)",
    seeded,
  );
  if (seeded.length !== EXPENSE_CATEGORIES.length) {
    throw new Error(
      `EVIDENCE FAILED: expected ${EXPENSE_CATEGORIES.length} seeded rules, got ${seeded.length}`,
    );
  }

  const afterSeedDbRows = await listExpenseRulesForShop(ctx);
  log("1d. expense_rule rows in DB AFTER seeding (expect 10, real rows not just in-memory)", {
    count: afterSeedDbRows.length,
    sample: afterSeedDbRows.slice(0, 2).map((r) => r.toJSON()),
  });

  // --- 2. Save/CRUD via the same service the calculator's "Save" action uses
  const editedRows = seeded.map((view) => {
    if (view.categoryKey === "misc") {
      return { categoryKey: view.categoryKey, enabled: false, ruleType: view.ruleType, rateBasisPoints: view.rateBasisPoints, fixedAmountMinor: view.fixedAmountMinor, formulaKey: view.formulaKey };
    }
    if (view.categoryKey === "cost_of_goods") {
      return { categoryKey: view.categoryKey, enabled: true, ruleType: "percentage" as const, rateBasisPoints: 3333, fixedAmountMinor: null, formulaKey: null };
    }
    if (view.categoryKey === "payroll") {
      return { categoryKey: view.categoryKey, enabled: true, ruleType: "formula" as const, rateBasisPoints: null, fixedAmountMinor: null, formulaKey: "base_fee_plus_marginal_percent" };
    }
    return { categoryKey: view.categoryKey, enabled: view.enabled, ruleType: view.ruleType, rateBasisPoints: view.rateBasisPoints, fixedAmountMinor: view.fixedAmountMinor, formulaKey: view.formulaKey };
  });

  const saveResult = await saveExpenseRules(ctx, editedRows);
  log("2a. saveExpenseRules() result (should be ok:true)", saveResult);
  if (!saveResult.ok) throw new Error("EVIDENCE FAILED: expected save to succeed with valid edited rows");

  const afterSaveRows = await listExpenseRulesForShop(ctx);
  const misc = afterSaveRows.find((r) => r.categoryKey === "misc");
  const cogs = afterSaveRows.find((r) => r.categoryKey === "cost_of_goods");
  const payroll = afterSaveRows.find((r) => r.categoryKey === "payroll");
  log("2b. Verified edits persisted to the REAL database (re-fetched, not cached)", {
    misc_enabled_should_be_false: misc?.enabled,
    cost_of_goods_rate_bp_should_be_3333: cogs?.rateBasisPoints,
    payroll_rule_type_should_be_formula: payroll?.ruleType,
    payroll_formula_key: payroll?.formulaKey,
  });
  if (misc?.enabled !== false) throw new Error("EVIDENCE FAILED: misc should be disabled after save");
  if (cogs?.rateBasisPoints !== 3333) throw new Error("EVIDENCE FAILED: cost_of_goods rate not persisted");
  if (payroll?.ruleType !== "formula") throw new Error("EVIDENCE FAILED: payroll rule type not persisted");

  // --- 3. Run the engine against rows READ BACK FROM THE DATABASE -----
  // revenueMinor chosen deliberately: 5,000,007 minor units is NOT evenly
  // divisible by any of the configured basis-point rates below, so naive
  // "round each category independently, then sum" WOULD NOT equal a
  // separately-rounded total — this is exactly the case largest-remainder
  // reconciliation (ADR-0005 item 4) exists for.
  const revenueMinor = 5_000_007;
  const engineRules: EngineRuleInput[] = afterSaveRows.map((r) => ({
    categoryKey: r.categoryKey as EngineRuleInput["categoryKey"],
    enabled: r.enabled,
    ruleType: r.ruleType,
    rateBasisPoints: r.rateBasisPoints,
    fixedAmountMinor: r.fixedAmountMinor === null ? null : Number(r.fixedAmountMinor),
    formulaKey: r.formulaKey,
  }));

  const result = calculateExpenses({ revenueMinor, currencyCode: "USD", rules: engineRules });
  log("3a. Engine result against DB-sourced rules (revenue deliberately non-divisible)", result);

  const sumOfLineItems = result.lineItems.reduce((s, li) => s + li.computedAmountMinor, 0);
  log("3b. Money/rounding verification", {
    sum_of_line_items: sumOfLineItems,
    total_expenses_minor: result.totalExpensesMinor,
    reconciled_exactly: sumOfLineItems === result.totalExpensesMinor,
    misc_excluded_because_disabled: !result.lineItems.some((li) => li.categoryKey === "misc"),
    revenue_minor: result.revenueMinor,
    net_amount_minor: result.netAmountMinor,
    net_equals_revenue_minus_total: result.netAmountMinor === result.revenueMinor - result.totalExpensesMinor,
  });
  if (sumOfLineItems !== result.totalExpensesMinor) {
    throw new Error(
      `EVIDENCE FAILED: reconciliation broken — sum=${sumOfLineItems} total=${result.totalExpensesMinor}`,
    );
  }
  if (result.lineItems.some((li) => li.categoryKey === "misc")) {
    throw new Error("EVIDENCE FAILED: disabled category (misc) should be excluded from line items");
  }

  // Independent naive-rounding comparison, to make the largest-remainder
  // pass's necessity concrete rather than asserted: round each enabled
  // percentage category independently (no reconciliation) and show its sum
  // frequently does NOT match the engine's reconciled total.
  let naiveSum = 0;
  for (const r of engineRules) {
    if (!r.enabled) continue;
    if (r.ruleType === "percentage" && r.rateBasisPoints !== null) {
      naiveSum += Math.round((revenueMinor * r.rateBasisPoints) / 10000);
    } else if (r.ruleType === "fixed" && r.fixedAmountMinor !== null) {
      naiveSum += r.fixedAmountMinor;
    }
    // formula categories excluded from this naive comparison — they are
    // already-integer black boxes to the reconciliation pass by design.
  }
  log("3c. Naive independent-per-category rounding, for contrast (NOT what the engine does)", {
    naive_sum_excluding_formula_categories: naiveSum,
    engine_reconciled_total: result.totalExpensesMinor,
    note: "The engine's total is the deterministically rounded TOTAL, with the largest-remainder " +
      "method allocating the residual across categories so they sum exactly to it — this naive " +
      "figure is shown only to make the reconciliation problem concrete, not as a bug.",
  });

  // --- 4. Determinism re-check against the same DB-sourced input ------
  const result2 = calculateExpenses({ revenueMinor, currencyCode: "USD", rules: engineRules });
  const deterministic = JSON.stringify(result) === JSON.stringify(result2);
  log("4. Determinism re-check (same DB rows, same revenue, run twice)", { deterministic });
  if (!deterministic) throw new Error("EVIDENCE FAILED: engine is not deterministic");

  // --- 5. Transport encode/decode round trip ---------------------------
  const encoded = encodeCalculationResult(result);
  const decoded = decodeCalculationResult(encoded);
  const transportRoundTripOk = JSON.stringify(decoded) === JSON.stringify(result);
  log("5. Calculator -> Results transport round trip", {
    encoded_length: encoded.length,
    round_trip_exact_match: transportRoundTripOk,
  });
  if (!transportRoundTripOk) throw new Error("EVIDENCE FAILED: transport round trip lost data");

  // --- 6. Cleanup --------------------------------------------------------
  await sequelize.transaction(async (t) => {
    const counts = await hardDeleteShop(ctx, "00000000-0000-0000-0000-000000000000", t);
    log("6a. Cleanup — hardDeleteShop row counts", counts);
  });
  const afterCleanupRules = await listExpenseRulesForShop(ctx);
  log("6b. expense_rule rows AFTER cleanup (expect 0)", afterCleanupRules.length);
  if (afterCleanupRules.length !== 0) throw new Error("EVIDENCE FAILED: cleanup left residue");

  console.log("\n=== ALL EVIDENCE CHECKS PASSED ===");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n=== EVIDENCE SCRIPT FAILED ===");
    console.error(err);
    process.exit(1);
  });
