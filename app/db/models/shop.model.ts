import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from "sequelize";
import { sequelize } from "~/db/sequelize";

// shop — the tenant root (data-model.md §4.1). No shop_id column on itself;
// it IS the tenant key every other table's shop_id references.
export class ShopModel extends Model<
  InferAttributes<ShopModel>,
  InferCreationAttributes<ShopModel>
> {
  declare id: CreationOptional<string>;
  declare shopDomain: string;
  declare installedAt: CreationOptional<Date>;
  declare uninstalledAt: Date | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

ShopModel.init(
  {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    shopDomain: { type: DataTypes.TEXT, allowNull: false, unique: true, field: "shop_domain" },
    installedAt: { type: DataTypes.DATE, allowNull: false, field: "installed_at" },
    uninstalledAt: { type: DataTypes.DATE, allowNull: true, field: "uninstalled_at" },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, allowNull: false, field: "updated_at" },
  },
  {
    sequelize,
    modelName: "Shop",
    tableName: "shop",
    underscored: true,
    timestamps: true,
  },
);
