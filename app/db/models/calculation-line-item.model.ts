import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from "sequelize";
import { sequelize } from "~/db/sequelize";
import type { RuleType } from "~/db/models/expense-rule.model";

// calculation_line_item — per-category result + the snapshotted rule AS
// APPLIED (data-model.md §4.4). Deliberately NO FK to expense_rule
// (constraint #1) — every describing value is copied by value at save time,
// so there is no join path back to live config for the engine or history
// view to accidentally take. Append-only, same as `calculation`.
export class CalculationLineItemModel extends Model<
  InferAttributes<CalculationLineItemModel>,
  InferCreationAttributes<CalculationLineItemModel>
> {
  declare id: CreationOptional<string>;
  declare calculationId: string;
  declare shopId: string; // denormalized on purpose (architecture packet §8.3)
  declare categoryKey: string;
  declare categoryLabelAtSave: string;
  declare ruleTypeAtSave: RuleType;
  declare rateBasisPointsAtSave: number | null;
  declare fixedAmountMinorAtSave: string | null;
  declare formulaKeyAtSave: string | null;
  declare ruleSnapshot: Record<string, unknown>;
  declare computedAmountMinor: string; // BIGINT
  declare sortOrder: number;
  declare createdAt: CreationOptional<Date>;
}

CalculationLineItemModel.init(
  {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    calculationId: { type: DataTypes.UUID, allowNull: false, field: "calculation_id" },
    shopId: { type: DataTypes.UUID, allowNull: false, field: "shop_id" },
    categoryKey: { type: DataTypes.TEXT, allowNull: false, field: "category_key" },
    categoryLabelAtSave: { type: DataTypes.TEXT, allowNull: false, field: "category_label_at_save" },
    ruleTypeAtSave: { type: DataTypes.TEXT, allowNull: false, field: "rule_type_at_save" },
    rateBasisPointsAtSave: { type: DataTypes.INTEGER, allowNull: true, field: "rate_basis_points_at_save" },
    fixedAmountMinorAtSave: { type: DataTypes.BIGINT, allowNull: true, field: "fixed_amount_minor_at_save" },
    formulaKeyAtSave: { type: DataTypes.TEXT, allowNull: true, field: "formula_key_at_save" },
    ruleSnapshot: { type: DataTypes.JSONB, allowNull: false, field: "rule_snapshot" },
    computedAmountMinor: { type: DataTypes.BIGINT, allowNull: false, field: "computed_amount_minor" },
    sortOrder: { type: DataTypes.SMALLINT, allowNull: false, field: "sort_order" },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
  },
  {
    sequelize,
    modelName: "CalculationLineItem",
    tableName: "calculation_line_item",
    underscored: true,
    timestamps: true,
    updatedAt: false,
  },
);
