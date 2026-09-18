// Associations, declared here rather than inline per-model, so the full
// relationship graph is readable in one place. NOTE: repositories still
// apply the shop_id predicate explicitly (ADR-0003) rather than relying on
// an `include:` traversal for tenancy — associations here are for the
// non-tenancy-sensitive convenience queries only (e.g. loading a
// calculation's line items by calculation_id, which is already shop-scoped
// by the calling repository).
//
// Deliberately NO association from CalculationLineItemModel to
// ExpenseRuleModel — there is no FK in the schema (constraint #1) and there
// must be no `include:` path either, or the "no join back to live config"
// guarantee is only true at the SQL layer and false at the ORM layer.

import { sequelize } from "~/db/sequelize";
import { ShopModel } from "~/db/models/shop.model";
import { ExpenseRuleModel } from "~/db/models/expense-rule.model";
import { CalculationModel } from "~/db/models/calculation.model";
import { CalculationLineItemModel } from "~/db/models/calculation-line-item.model";
import { WebhookEventModel } from "~/db/models/webhook-event.model";
import { ComplianceAuditLogModel } from "~/db/models/compliance-audit-log.model";
import { JobHeartbeatModel } from "~/db/models/job-heartbeat.model";

ShopModel.hasMany(ExpenseRuleModel, { foreignKey: "shopId", as: "expenseRules" });
ExpenseRuleModel.belongsTo(ShopModel, { foreignKey: "shopId" });

ShopModel.hasMany(CalculationModel, { foreignKey: "shopId", as: "calculations" });
CalculationModel.belongsTo(ShopModel, { foreignKey: "shopId" });

CalculationModel.hasMany(CalculationLineItemModel, {
  foreignKey: "calculationId",
  as: "lineItems",
});
CalculationLineItemModel.belongsTo(CalculationModel, { foreignKey: "calculationId" });

ShopModel.hasMany(WebhookEventModel, { foreignKey: "shopId", as: "webhookEvents" });
WebhookEventModel.belongsTo(ShopModel, { foreignKey: "shopId" });

// compliance_audit_log has NO association to ShopModel — see the model's own
// header comment and data-model.md §5. Do not add one.

// job_heartbeat has NO association to ShopModel either, for the identical
// reason (ADR-0009 D6, data-model.md §4.7) — it is a global operational
// table, not tenant data. Do not add one.

export {
  sequelize,
  ShopModel,
  ExpenseRuleModel,
  CalculationModel,
  CalculationLineItemModel,
  WebhookEventModel,
  ComplianceAuditLogModel,
  JobHeartbeatModel,
};
