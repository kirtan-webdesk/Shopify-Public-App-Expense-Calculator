import { useRef } from "react";
import { Form, redirect, useActionData, useNavigation } from "react-router";
import type { Route } from "./+types/app.results";
import { authenticate } from "~/shopify.server";
import { requireShopContext } from "~/services/shop-context.service";
import { saveCalculationFromTransport } from "~/services/calculation-history.service";
import { decodeCalculationResult } from "~/domain/calculation-transport";
import { formatMoney } from "~/domain/presentation";
import { ExpenseBreakdown, SummaryField } from "~/components/expense-breakdown";

// --------------------------------------------------------------------------
// /app/results — M3 results view + M4 "Save this calculation" (D10).
//
// Ports design/mockup/results.html (G2-confirmed): the accessible data table
// is the PRIMARY, always-rendered representation (ADR-0004) and the inline
// SVG donut is supplementary — both live in app/components/expense-breakdown
// and are shared with the saved-calculation detail page. The mockup's
// dev-only fixture-data-swap dropdown was stripped at G3 and is NOT
// reintroduced here.
//
// The loader does NOT read from the database: the result it renders comes
// from the `d` query parameter the calculator's "Calculate" action produced
// (app/domain/calculation-transport.ts) — a non-persisted live preview.
//
// Saving is a POST to this route's action, confirmed through an <s-modal>
// (the mockup's save-confirmation step; saving is permanent, so it is
// confirmed rather than fired directly). The action NEVER persists the
// transported amounts: saveCalculationFromTransport re-validates the inputs,
// recomputes with the pure engine, and rejects a payload whose amounts do
// not match. The shop identity comes from the authenticated session, never
// from the form.
// --------------------------------------------------------------------------

const SAVE_MODAL_ID = "save-calculation-modal";

export async function loader({ request }: Route.LoaderArgs) {
  await authenticate.admin(request);
  const url = new URL(request.url);
  const encoded = url.searchParams.get("d");
  const result = encoded ? decodeCalculationResult(encoded) : null;
  // `encoded` is handed back only when it decoded — it is what the Save form
  // posts, so the server re-verifies exactly the calculation the merchant saw.
  return { result, encoded: result ? encoded : null };
}

interface SaveActionError {
  readonly ok: false;
  readonly message: string;
}

export async function action({ request }: Route.ActionArgs) {
  const { session } = await authenticate.admin(request);
  const ctx = await requireShopContext(session);

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  if (intent !== "save") {
    throw new Response(`Unknown intent "${intent}".`, { status: 400 });
  }

  const saved = await saveCalculationFromTransport(ctx, String(formData.get("d") ?? ""));
  if (!saved.ok) {
    const error: SaveActionError = { ok: false, message: saved.message };
    return error;
  }
  return redirect(`/app/history/${saved.id}?saved=1`);
}

export default function ResultsPage({ loaderData }: Route.ComponentProps) {
  const { result, encoded } = loaderData;
  const actionData = useActionData<typeof action>() as SaveActionError | undefined;
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";
  const formRef = useRef<HTMLFormElement>(null);

  if (!result || !encoded) {
    return (
      <s-page heading="Results">
        <s-link slot="breadcrumb-actions" href="/app/calculator">
          Calculator
        </s-link>
        <s-section>
          <s-banner tone="info" heading="No calculation yet">
            <p>
              Run a calculation from the Calculator page to see results here. Nothing is saved
              automatically — this page only shows the most recent Calculate you ran.
            </p>
          </s-banner>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading="Results">
      <s-link slot="breadcrumb-actions" href="/app/calculator">
        Calculator
      </s-link>

      {/* Save-confirmation modal (App Bridge/Polaris <s-modal>, not a bespoke
          dialog). The primary action hides the modal and submits the hidden
          form below; the form is outside the modal so it exists regardless of
          the modal's own rendering. */}
      <s-modal id={SAVE_MODAL_ID} heading="Save this calculation?">
        <p>
          This creates a permanent record of today&apos;s revenue figure and the rule values used
          to calculate it. It will <strong>not</strong> update later if you edit your category
          rules — that&apos;s by design, so past calculations stay comparable.
        </p>
        <s-button
          slot="primary-action"
          variant="primary"
          commandFor={SAVE_MODAL_ID}
          command="--hide"
          disabled={isSaving}
          onClick={() => formRef.current?.requestSubmit()}
        >
          Save calculation
        </s-button>
        <s-button slot="secondary-actions" commandFor={SAVE_MODAL_ID} command="--hide">
          Cancel
        </s-button>
      </s-modal>

      <Form method="post" ref={formRef}>
        <input type="hidden" name="intent" value="save" />
        <input type="hidden" name="d" value={encoded} />
      </Form>

      {actionData && !actionData.ok && (
        <s-section>
          <s-banner tone="critical" heading="Calculation not saved">
            <p>{actionData.message}</p>
          </s-banner>
        </s-section>
      )}

      <s-section>
        <s-banner tone="warning" heading="Estimate only — not saved yet">
          <p>
            This is a live preview using the rule values from the Calculator page, including any
            unsaved edits. Select <strong>Save this calculation</strong> to keep a permanent
            snapshot of it in your history. Any rule you have not edited still uses its
            illustrative placeholder default, so treat the figures below as an estimate.
          </p>
        </s-banner>
      </s-section>

      <s-section>
        <div className="summary-row summary-row--spread">
          <SummaryField label="Revenue" value={formatMoney(result.revenueMinor, result.currencyCode)} />
          <SummaryField
            label="Total expenses"
            value={formatMoney(result.totalExpensesMinor, result.currencyCode)}
          />
          <SummaryField
            label="Net"
            value={formatMoney(result.netAmountMinor, result.currencyCode)}
            negative={result.netAmountMinor < 0}
          />
          <div>
            <s-button
              variant="primary"
              commandFor={SAVE_MODAL_ID}
              command="--show"
              disabled={isSaving}
            >
              Save this calculation
            </s-button>
          </div>
        </div>
      </s-section>

      <s-section heading="Expense breakdown">
        <ExpenseBreakdown
          result={result}
          caption="Per-category expense breakdown against the revenue figure above."
          ruleColumnHeading="Rule applied"
        />
      </s-section>
    </s-page>
  );
}
