import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_EXPENSE_RULES } from "~/domain/expense-rule-defaults";

// Default-CI (DB-free) unit test of the repository's conflict-safe save
// (G4-sprint-3.5 C): ONE bulkCreate with ON CONFLICT (shop_id, category_key)
// DO UPDATE — never find-then-create — and no transaction / second connection
// (app pool.max is 1). Model + Sequelize instance are mocked; the real SQL is
// covered by tests/db/expense-rule-save-race.db.test.ts (opt-in).

const ctx = { shopId: "11111111-1111-4111-8111-111111111111", shopDomain: "x.myshopify.com" } as never;

const model = vi.hoisted(() => ({
  ExpenseRuleModel: { bulkCreate: vi.fn(), findAll: vi.fn(), findOne: vi.fn(), create: vi.fn() },
}));
const seq = vi.hoisted(() => ({ sequelize: { transaction: vi.fn() } }));
vi.mock("~/db/models/expense-rule.model", () => model);
vi.mock("~/db/sequelize", () => seq);

const inputs = DEFAULT_EXPENSE_RULES.map((d) => ({ ...d, enabled: true }));

describe("replaceExpenseRulesForShop (repository) — INSERT ... ON CONFLICT (shop_id, category_key) DO UPDATE", () => {
  beforeEach(() => {
    model.ExpenseRuleModel.bulkCreate.mockReset();
    model.ExpenseRuleModel.findOne.mockReset();
    model.ExpenseRuleModel.create.mockReset();
    seq.sequelize.transaction.mockReset();
  });

  it("writes all rows in ONE statement targeting the real unique key, updating every value column", async () => {
    const { replaceExpenseRulesForShop } = await import("~/db/repositories/expense-rule.repository");
    await replaceExpenseRulesForShop(ctx, inputs);
    expect(model.ExpenseRuleModel.bulkCreate).toHaveBeenCalledTimes(1);
    const [rows, options] = model.ExpenseRuleModel.bulkCreate.mock.calls[0]!;
    expect(rows).toHaveLength(10);
    expect(options.conflictAttributes).toEqual(["shopId", "categoryKey"]);
    expect(options.updateOnDuplicate).toEqual([
      "ruleType",
      "rateBasisPoints",
      "fixedAmountMinor",
      "formulaKey",
      "enabled",
      "updatedAt",
    ]);
    // ...and it is NOT insert-ignore (that would silently drop the merchant's edit).
    expect(options.ignoreDuplicates).toBeUndefined();
    expect(rows.every((r: { shopId: string }) => r.shopId === (ctx as { shopId: string }).shopId)).toBe(true);
  });

  it("never does a find-then-create and never opens a transaction (no second connection under pool.max:1)", async () => {
    const { replaceExpenseRulesForShop } = await import("~/db/repositories/expense-rule.repository");
    await replaceExpenseRulesForShop(ctx, inputs);
    expect(model.ExpenseRuleModel.findOne).not.toHaveBeenCalled();
    expect(model.ExpenseRuleModel.create).not.toHaveBeenCalled();
    expect(seq.sequelize.transaction).not.toHaveBeenCalled();
    expect(model.ExpenseRuleModel.bulkCreate.mock.calls[0]![1]).not.toHaveProperty("transaction");
  });

  it("threads a caller-supplied transaction, and only that one", async () => {
    const { replaceExpenseRulesForShop } = await import("~/db/repositories/expense-rule.repository");
    const tx = { LOCK: {} } as never;
    await replaceExpenseRulesForShop(ctx, inputs, tx);
    expect(model.ExpenseRuleModel.bulkCreate.mock.calls[0]![1].transaction).toBe(tx);
    expect(seq.sequelize.transaction).not.toHaveBeenCalled();
  });

  it("writes rows in a fixed category_key order so concurrent saves lock rows in the same order", async () => {
    const { replaceExpenseRulesForShop } = await import("~/db/repositories/expense-rule.repository");
    await replaceExpenseRulesForShop(ctx, [...inputs].reverse());
    const keys = model.ExpenseRuleModel.bulkCreate.mock.calls[0]![0].map((r: { categoryKey: string }) => r.categoryKey);
    expect(keys).toEqual([...keys].sort());
  });

  it("maps values like the seed path: BIGINT fixed amount as a string, inactive rule types null", async () => {
    const { replaceExpenseRulesForShop } = await import("~/db/repositories/expense-rule.repository");
    await replaceExpenseRulesForShop(ctx, inputs);
    const rows = model.ExpenseRuleModel.bulkCreate.mock.calls[0]![0];
    const shipping = rows.find((r: { categoryKey: string }) => r.categoryKey === "shipping");
    expect(shipping).toMatchObject({ ruleType: "fixed", fixedAmountMinor: "45000", rateBasisPoints: null, formulaKey: null });
  });

  it("does nothing for an empty input", async () => {
    const { replaceExpenseRulesForShop } = await import("~/db/repositories/expense-rule.repository");
    await replaceExpenseRulesForShop(ctx, []);
    expect(model.ExpenseRuleModel.bulkCreate).not.toHaveBeenCalled();
  });
});
