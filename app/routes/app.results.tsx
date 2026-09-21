import { useRef } from "react";
import { Form, redirect, useActionData, useNavigation } from "react-router";
import type { Route } from "./+types/app.results";
import { authenticate } from "~/shopify.server";
import { requireShopContext } from "~/services/shop-context.service";
import { saveCalculationFromTransport } from "~/services/calculation-history.service";
import { decodeCalculationResult } from "~/domain/calculation-transport";
import { minorUnitsToInputString } from "~/domain/presentation";
import { ExpenseBreakdown, MetricTiles } from "~/components/expense-breakdown";

// --------------------------------------------------------------------------
// /app/results - M3 results view + M4 "Save calculation" (D10), G2-revision v2
// (design/v2/results.html).
//
// The accessible breakdown table is the PRIMARY, always-rendered
// representation (ADR-0004) and the inline SVG donut is supplementary - both
// live in app/components/expense-breakdown and are shared with the
// saved-calculation detail page.
//
// The loader does NOT read from the database: the result it renders comes
// from the `d` query parameter the Calculator's "Calculate" action produced
// (app/domain/calculation-transport.ts) - a non-persisted preview computed
// from the shop's SAVED rules (J1). A missing `d` is the "no calculation yet"
// state; a `d` that does not decode is the "this link isn't valid" state -
// neither is a crash.
//
// Saving is a POST to this route's action, confirmed through an <s-modal>
// (saving is permanent, so it is confirmed rather than fired directly). The
// action NEVER persists the transported amounts: saveCalculationFromTransport
// re-validates the inputs, recomputes with the pure engine, and rejects a
// payload whose amounts do not match. The shop identity comes from the
// authenticated session, never from the form.
// --------------------------------------------------------------------------

const SAVE_MODAL_ID = "save-calculation-modal";

export async function loader({ request }: Route.LoaderArgs) {
  await authenticate.admin(request);
  const url = new URL(request.url);
  const encoded = url.searchParams.get("d");
  const result = encoded ? decodeCalculationResult(encoded) : null;
  // "none": nothing was asked for. "invalid": a `d` came in but does not decode
  // (incomplete, tampered, unsupported currency).
  const linkState: "ok" | "none" | "invalid" = result ? "ok" : encoded ? "invalid" : "none";
  // `encoded` is handed back only when it decoded - it is what the Save form
  // posts, so the server re-verifies exactly the calculation the merchant saw.
  return { result, encoded: result ? encoded : null, linkState };
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
  const { result, encoded, linkState } = loaderData;
  const actionData = useActionData<typeof action>() as SaveActionError | undefined;
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";
  const formRef = useRef<HTMLFormElement>(null);

  // Results is a sub-page of the Calculator, so it gets a breadcrumb back, not a nav entry.
  if (!result || !encoded) {
    return (
      <s-page heading="Results">
        <s-link slot="breadcrumb-actions" href="/app/calculator">
          Calculator
        </s-link>
        {linkState === "invalid" ? (
          <s-banner tone="critical" heading="This results link isn't valid">
            <s-paragraph>
              The link is incomplete or was changed, so the calculation can&apos;t be shown.{" "}
              <s-link href="/app/calculator">Run a new calculation</s-link>
            </s-paragraph>
          </s-banner>
        ) : (
          <s-banner tone="info" heading="No calculation yet">
            <s-paragraph>
              Run a calculation from the Calculator to see results here. Nothing is saved automatically; this
              page only shows the calculation you just ran.{" "}
              <s-link href="/app/calculator">Go to Calculator</s-link>
            </s-paragraph>
          </s-banner>
        )}
      </s-page>
    );
  }

  // "Change revenue" returns to a FILLED form: revenue and currency travel back as
  // query parameters (the Calculator re-validates both; neither is trusted).
  const changeRevenueHref =
    `/app/calculator?revenue=${encodeURIComponent(minorUnitsToInputString(result.revenueMinor))}` +
    `&currency=${encodeURIComponent(result.currencyCode)}`;
  const expensesExceedRevenue = result.revenueMinor > 0 && result.totalExpensesMinor > result.revenueMinor;

  return (
    <s-page heading="Results">
      <s-link slot="breadcrumb-actions" href="/app/calculator">
        Calculator
      </s-link>
      <s-button
        slot="primary-action"
        variant="primary"
        commandFor={SAVE_MODAL_ID}
        command="--show"
        loading={isSaving}
        disabled={isSaving}
      >
        Save calculation
      </s-button>
      <s-button slot="secondary-actions" href={changeRevenueHref}>
        Change revenue
      </s-button>

      {/* Save-confirmation modal (App Bridge/Polaris <s-modal>, not a bespoke
          dialog). The primary action hides the modal and submits the hidden
          form below; the form is outside the modal so it exists regardless of
          the modal's own rendering. */}
      <s-modal id={SAVE_MODAL_ID} heading="Save this calculation?">
        <s-paragraph>
          This creates a permanent record of this revenue figure and the rule values used to calculate it. It
          will <strong>not</strong> change later if you edit your rules. That is by design, so past calculations
          stay comparable.
        </s-paragraph>
        <s-button
          slot="primary-action"
          variant="primary"
          commandFor={SAVE_MODAL_ID}
          command="--hide"
          loading={isSaving}
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

      <s-stack gap="base">
        {actionData && !actionData.ok && (
          <s-banner tone="critical" heading="Calculation not saved">
            <s-paragraph>{actionData.message}</s-paragraph>
          </s-banner>
        )}

        {/* Always present: not saved yet + placeholder-rate labelling (approved product rules). */}
        <s-banner tone="warning" heading="Estimate only, not saved yet">
          <s-paragraph>
            This estimate uses your <strong>saved</strong> rules. Their starting rates are illustrative
            placeholders until you change them, so treat the figures as a rough estimate. Select{" "}
            <strong>Save calculation</strong> to keep a permanent snapshot in History.{" "}
            <s-link href="/app/rules">Review rules</s-link>
          </s-paragraph>
          {/* In-body FALLBACK for the header "Save calculation" button (G4-sprint-4.2). Every header
              action is an s-page slot button that Admin hoists into its own chrome, and it is unverified
              that the chrome forwards clicks / invoker commands into this iframe. This one lives in the
              page body, opens the SAME save-calculation-modal with the SAME command, and is deliberately
              not variant="primary" (the header button stays the page's one primary action). */}
          <s-button
            slot="secondary-actions"
            commandFor={SAVE_MODAL_ID}
            command="--show"
            loading={isSaving}
            disabled={isSaving}
          >
            Save calculation
          </s-button>
        </s-banner>

        {/* Data-driven banners: shown by what the calculation contains. */}
        {result.revenueMinor === 0 && (
          <s-banner tone="info" heading="Revenue is 0">
            <s-paragraph>
              Percentage rules give 0 and percentages of revenue can&apos;t be shown. Fixed amounts still count as
              expenses, and the chart shows each category&apos;s share of total expenses.
            </s-paragraph>
          </s-banner>
        )}
        {expensesExceedRevenue && (
          <s-banner tone="warning" heading="Expenses are higher than revenue">
            <s-paragraph>
              Net is negative. The chart shows each category&apos;s share of total expenses, because a ring can&apos;t
              show more than 100% of revenue.
            </s-paragraph>
          </s-banner>
        )}
        {result.lineItems.length === 0 && (
          <s-banner tone="warning" heading="No expense rules are switched on">
            <s-paragraph>
              There is nothing to break down. <s-link href="/app/rules">Switch rules on</s-link>
            </s-paragraph>
          </s-banner>
        )}

        <s-section>
          <MetricTiles result={result} labels={{ revenue: "Revenue", total: "Total expenses", net: "Net" }} />
        </s-section>

        <s-section heading="Expense breakdown">
          <ExpenseBreakdown
            result={result}
            ruleColumnHeading="Rule applied"
          />
        </s-section>
      </s-stack>
    </s-page>
  );
}
