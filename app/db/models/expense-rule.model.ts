import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from "sequelize";
import { sequelize } from "~/db/sequelize";

export type RuleType = "percentage" | "fixed" | "formula";

// expense_rule — per-shop configured rule per fixed category
// (data-model.md §4.2). Mutable; this is the LIVE config a saved
// calculation's line items must never join back to (constraint #1).
export class ExpenseRuleModel extends Model<
  InferAttributes<ExpenseRuleModel>,
  InferCreationAttributes<ExpenseRuleModel>
> {
  declare id: CreationOptional<string>;
  declare shopId: string;
  declare categoryKey: string;
  declare ruleType: RuleType;
  declare rateBasisPoints: number | null;
  declare fixedAmountMinor: string | null; // BIGINT surfaces as string in pg
  declare formulaKey: string | null;
  declare enabled: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

ExpenseRuleModel.init(
  {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    shopId: { type: DataTypes.UUID, allowNull: false, field: "shop_id" },
    categoryKey: { type: DataTypes.TEXT, allowNull: false, field: "category_key" },
    ruleType: { type: DataTypes.TEXT, allowNull: false, field: "rule_type" },
    rateBasisPoints: { type: DataTypes.INTEGER, allowNull: true, field: "rate_basis_points" },
    fixedAmountMinor: { type: DataTypes.BIGINT, allowNull: true, field: "fixed_amount_minor" },
    formulaKey: { type: DataTypes.TEXT, allowNull: true, field: "formula_key" },
    enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, allowNull: false, field: "updated_at" },
  },
  {
    sequelize,
    modelName: "ExpenseRule",
    tableName: "expense_rule",
    underscored: true,
    timestamps: true,
  },
);
