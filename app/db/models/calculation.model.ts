import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from "sequelize";
import { sequelize } from "~/db/sequelize";

// calculation — a saved, APPEND-ONLY calculation (data-model.md §4.3). No
// `update()` is exposed on the repository for this model, and the DB itself
// rejects UPDATE via a BEFORE UPDATE trigger (migration §"Append-only
// enforcement") — belt and suspenders per ADR-0003's own admission that "the
// database will not save us" from a raw-query bypass.
export class CalculationModel extends Model<
  InferAttributes<CalculationModel>,
  InferCreationAttributes<CalculationModel>
> {
  declare id: CreationOptional<string>;
  declare shopId: string;
  declare revenueMinor: string; // BIGINT
  declare currencyCode: string;
  declare totalExpensesMinor: string; // BIGINT
  declare netAmountMinor: string; // BIGINT
  declare engineVersion: string;
  declare createdAt: CreationOptional<Date>;
}

CalculationModel.init(
  {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    shopId: { type: DataTypes.UUID, allowNull: false, field: "shop_id" },
    revenueMinor: { type: DataTypes.BIGINT, allowNull: false, field: "revenue_minor" },
    currencyCode: { type: DataTypes.TEXT, allowNull: false, field: "currency_code" },
    totalExpensesMinor: { type: DataTypes.BIGINT, allowNull: false, field: "total_expenses_minor" },
    netAmountMinor: { type: DataTypes.BIGINT, allowNull: false, field: "net_amount_minor" },
    engineVersion: { type: DataTypes.TEXT, allowNull: false, field: "engine_version" },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
  },
  {
    sequelize,
    modelName: "Calculation",
    tableName: "calculation",
    underscored: true,
    timestamps: true,
    updatedAt: false, // append-only — there is nothing to update (data-model.md §4.3)
  },
);
