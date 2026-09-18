import type { Transaction } from "sequelize";
import { recordComplianceOutcome } from "~/db/repositories/compliance-audit-log.repository";

const NO_CUSTOMER_DATA_REASON =
  "this app stores no customer-identified data (revenue is merchant-entered, " +
  "not read from orders — spec.md §4, ADR-0006); the compiled report to the " +
  "store owner states that no records exist for the requested customer.";

/**
 * customers/data_request — ADR-0008 step 4 / spec.md §10. Ack fast (the
 * webhook route's job — authenticate.webhook + inbox insert), then compile
 * and deliver to the STORE OWNER within the 30-day window (not to the
 * customer directly — that is the documented Shopify pattern).
 *
 * KNOWN GAP, flagged rather than silently built around: no email/notification
 * transport is specified anywhere in spec.md, the architecture packet, or
 * any ADR. Nothing in D1–D16 scopes an outbound-delivery mechanism (this app
 * sends no merchant-facing email at all otherwise). Since the app holds no
 * customer-identified data, the "delivery" content is fixed and trivial (a
 * statement that no records exist), so this handler compiles and records
 * that statement as the completed audit outcome now. But the actual
 * transport — how the store owner is notified — is NOT decided here and
 * NOT invented. This is real, gate-relevant open work: an ADR or spec
 * amendment is needed before G-Review to pick a delivery mechanism (Partner
 * Dashboard message? transactional email? a merchant-visible in-app record?)
 * and confirm it satisfies "deliver to the store owner" as Shopify defines
 * it. Tracked here rather than guessed at.
 *
 * ADR-0010 fix (found live, G1.5-revision): same fix as
 * customers-redact.service.ts — this handler now threads the caller's
 * transaction through recordComplianceOutcome instead of letting it open a
 * second, standalone connection, which deadlocked against pool.max:1 while
 * the caller (claimAndProcessOne) still held the pool's one connection for
 * its own outer/savepoint transaction. See that file's comment for the full
 * live-reproduction details (identical failure mode, confirmed on this
 * topic's own seeded row too).
 */
export async function handleCustomersDataRequest(
  shopDomain: string,
  webhookId: string,
  transaction: Transaction,
): Promise<void> {
  await recordComplianceOutcome(
    {
      shopDomain,
      webhookId,
      topic: "customers/data_request",
      outcome: "completed",
      reason: NO_CUSTOMER_DATA_REASON,
    },
    transaction,
  );
}
