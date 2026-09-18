import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from "sequelize";
import { sequelize } from "~/db/sequelize";

export type WebhookTopic =
  | "customers/data_request"
  | "customers/redact"
  | "shop/redact"
  | "app/uninstalled";

// webhook_event — the durable inbox (ADR-0002, data-model.md §4.5). The
// UNIQUE index on webhook_id IS the dedup mechanism: a replayed delivery
// hits the DB constraint and is swallowed, not application logic that can be
// forgotten on a new topic.
export class WebhookEventModel extends Model<
  InferAttributes<WebhookEventModel>,
  InferCreationAttributes<WebhookEventModel>
> {
  declare id: CreationOptional<string>;
  declare webhookId: string;
  declare shopId: string;
  declare shopDomain: string;
  declare topic: WebhookTopic;
  declare payload: Record<string, unknown>;
  declare receivedAt: CreationOptional<Date>;
  declare processedAt: Date | null;
  declare attempts: CreationOptional<number>;
  declare lastError: string | null;
}

WebhookEventModel.init(
  {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    webhookId: { type: DataTypes.TEXT, allowNull: false, unique: true, field: "webhook_id" },
    shopId: { type: DataTypes.UUID, allowNull: false, field: "shop_id" },
    shopDomain: { type: DataTypes.TEXT, allowNull: false, field: "shop_domain" },
    topic: { type: DataTypes.TEXT, allowNull: false },
    payload: { type: DataTypes.JSONB, allowNull: false },
    receivedAt: { type: DataTypes.DATE, allowNull: false, field: "received_at" },
    processedAt: { type: DataTypes.DATE, allowNull: true, field: "processed_at" },
    attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    lastError: { type: DataTypes.TEXT, allowNull: true, field: "last_error" },
  },
  {
    sequelize,
    modelName: "WebhookEvent",
    tableName: "webhook_event",
    underscored: true,
    timestamps: false,
  },
);
