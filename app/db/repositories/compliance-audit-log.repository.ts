import type { Transaction } from "sequelize";
import { ComplianceAuditLogModel, type ComplianceOutcome, type ComplianceTopic } from "~/db/models/compliance-audit-log.model";

// compliance-audit-log.repository — deliberately does NOT take a
// ShopContext. See the model's own header and data-model.md §5: this table
// must survive the shop row's deletion, so it is correlated by plain-text
// shop_domain, never by a shop_id FK.

export interface RecordComplianceOutcomeInput {
  readonly shopDomain: string;
  readonly webhookId: string;
  readonly topic: ComplianceTopic;
  readonly outcome: ComplianceOutcome;
  readonly reason?: string | null;
  readonly deletedRowCounts?: Record<string, number> | null;
}

/**
 * UNIQUE (webhook_id, topic) means a replayed delivery writes at most one
 * audit row (FT-08b's "second delivery is a safe no-op," extended to the
 * audit trail itself) — a duplicate insert is caught and swallowed, not
 * treated as an error.
 */
export async function recordComplianceOutcome(
  input: RecordComplianceOutcomeInput,
  transaction?: Transaction,
): Promise<void> {
  const existing = await ComplianceAuditLogModel.findOne({
    where: { webhookId: input.webhookId, topic: input.topic },
    transaction,
  });
  if (existing) return;

  await ComplianceAuditLogModel.create(
    {
      shopDomain: input.shopDomain,
      webhookId: input.webhookId,
      topic: input.topic,
      outcome: input.outcome,
      reason: input.reason ?? null,
      deletedRowCounts: input.deletedRowCounts ?? null,
      occurredAt: new Date(),
    },
    { transaction },
  );
}
