import { recordComplianceOutcome } from "~/db/repositories/compliance-audit-log.repository";

const NO_CUSTOMER_DATA_REASON =
  "this app stores no customer-identified data; the app holds no records " +
  "keyed to a customer (revenue is merchant-entered, not read from orders — " +
  "see spec.md §4, ADR-0006).";

/**
 * customers/redact — ADR-0008 step 4. The app stores no customer PII, so
 * there is nothing to delete, but that does NOT make this a stub: it must
 * verify HMAC (handled by authenticate.webhook before this is called), dedup
 * (handled by the inbox's unique webhook_id), and execute a documented,
 * logged no-op with a stated reason — the exact thing G-Review asks for.
 *
 * Legal-retention exception (ADR-0008 context) does not apply here: nothing
 * is retained for legal reasons, because nothing customer-identified is
 * stored in the first place.
 */
export async function handleCustomersRedact(
  shopDomain: string,
  webhookId: string,
): Promise<void> {
  await recordComplianceOutcome({
    shopDomain,
    webhookId,
    topic: "customers/redact",
    outcome: "no_op",
    reason: NO_CUSTOMER_DATA_REASON,
  });
}
