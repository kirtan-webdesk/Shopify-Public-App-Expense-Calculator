import { randomUUID } from "node:crypto";
import { QueryTypes } from "sequelize";
import { afterAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_EXPENSE_RULES } from "~/domain/expense-rule-defaults";
import { EXPENSE_CATEGORIES } from "~/domain/expense-categories";
import { assertConnectedToTestDatabase, setupTestDatabase } from "../helpers/test-database";

// --------------------------------------------------------------------------
// G4-sprint-3.5 Part C — the sibling of the first-load SEED race: the FIRST
// Save of a fresh shop from two instances/tabs at once. With the old
// find-then-create loop both saw "no row", both INSERTed the same
// (shop_id, category_key) rows, and the loser hit
// uq_expense_rule_shop_category. replaceExpenseRulesForShop is now one
// INSERT ... ON CONFLICT (shop_id, category_key) DO UPDATE.
//
// Also covers the Save path for a category that was cleared AND unticked:
// saveExpenseRules must return fieldErrors and write NOTHING (previously the
// NULL reached chk_expense_rule_value_shape and threw).
//
// Two independent app module graphs (vi.resetModules => two Sequelize
// singletons => two pools => two real backends), as in
// tests/db/expense-rule-seed-race.db.test.ts.
//
// OPT-IN: RUN_DB_TESTS=1 + TEST_DATABASE_URL (a SEPARATE database — never
// production; see tests/README.md).
// --------------------------------------------------------------------------

const RUN_DB = setupTestDatabase();

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

interface Instance {
  sequelize: typeof import("~/db/sequelize").sequelize;
  replaceExpenseRulesForShop: typeof import("~/db/repositories/expense-rule.repository").replaceExpenseRulesForShop;
  saveExpenseRules: typeof import("~/services/expense-rule.service").saveExpenseRules;
  ensureShopContext: typeof import("~/db/repositories/shop.repository").ensureShopContext;
  sql: string[];
}

const instances: Instance[] = [];

async function loadInstance(): Promise<Instance> {
  vi.resetModules();
  const seq = await import("~/db/sequelize");
  const [ruleRepo, svc, shopRepo] = await Promise.all([
    import("~/db/repositories/expense-rule.repository"),
    import("~/services/expense-rule.service"),
    import("~/db/repositories/shop.repository"),
  ]);
  const inst: Instance = {
    sequelize: seq.sequelize,
    replaceExpenseRulesForShop: ruleRepo.replaceExpenseRulesForShop,
    saveExpenseRules: svc.saveExpenseRules,
    ensureShopContext: shopRepo.ensureShopContext,
    sql: [],
  };
  (seq.sequelize as unknown as { options: { logging?: (s: string) => void } }).options.logging = (s: string) => {
    inst.sql.push(String(s));
  };
  instances.push(inst);
  return inst;
}

interface RuleRow {
  category_key: string;
  rule_type: string;
  rate_basis_points: number | null;
  fixed_amount_minor: string | null;
  formula_key: string | null;
  enabled: boolean;
}

async function ruleRows(inst: Instance, shopId: string): Promise<RuleRow[]> {
  return inst.sequelize.query<RuleRow>(
    "SELECT category_key, rule_type, rate_basis_points, fixed_amount_minor::text, formula_key, enabled FROM expense_rule WHERE shop_id = :shopId ORDER BY category_key",
    { replacements: { shopId }, type: QueryTypes.SELECT },
  );
}

const runId = randomUUID().slice(0, 8);
const usedDomains: string[] = [];
function freshDomain(label: string): string {
  const d = `saverace-${runId}-${label}-${randomUUID().slice(0, 8)}.myshopify.com`;
  usedDomains.push(d);
  return d;
}

function defaultInputs(mutate?: (categoryKey: string) => Partial<{ enabled: boolean; rateBasisPoints: number | null }>) {
  return DEFAULT_EXPENSE_RULES.map((d) => ({
    categoryKey: d.categoryKey,
    ruleType: d.ruleType,
    rateBasisPoints: d.rateBasisPoints,
    fixedAmountMinor: d.fixedAmountMinor,
    formulaKey: d.formulaKey,
    enabled: true,
    ...(mutate ? mutate(d.categoryKey) : {}),
  }));
}

describe.skipIf(!RUN_DB)("first Save race + disabled-blank Save (TWO independent Sequelize pools, real Postgres)", () => {
  afterAll(async () => {
    const [first] = instances;
    if (first) {
      await first.sequelize.query("DELETE FROM shop WHERE shop_domain LIKE :p", { replacements: { p: `saverace-${runId}-%` } });
    }
    await Promise.all(instances.map((i) => i.sequelize.close()));
  }, 60_000);

  it("both instances save a fresh shop's rules at the same instant: both succeed, exactly 10 rows, last write wins per row", async () => {
    const a = await loadInstance();
    const b = await loadInstance();
    await assertConnectedToTestDatabase(a.sequelize);
    await assertConnectedToTestDatabase(b.sequelize);
    expect(a.sequelize).not.toBe(b.sequelize);

    for (let i = 0; i < 5; i++) {
      a.sql.length = 0;
      b.sql.length = 0;
      const ctx = await a.ensureShopContext(freshDomain(`race${i}`)); // shop row only; NO rule rows

      const settled = await Promise.allSettled([
        a.replaceExpenseRulesForShop(ctx, defaultInputs((k) => (k === "marketing" ? { rateBasisPoints: 1111 } : {}))),
        b.replaceExpenseRulesForShop(ctx, defaultInputs((k) => (k === "marketing" ? { rateBasisPoints: 2222 } : {}))),
      ]);
      expect(settled.map((s) => s.status), JSON.stringify(settled)).toEqual(["fulfilled", "fulfilled"]);

      const rows = await ruleRows(a, ctx.shopId);
      expect(rows).toHaveLength(EXPENSE_CATEGORIES.length);
      const marketing = rows.find((r) => r.category_key === "marketing")!;
      expect([1111, 2222]).toContain(marketing.rate_basis_points);

      // The statement each instance issued is the conflict-safe upsert.
      for (const inst of [a, b]) {
        const inserts = inst.sql.filter((s) => /INSERT INTO "expense_rule"/i.test(s));
        expect(inserts.length).toBeGreaterThanOrEqual(1);
        for (const s of inserts) expect(s).toMatch(/ON CONFLICT \("shop_id","category_key"\) DO UPDATE/i);
      }
    }
  });

  it("a second Save updates the existing rows in place (values change, still 10 rows, disabled state kept)", async () => {
    const [a] = instances as [Instance];
    const ctx = await a.ensureShopContext(freshDomain("update"));
    await a.replaceExpenseRulesForShop(ctx, defaultInputs());
    await a.replaceExpenseRulesForShop(
      ctx,
      defaultInputs((k) => (k === "marketing" ? { rateBasisPoints: 900 } : k === "misc" ? { enabled: false } : {})),
    );
    const rows = await ruleRows(a, ctx.shopId);
    expect(rows).toHaveLength(10);
    expect(rows.find((r) => r.category_key === "marketing")!.rate_basis_points).toBe(900);
    expect(rows.find((r) => r.category_key === "misc")!.enabled).toBe(false);
  });

  it("saveExpenseRules with shipping cleared AND disabled: ok:false + fieldError, and NOTHING is written or changed", async () => {
    const [a] = instances as [Instance];
    const ctx = await a.ensureShopContext(freshDomain("blank"));
    await a.replaceExpenseRulesForShop(ctx, defaultInputs());
    const before = await ruleRows(a, ctx.shopId);

    const rows = defaultInputs().map((r) =>
      r.categoryKey === "shipping"
        ? { ...r, enabled: false, ruleType: "fixed", fixedAmountMinor: null, rateBasisPoints: null, formulaKey: null }
        : r,
    );
    const result = await a.saveExpenseRules(ctx, rows);
    expect(result.ok).toBe(false);
    expect(result.fieldErrors.shipping?.fixedAmountMinor).toBeDefined();
    expect(await ruleRows(a, ctx.shopId)).toEqual(before);
  });
});
