import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from "sequelize";
import { sequelize } from "~/db/sequelize";

export type ComplianceTopic =
  | "customers/data_request"
  | "customers/redact"
  | "shop/redact";
export type ComplianceOutcome = "completed" | "no_op";

// compliance_audit_log — GDPR/compliance evidence (data-model.md §5).
// DELIBERATELY has NO shop_id column and NO FK to `shop` — it must survive
// the shop row's own deletion, which is exactly what it exists to prove
// happened. Never add a shop_id column here; see data-model.md §5 for the
// full reasoning (it would break under the shop/redact cascade the moment
// FT-08's table enumeration "helpfully" included it).
export class ComplianceAuditLogModel extends Model<
  InferAttributes<ComplianceAuditLogModel>,
  InferCreationAttributes<ComplianceAuditLogModel>
> {
  declare id: CreationOptional<string>;
  declare shopDomain: string;
  declare webhookId: string;
  declare topic: ComplianceTopic;
  declare outcome: ComplianceOutcome;
  declare reason: string | null;
  declare deletedRowCounts: Record<string, number> | null;
  declare occurredAt: CreationOptional<Date>;
}

ComplianceAuditLogModel.init(
  {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    shopDomain: { type: DataTypes.TEXT, allowNull: false, field: "shop_domain" },
    webhookId: { type: DataTypes.TEXT, allowNull: false, field: "webhook_id" },
    topic: { type: DataTypes.TEXT, allowNull: false },
    outcome: { type: DataTypes.TEXT, allowNull: false },
    reason: { type: DataTypes.TEXT, allowNull: true },
    deletedRowCounts: { type: DataTypes.JSONB, allowNull: true, field: "deleted_row_counts" },
    occurredAt: { type: DataTypes.DATE, allowNull: false, field: "occurred_at" },
  },
  {
    sequelize,
    modelName: "ComplianceAuditLog",
    tableName: "compliance_audit_log",
    underscored: true,
    timestamps: false,
  },
);
