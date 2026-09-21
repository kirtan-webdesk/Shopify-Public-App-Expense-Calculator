import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_EXPENSE_RULES } from "~/domain/expense-rule-defaults";

// Default-CI (DB-free) unit test of the repository's insert-ignore seed
// (G4-sprint-3.4): one bulkCreate, ignoreDuplicates: true => a single
// INSERT ... ON CONFLICT DO NOTHING. Model + Sequelize instance are mocked.

const ctx = { shopId: "11111111-1111-4111-8111-111111111111", shopDomain: "x.myshopify.com" } as never;

const model = vi.hoisted(() => ({
  ExpenseRuleModel: { bulkCreate: vi.fn(), findAll: vi.fn(), findOne: vi.fn(), create: vi.fn() },
}));
vi.mock("~/db/models/expense-rule.model", () => model);
vi.mock("~/db/sequelize", () => ({ sequelize: { transaction: vi.fn() } }));

const inputs = DEFAULT_EXPENSE_RULES.map((d) => ({ ...d, enabled: true }));

describe("seedExpenseRulesIfMissing (repository) — INSERT ... ON CONFLICT DO NOTHING", () => {
  beforeEach(() => model.ExpenseRuleModel.bulkCreate.mockReset());

  it("bulkCreates all rows in ONE statement with ignoreDuplicates: true and no transaction by default", async () => {
    const { seedExpenseRulesIfMissing } = await import("~/db/repositories/expense-rule.repository");
    await seedExpenseRulesIfMissing(ctx, inputs);
    expect(model.ExpenseRuleModel.bulkCreate).toHaveBeenCalledTimes(1);
    const [rows, options] = model.ExpenseRuleModel.bulkCreate.mock.calls[0]!;
    expect(rows).toHaveLength(10);
    expect(options).toEqual({ ignoreDuplicates: true });
    expect(rows.every((r: { shopId: string }) => r.shopId === (ctx as { shopId: string }).shopId)).toBe(true);
    // Values are the defaults, BIGINT as string (same mapping as upsertExpenseRule).
    const shipping = rows.find((r: { categoryKey: string }) => r.categoryKey === "shipping");
    expect(shipping).toMatchObject({ ruleType: "fixed", fixedAmountMinor: "45000", rateBasisPoints: null });
  });

  it("threads a caller-supplied transaction (and only that one) when given", async () => {
    const { seedExpenseRulesIfMissing } = await import("~/db/repositories/expense-rule.repository");
    const tx = { LOCK: {} } as never;
    await seedExpenseRulesIfMissing(ctx, inputs, tx);
    expect(model.ExpenseRuleModel.bulkCreate.mock.calls[0]![1]).toEqual({ ignoreDuplicates: true, transaction: tx });
  });

  it("does nothing for an empty input", async () => {
    const { seedExpenseRulesIfMissing } = await import("~/db/repositories/expense-rule.repository");
    await seedExpenseRulesIfMissing(ctx, []);
    expect(model.ExpenseRuleModel.bulkCreate).not.toHaveBeenCalled();
  });
});
