import type { SavedCalculationView } from "~/services/calculation-history.service";
import { formatMoney, formatSavedAt } from "~/domain/presentation";
import { ExpenseBreakdown, SummaryField } from "~/components/expense-breakdown";

// The saved-calculation detail page body (design/mockup/history-detail.html).
//
// FROZEN-SNAPSHOT signals (G2 design note §4.4), all present here:
//   1. an explicit-copy banner at the very top, before any number, stating
//      the save timestamp and that later rule edits are NOT reflected;
//   2. a lock-icon "Snapshot" badge beside the stored engine_version;
//   3. every value is plain text — there is NO form control, NO input, and NO
//      Save button anywhere on this page (the absence of an editable
//      affordance is the WCAG-robust part of the signal; disabled inputs are
//      an AA trap, so none are used);
//   4. the only forward action is "Duplicate as new calculation", a plain
//      link that loads these inputs into the calculator as a NEW, UNSAVED
//      calculation — it cannot edit this record.
//
// Everything rendered is a pure function of the `saved` prop, which the
// service rebuilds from STORED columns only. This component performs no
// calculation, reads no live rule, and has no data-fetching of its own —
// which is what makes the FT-14a "byte-identical after live rules change"
// test meaningful (it renders this component before and after).

function LockIcon({ size }: { readonly size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5 7V5a3 3 0 016 0v2" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

export function SavedCalculationPage({ saved }: { readonly saved: SavedCalculationView }) {
  const { result } = saved;
  const savedAt = formatSavedAt(saved.savedAtIso);

  return (
    <s-page heading="Saved calculation">
      <s-link slot="breadcrumb-actions" href="/app/history">
        History
      </s-link>

      <s-section>
        <s-banner tone="info" heading="This is a saved snapshot">
          <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
            <LockIcon size={18} />
            <p>
              Saved <strong>{savedAt}</strong> using the revenue and rule values active at that
              moment. If you&apos;ve changed your category rules since then, those changes are{" "}
              <strong>not</strong> reflected below — this record won&apos;t change.{" "}
              <s-link href="/app/calculator">View my current rules</s-link>
            </p>
          </div>
        </s-banner>
      </s-section>

      <s-section>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBlockEnd: "12px" }}>
          <s-badge tone="info">
            <LockIcon size={12} />
            Snapshot
          </s-badge>
          <span style={{ color: "var(--p-color-text-secondary, #616161)", fontSize: "0.8125rem" }}>
            Engine version {saved.engineVersion}
          </span>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "20px" }}>
          <SummaryField label="Revenue (as saved)" value={formatMoney(result.revenueMinor, result.currencyCode)} />
          <SummaryField
            label="Total expenses (as saved)"
            value={formatMoney(result.totalExpensesMinor, result.currencyCode)}
          />
          <SummaryField
            label="Net (as saved)"
            value={formatMoney(result.netAmountMinor, result.currencyCode)}
            negative={result.netAmountMinor < 0}
          />
          <SummaryField label="Currency" value={result.currencyCode} />
        </div>
      </s-section>

      <s-section heading="Expense breakdown, as saved">
        <ExpenseBreakdown
          result={result}
          caption="Category values as they were applied at save time — editing your current rules will not change these rows."
          ruleColumnHeading="Rule applied (at save time)"
        />
      </s-section>

      <s-section>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px" }}>
          <s-button href="/app/history">Back to history</s-button>
          <s-button variant="primary" href={`/app/calculator?from=${saved.id}`}>
            Duplicate as new calculation
          </s-button>
        </div>
        <p
          style={{
            color: "var(--p-color-text-secondary, #616161)",
            fontSize: "0.8125rem",
            textAlign: "right",
          }}
        >
          Starts a fresh calculation pre-filled with these values — it won&apos;t edit this saved
          record.
        </p>
      </s-section>
    </s-page>
  );
}
