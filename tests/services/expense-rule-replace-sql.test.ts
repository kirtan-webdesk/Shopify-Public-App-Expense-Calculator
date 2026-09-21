import { afterAll, describe, expect, it, vi } from "vitest";

// DB-FREE check of the REAL SQL Sequelize generates for replaceExpenseRulesForShop
// (G4-sprint-3.5 C): the connection is never opened — `sequelize.query` is
// intercepted, so no database is contacted. It proves the statement is one
// multi-row INSERT ... ON CONFLICT ("shop_id","category_key") DO UPDATE against
// the real unique key. The concurrent behaviour itself is exercised by the
// opt-in tests/db/expense-rule-save-race.db.test.ts.

vi.stubEnv("DATABASE_URL", "postgres://nobody:nothing@127.0.0.1:1/never_connected");
vi.stubEnv("DIRECT_DATABASE_URL", "postgres://nobody:nothing@127.0.0.1:1/never_connected");

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("replaceExpenseRulesForShop — generated SQL", () => {
  it("is ONE multi-row INSERT with ON CONFLICT (shop_id, category_key) DO UPDATE (not insert-ignore, not find-then-create)", async () => {
    const { sequelize } = await import("~/db/sequelize");
    const seen: string[] = [];
    vi.spyOn(sequelize, "query").mockImplementation((async (sql: unknown) => {
      seen.push(typeof sql === "string" ? sql : String((sql as { query?: string }).query ?? ""));
      return [[], 0];
    }) as never);

    const { replaceExpenseRulesForShop } = await import("~/db/repositories/expense-rule.repository");
    await replaceExpenseRulesForShop({ shopId: "11111111-1111-4111-8111-111111111111", shopDomain: "x.myshopify.com" } as never, [
      { categoryKey: "shipping", ruleType: "fixed", rateBasisPoints: null, fixedAmountMinor: 45000, formulaKey: null, enabled: false },
      { categoryKey: "marketing", ruleType: "percentage", rateBasisPoints: 800, fixedAmountMinor: null, formulaKey: null, enabled: true },
    ]);

    expect(seen).toHaveLength(1); // a single statement: no SELECT, no BEGIN/COMMIT
    const sql = seen[0]!;
    expect(sql).toMatch(/^INSERT INTO "expense_rule"/);
    expect(sql).toMatch(/ON CONFLICT \("shop_id","category_key"\) DO UPDATE SET/);
    expect(sql).not.toMatch(/DO NOTHING/);
    for (const col of ["rule_type", "rate_basis_points", "fixed_amount_minor", "formula_key", "enabled", "updated_at"]) {
      expect(sql).toContain(`"${col}"=EXCLUDED."${col}"`);
    }
    // created_at is set on insert only — never overwritten by a later save
    expect(sql).not.toContain('"created_at"=EXCLUDED');
    // rows in category_key order (marketing before shipping) regardless of input order
    expect(sql.indexOf("'marketing'")).toBeLessThan(sql.indexOf("'shipping'"));
  });
});
