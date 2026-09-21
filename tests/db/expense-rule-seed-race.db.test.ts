import { randomUUID } from "node:crypto";
import { QueryTypes } from "sequelize";
import { afterAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_EXPENSE_RULES } from "~/domain/expense-rule-defaults";
import { EXPENSE_CATEGORIES } from "~/domain/expense-categories";
import { assertConnectedToTestDatabase, setupTestDatabase } from "../helpers/test-database";

// --------------------------------------------------------------------------
// G4-sprint-3.4 Part A — first-load seed race across serverless instances.
//
// The bug: two first-ever requests for a fresh shop on DIFFERENT instances
// both read "no rules yet", both try to INSERT the same (shop_id,
// category_key) rows; the loser hits uq_expense_rule_shop_category, its
// transaction throws, and the merchant sees an error on first load. (The
// earlier concurrency tests ran on the app's single pool.max:1 Sequelize
// instance, which serialises everything, so they could never see it.)
//
// This suite builds TWO fully independent app module graphs (vi.resetModules
// between imports => two Sequelize singletons => two pools => two real
// Postgres connections/backends), i.e. the same thing two Vercel instances
// are, and races the REAL service code (getOrSeedExpenseRules) on both.
//
// Determinism: a hook on each instance's sequelize.query holds the FIRST
// `SELECT ... FROM "expense_rule"` (the "do rules exist?" read) AFTER it
// returned, until the scenario releases it — so both instances provably read
// "no rules" before either writes, instead of hoping the scheduler
// interleaves them. The SQL each instance issues is captured to prove the
// conflict path was really exercised.
//
// OPT-IN: RUN_DB_TESTS=1 + TEST_DATABASE_URL (separate DB — never
// production; see tests/README.md).
// --------------------------------------------------------------------------

const RUN_DB = setupTestDatabase();

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

type SeqLike = {
  query: (sql: unknown, opts?: unknown) => Promise<unknown>;
  options: { logging?: ((sql: string) => void) | false };
  close(): Promise<void>;
};

interface Instance {
  id: string;
  sequelize: typeof import("~/db/sequelize").sequelize;
  getOrSeedExpenseRules: typeof import("~/services/expense-rule.service").getOrSeedExpenseRules;
  replaceExpenseRulesForShop: typeof import("~/db/repositories/expense-rule.repository").replaceExpenseRulesForShop;
  ensureShopContext: typeof import("~/db/repositories/shop.repository").ensureShopContext;
  sql: string[];
  /** rows returned by this instance's first `FROM "expense_rule"` SELECT */
  firstReadRowCount: number | null;
}

const instances: Instance[] = [];

/** A fully independent app module graph (own Sequelize singleton + pool). */
async function loadInstance(id: string): Promise<Instance> {
  vi.resetModules();
  const seq = await import("~/db/sequelize");
  const [ruleRepo, svc, shopRepo] = await Promise.all([
    import("~/db/repositories/expense-rule.repository"),
    import("~/services/expense-rule.service"),
    import("~/db/repositories/shop.repository"),
  ]);
  const inst: Instance = {
    id,
    sequelize: seq.sequelize,
    getOrSeedExpenseRules: svc.getOrSeedExpenseRules,
    replaceExpenseRulesForShop: ruleRepo.replaceExpenseRulesForShop,
    ensureShopContext: shopRepo.ensureShopContext,
    sql: [],
    firstReadRowCount: null,
  };
  (seq.sequelize as unknown as SeqLike).options.logging = (s: string) => {
    inst.sql.push(String(s));
  };
  instances.push(inst);
  return inst;
}

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/**
 * Holds `inst`'s FIRST `SELECT ... FROM "expense_rule"` after it has returned
 * (so the caller is guaranteed to have already SEEN "no rules"), until
 * `release` resolves. `onRead` fires the moment the read has returned.
 */
function holdAfterFirstRuleRead(inst: Instance, release: Promise<void>, onRead: () => void) {
  const seq = inst.sequelize as unknown as SeqLike;
  const original = seq.query.bind(seq);
  let held = false;
  seq.query = async (sql: unknown, opts?: unknown) => {
    const result = await original(sql, opts);
    const text = typeof sql === "string" ? sql : String((sql as { query?: string }).query ?? "");
    if (!held && /^\s*SELECT[\s\S]*FROM "expense_rule"/i.test(text)) {
      held = true;
      inst.firstReadRowCount = Array.isArray(result) ? result.length : -1;
      onRead();
      await release;
    }
    return result;
  };
}

interface RuleRow {
  id: string;
  category_key: string;
  rule_type: string;
  rate_basis_points: number | null;
  fixed_amount_minor: string | null;
  formula_key: string | null;
  enabled: boolean;
  updated_at: string;
}

async function ruleRows(inst: Instance, shopId: string): Promise<RuleRow[]> {
  return inst.sequelize.query<RuleRow>(
    "SELECT id, category_key, rule_type, rate_basis_points, fixed_amount_minor::text, formula_key, enabled, updated_at::text FROM expense_rule WHERE shop_id = :shopId ORDER BY category_key",
    { replacements: { shopId }, type: QueryTypes.SELECT },
  );
}

function expectedDefaultRow(categoryKey: string) {
  const d = DEFAULT_EXPENSE_RULES.find((r) => r.categoryKey === categoryKey)!;
  return {
    category_key: d.categoryKey,
    rule_type: d.ruleType,
    rate_basis_points: d.rateBasisPoints,
    fixed_amount_minor: d.fixedAmountMinor === null ? null : String(d.fixedAmountMinor),
    formula_key: d.formulaKey,
    enabled: true,
  };
}

function expectExactlyDefaults(rows: RuleRow[]) {
  expect(rows).toHaveLength(EXPENSE_CATEGORIES.length);
  expect(EXPENSE_CATEGORIES.length).toBe(10);
  for (const row of rows) {
    const { id: _id, updated_at: _u, ...rest } = row;
    expect(rest).toEqual(expectedDefaultRow(row.category_key));
  }
}

const usedDomains: string[] = [];
const runId = randomUUID().slice(0, 8);
function freshDomain(label: string): string {
  const d = `seedrace-${runId}-${label}-${randomUUID().slice(0, 8)}.myshopify.com`;
  usedDomains.push(d);
  return d;
}

describe.skipIf(!RUN_DB)("first-load seed race (TWO independent Sequelize pools, real Postgres)", () => {
  afterAll(async () => {
    const [first] = instances;
    if (first) {
      await first.sequelize.query("DELETE FROM shop WHERE shop_domain IN (:d) OR shop_domain LIKE :p", {
        replacements: { d: usedDomains.length ? usedDomains : ["-"], p: `seedrace-${runId}-%` },
      });
      const [left] = await first.sequelize.query<{ c: string }>(
        "SELECT count(*)::text AS c FROM shop WHERE shop_domain LIKE :p",
        { replacements: { p: `seedrace-${runId}-%` }, type: QueryTypes.SELECT },
      );
      expect(Number(left?.c)).toBe(0);
    }
    await Promise.all(instances.map((i) => i.sequelize.close()));
  }, 60_000);

  it("the two instances are genuinely independent pools on genuinely different backend connections", async () => {
    const a = await loadInstance("A");
    const b = await loadInstance("B");
    await assertConnectedToTestDatabase(a.sequelize);
    await assertConnectedToTestDatabase(b.sequelize);
    expect(a.sequelize).not.toBe(b.sequelize);
    expect((a.sequelize as unknown as { options: { pool: { max: number } } }).options.pool.max).toBe(1);
    expect((b.sequelize as unknown as { options: { pool: { max: number } } }).options.pool.max).toBe(1);
    const pid = async (i: Instance) =>
      (await i.sequelize.query<{ pid: number }>("SELECT pg_backend_pid() AS pid", { type: QueryTypes.SELECT }))[0]!.pid;
    expect(await pid(a)).not.toBe(await pid(b));
  });

  it("5 fresh shops: both instances read 'no rules' first, then both seed — both succeed, exactly 10 default rows, no unique violation escapes", async () => {
    const [a, b] = instances as [Instance, Instance];
    for (let i = 0; i < 5; i++) {
      a.sql.length = 0;
      b.sql.length = 0;
      a.firstReadRowCount = null;
      b.firstReadRowCount = null;

      const ctx = await a.ensureShopContext(freshDomain(`race${i}`));

      // Barrier: neither instance may proceed past its existence read until
      // BOTH have completed it (=> both saw zero rules).
      const bothRead = deferred();
      let arrived = 0;
      const onRead = () => {
        if (++arrived === 2) bothRead.resolve();
      };
      holdAfterFirstRuleRead(a, bothRead.promise, onRead);
      holdAfterFirstRuleRead(b, bothRead.promise, onRead);
      // Restore the un-hooked query afterwards is unnecessary: the hook only
      // holds the FIRST rule read per instance and those flags are per-call.
      // (Fresh hook per iteration wraps the previous one; earlier ones are
      // already spent (`held`) and pass straight through.)

      const [viewsA, viewsB] = await Promise.all([a.getOrSeedExpenseRules(ctx), b.getOrSeedExpenseRules(ctx)]);

      // The conflict window was really opened: both saw zero rows before
      // either wrote, and BOTH then attempted to insert the seed.
      expect(a.firstReadRowCount, "instance A's existence read must have seen no rules").toBe(0);
      expect(b.firstReadRowCount, "instance B's existence read must have seen no rules").toBe(0);
      const seedInsertsA = a.sql.filter((s) => /INSERT INTO "expense_rule"/i.test(s));
      const seedInsertsB = b.sql.filter((s) => /INSERT INTO "expense_rule"/i.test(s));
      expect(seedInsertsA.length, `A SQL:\n${a.sql.join("\n")}`).toBeGreaterThanOrEqual(1);
      expect(seedInsertsB.length, `B SQL:\n${b.sql.join("\n")}`).toBeGreaterThanOrEqual(1);
      // ...and every seed insert is insert-ignore-duplicates.
      for (const s of [...seedInsertsA, ...seedInsertsB]) expect(s).toMatch(/ON CONFLICT DO NOTHING/i);

      // Both requests succeeded and both returned the 10 default rules.
      for (const views of [viewsA, viewsB]) {
        expect(views).toHaveLength(10);
        expect(views.map((v) => v.categoryKey).sort()).toEqual(EXPENSE_CATEGORIES.map((c) => c.key).sort());
        for (const v of views) {
          const d = DEFAULT_EXPENSE_RULES.find((r) => r.categoryKey === v.categoryKey)!;
          expect({ t: v.ruleType, r: v.rateBasisPoints, f: v.fixedAmountMinor, k: v.formulaKey, e: v.enabled }).toEqual({
            t: d.ruleType,
            r: d.rateBasisPoints,
            f: d.fixedAmountMinor,
            k: d.formulaKey,
            e: true,
          });
        }
      }

      // Exactly 10 rows, values equal to the defaults.
      expectExactlyDefaults(await ruleRows(a, ctx.shopId));
    }
  });

  it("a rule the winner customised is kept: the loser's seed never overwrites it", async () => {
    const [a, b] = instances as [Instance, Instance];
    a.sql.length = 0;
    b.sql.length = 0;
    const ctx = await a.ensureShopContext(freshDomain("keep"));

    // B reads "no rules" and is then held. Meanwhile A (the winner) seeds AND
    // the merchant customises Marketing; only then is B released to run its
    // own seed + re-read.
    const gate = deferred();
    const bRead = deferred();
    holdAfterFirstRuleRead(b, gate.promise, () => bRead.resolve());
    const loser = b.getOrSeedExpenseRules(ctx);
    await bRead.promise;
    expect(b.firstReadRowCount).toBe(0);

    await a.getOrSeedExpenseRules(ctx);
    const customised = DEFAULT_EXPENSE_RULES.map((d) => ({
      categoryKey: d.categoryKey,
      ruleType: d.ruleType,
      rateBasisPoints: d.categoryKey === "marketing" ? 4242 : d.rateBasisPoints,
      fixedAmountMinor: d.fixedAmountMinor,
      formulaKey: d.formulaKey,
      enabled: d.categoryKey === "misc" ? false : true,
    }));
    await a.replaceExpenseRulesForShop(ctx, customised);
    const before = await ruleRows(a, ctx.shopId);
    expect(before.find((r) => r.category_key === "marketing")!.rate_basis_points).toBe(4242);
    expect(before.find((r) => r.category_key === "misc")!.enabled).toBe(false);

    gate.resolve();
    const loserViews = await loser; // must not throw

    // The loser's own seed insert really ran (and conflicted every row)...
    const loserInserts = b.sql.filter((s) => /INSERT INTO "expense_rule"/i.test(s));
    expect(loserInserts.length, `B SQL:\n${b.sql.join("\n")}`).toBeGreaterThanOrEqual(1);
    for (const s of loserInserts) expect(s).toMatch(/ON CONFLICT DO NOTHING/i);

    // ...and changed NOTHING: same rows (ids), same values, same updated_at.
    const after = await ruleRows(a, ctx.shopId);
    expect(after).toEqual(before);
    expect(after).toHaveLength(10);

    // The loser returns the winner's customised values, not the defaults.
    expect(loserViews.find((v) => v.categoryKey === "marketing")!.rateBasisPoints).toBe(4242);
    expect(loserViews.find((v) => v.categoryKey === "misc")!.enabled).toBe(false);
  });
});
