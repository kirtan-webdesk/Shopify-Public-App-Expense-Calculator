import type { SavedCalculationView } from "~/services/calculation-history.service";
import { formatSavedAt } from "~/domain/presentation";
import { ExpenseBreakdown, MetricTiles } from "~/components/expense-breakdown";

// The saved-calculation detail page body (design/v2/history-detail.html).
//
// FROZEN-SNAPSHOT signals (G2 design note), layered so none relies on colour,
// all present here:
//   1. an explicit-copy banner at the very top, before any number, stating
//      the save timestamp and that later rule edits are NOT reflected;
//   2. a lock-icon "Snapshot" badge beside the stored engine_version;
//   3. every value is plain text - there is NO form control, NO input, and NO
//      Save button anywhere on this page (the absence of an editable
//      affordance is the WCAG-robust part of the signal; disabled inputs are
//      an AA trap, so none are used);
//   4. the only forward action is "Duplicate as new calculation", a plain
//      link that starts a NEW, UNSAVED calculation from this snapshot's
//      revenue and currency (J6) - it cannot edit this record.
//
// Everything rendered is a pure function of the `saved` prop, which the
// service rebuilds from STORED columns only. This component performs no
// calculation, reads no live rule, and has no data-fetching of its own -
// which is what makes the FT-14a "byte-identical after live rules change"
// test meaningful (it renders this component before and after).

export function SavedCalculationPage({
  saved,
  justSaved = false,
}: {
  readonly saved: SavedCalculationView;
  /** True only on the redirect straight after Save (`?saved=1`). */
  readonly justSaved?: boolean;
}) {
  const { result } = saved;
  const savedAt = formatSavedAt(saved.savedAtIso);

  return (
    <s-page heading="Saved calculation">
      <s-link slot="breadcrumb-actions" href="/app/history">
        History
      </s-link>
      {/* No primary action and no Save anywhere: the absence of an editable
          affordance is part of the frozen signal. */}
      <s-button slot="secondary-actions" href={`/app/calculator?from=${saved.id}`}>
        Duplicate as new calculation
      </s-button>

      <s-stack gap="base">
        {justSaved && (
          <s-banner tone="success" heading="Calculation saved" dismissible>
            <s-paragraph>It now appears in your History.</s-paragraph>
          </s-banner>
        )}

        <s-banner tone="info" heading="This is a saved snapshot">
          <s-paragraph>
            Saved <strong>{savedAt}</strong> using the revenue and rule values active at that moment. If you&apos;ve
            changed your rules since, those changes are <strong>not</strong> reflected here, and this record won&apos;t
            change. <s-link href="/app/rules">View my current rules</s-link>
          </s-paragraph>
        </s-banner>

        <s-section>
          <s-stack gap="base">
            <s-stack direction="inline" gap="small" alignItems="center">
              <s-badge tone="info" icon="lock">
                Snapshot
              </s-badge>
              <s-text color="subdued">Engine version {saved.engineVersion}</s-text>
            </s-stack>
            <MetricTiles
              result={result}
              labels={{ revenue: "Revenue (as saved)", total: "Total expenses (as saved)", net: "Net (as saved)" }}
            />
          </s-stack>
        </s-section>

        <s-section heading="Expense breakdown, as saved">
          <ExpenseBreakdown
            result={result}
            ruleColumnHeading="Rule applied (at save time)"
          />
        </s-section>
      </s-stack>
    </s-page>
  );
}
