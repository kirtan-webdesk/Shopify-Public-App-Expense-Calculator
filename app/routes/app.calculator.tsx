import { useMemo, useRef, useState } from "react";
import { Form, redirect, useActionData, useLoaderData, useNavigation, useSearchParams } from "react-router";
import type { Route } from "./+types/app.calculator";
import { authenticate } from "~/shopify.server";
import { requireShopContext } from "~/services/shop-context.service";
import { getOrSeedExpenseRules, type ExpenseRuleView } from "~/services/expense-rule.service";
import { calculateFromSavedRules } from "~/services/expense-calculation.service";
import { getDuplicatePrefill } from "~/services/calculation-history.service";
import { focusField } from "~/components/focus-field";
import { encodeCalculationResult } from "~/domain/calculation-transport";
import { EXPENSE_CATEGORIES } from "~/domain/expense-categories";
import { currencyOptionLabel, formatRuleApplied, formatSavedAt, minorUnitsToInputString } from "~/domain/presentation";
import {
  SUPPORTED_CURRENCY_CODES,
  isSupportedCurrencyCode,
  validateCurrencyCode,
  validateRevenueText,
} from "~/domain/expense-rule-validation";

// --------------------------------------------------------------------------
// /app/calculator - the app home (G2-revision v2, design/v2/calculator.html).
//
// Owns: revenue, currency, a compact READ-ONLY table of the shop's SAVED
// rules (with a "Placeholder rates" badge and an "Edit rules" link) and the
// Calculate action. The rules editor lives on /app/rules (app.rules.tsx).
//
// J1 - Calculate uses the SAVED rules only. The action loads the shop's saved
// rules server-side (requireShopContext -> calculateFromSavedRules) and
// redirects to Results with the signed/transport payload; it never reads a
// rule value from the request. Anything a client posts besides `revenue` and
// `currency` is ignored.
//
// J6 - "Duplicate as new calculation" (?from=<id>) copies revenue + currency
// only. Two more entry points prefill the same two fields: Results'
// "Change revenue" (?revenue=&currency=), both re-validated here.
//
// PLACEHOLDER RATES (human's explicit instruction, G4-sprint-2.1): OQ-4 (real
// business sign-off) is still open. Every default value is illustrative,
// sourced from app/domain/expense-rule-defaults.ts, and labelled as such
// here (badge + sentence), on the Rules page and on Results - NOT business
// advice. The label is permanent (J12): the data model does not record
// whether a merchant has edited a rate.
// --------------------------------------------------------------------------

export async function loader({ request }: Route.LoaderArgs) {
  const { session } = await authenticate.admin(request);
  const ctx = await requireShopContext(session);
  const rules = await getOrSeedExpenseRules(ctx);

  const params = new URL(request.url).searchParams;

  // "Duplicate as new calculation": /app/calculator?from=<id>. The lookup is
  // tenant-scoped through the history service; a malformed, nonexistent, or
  // other-shop id simply yields no prefill (the normal calculator renders -
  // the response does not reveal whether such an id exists). Read-only.
  const from = params.get("from");
  const duplicate = from ? await getDuplicatePrefill(ctx, from) : null;

  // "Change revenue" from Results: only a revenue text that passes the shared
  // validator and a supported currency are accepted; anything else is ignored.
  const revenueParam = params.get("revenue");
  const currencyParam = params.get("currency");
  const revenueCheck = revenueParam !== null ? validateRevenueText(revenueParam) : null;
  const carried =
    !duplicate && revenueCheck?.valid
      ? {
          revenueMinor: revenueCheck.revenueMinor,
          currencyCode: currencyParam !== null && isSupportedCurrencyCode(currencyParam) ? currencyParam : null,
        }
      : null;

  return {
    rules,
    prefill: duplicate
      ? {
          id: duplicate.id,
          savedAtIso: duplicate.savedAtIso,
          revenueMinor: duplicate.revenueMinor,
          currencyCode: duplicate.currencyCode,
        }
      : null,
    carried,
  };
}

interface ActionResult {
  readonly ok: false;
  readonly revenueError?: string;
  readonly currencyError?: string;
  readonly savedRulesInvalid: boolean;
}

export async function action({ request }: Route.ActionArgs) {
  const { session } = await authenticate.admin(request);
  const ctx = await requireShopContext(session);

  const formData = await request.formData();
  // The ONLY two inputs Calculate reads. There is deliberately no rule field,
  // no rule-type field and no intent: the rules are the shop's saved rules.
  const revenueRaw = String(formData.get("revenue") ?? "");
  const currencyCode = String(formData.get("currency") ?? "");

  // The RAW revenue text goes in: the validator, not a pre-parse to a number,
  // decides whether "-5" / "1e5" / "" is reported and with which message.
  const outcome = await calculateFromSavedRules(ctx, { revenueText: revenueRaw, currencyCode });
  if (!outcome.ok) {
    const actionResult: ActionResult = {
      ok: false,
      revenueError: outcome.revenueError,
      currencyError: outcome.currencyError,
      savedRulesInvalid: outcome.savedRulesInvalid,
    };
    return actionResult;
  }
  return redirect(`/app/results?d=${encodeCalculationResult(outcome.result)}`);
}

const REVENUE_FIELD_ID = "revenue";

export default function CalculatorPage() {
  // `key` re-initialises the form state whenever ?from= (or the carried values)
  // change while this route stays mounted: the useState initialisers below only
  // run on mount, and would otherwise keep showing the previous values.
  const [searchParams] = useSearchParams();
  const key = `${searchParams.get("from") ?? ""}|${searchParams.get("revenue") ?? ""}|${searchParams.get("currency") ?? ""}`;
  return <CalculatorForm key={key} />;
}

function CalculatorForm() {
  const { rules: loadedRules, prefill, carried } = useLoaderData<typeof loader>();
  const rules: readonly ExpenseRuleView[] = loadedRules;
  const actionData = useActionData<typeof action>() as ActionResult | undefined;
  const navigation = useNavigation();
  const isCalculating = navigation.state !== "idle" && navigation.formData !== undefined;

  const source = prefill ?? carried;
  const [revenueText, setRevenueText] = useState(source ? minorUnitsToInputString(source.revenueMinor) : "");
  const [currency, setCurrency] = useState<string>(
    source?.currencyCode && isSupportedCurrencyCode(source.currencyCode)
      ? source.currencyCode
      : SUPPORTED_CURRENCY_CODES[0],
  );
  // An empty revenue field is only an error once the merchant has tried to
  // calculate or has left the field; any other invalid text is an error live.
  const [attempted, setAttempted] = useState(false);
  const [touched, setTouched] = useState(false);
  // The action response whose errors the merchant has already started fixing.
  const [dismissedFor, setDismissedFor] = useState<unknown>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const revenueCheck = useMemo(() => validateRevenueText(revenueText), [revenueText]);
  const currencyCheck = validateCurrencyCode(currency);

  const serverErrorsApply = actionData !== undefined && dismissedFor !== actionData;
  const clientRevenueError = revenueCheck.valid
    ? undefined
    : revenueText.trim() === "" && !attempted && !touched
      ? undefined
      : revenueCheck.error;
  const revenueError = clientRevenueError ?? (serverErrorsApply ? actionData?.revenueError : undefined);
  const currencyError = currencyCheck.valid
    ? serverErrorsApply
      ? actionData?.currencyError
      : undefined
    : currencyCheck.error;

  function handleCalculate() {
    if (isCalculating) return;
    setAttempted(true);
    if (!revenueCheck.valid || !currencyCheck.valid) {
      // Validate on click and put the cursor on the problem field.
      focusField(REVENUE_FIELD_ID);
      return;
    }
    formRef.current?.requestSubmit();
  }

  const enabledCount = rules.filter((r) => r.enabled).length;
  const rowsByCategory = new Map<string, ExpenseRuleView>(rules.map((r) => [r.categoryKey, r]));

  return (
    <s-page heading="Expense Calculator">
      {/* One primary action, in the page header (always visible, also at 600px).
          type="button": s-button has no name/value pair to carry an intent, and
          the values to submit live in the hidden inputs below, so submission is
          triggered programmatically after validation. */}
      <s-button
        slot="primary-action"
        variant="primary"
        type="button"
        loading={isCalculating}
        disabled={isCalculating}
        onClick={handleCalculate}
      >
        Calculate
      </s-button>
      <s-button slot="secondary-actions" href="/app/rules">
        Edit rules
      </s-button>

      <s-stack gap="base">
        {prefill && (
          <s-banner tone="info" heading="New calculation, pre-filled from a saved snapshot">
            <s-paragraph>
              Revenue and currency were copied from the calculation saved {formatSavedAt(prefill.savedAtIso)}. The rules
              are your current saved rules, not the ones in that snapshot (
              <s-link href={`/app/history/${prefill.id}`}>see the snapshot&apos;s rules</s-link>). Changing anything
              here will not edit that saved record.
            </s-paragraph>
          </s-banner>
        )}

        {actionData?.savedRulesInvalid && (
          <s-banner tone="critical" heading="Your saved rules need attention">
            <s-paragraph>
              One or more saved rules could not be used, so nothing was calculated.{" "}
              <s-link href="/app/rules">Review your rules</s-link>
            </s-paragraph>
          </s-banner>
        )}

        <Form method="post" ref={formRef}>
          {/* The submitted revenue / currency come from state, not from the s-*
              fields' own form participation: a Polaris select that ever renders
              blank would otherwise submit an empty currency, and a number field
              sanitises non-numeric paste to "" before the server can name the
              real problem. */}
          <input type="hidden" name="revenue" value={revenueText} />
          <input type="hidden" name="currency" value={currency} />

          <s-section heading="Revenue">
            <s-stack gap="base">
              <s-paragraph color="subdued">
                Enter the revenue you want to estimate expenses against. You type this in yourself; the app never reads
                your store&apos;s sales.
              </s-paragraph>

              {/* s-grid's @container syntax needs an s-query-container ancestor to measure.
                  The wrapper div only carries Enter-to-calculate for the revenue field: s-text-field
                  has no onKeyDown prop (validate_component_codeblocks rejected it), but the
                  composed keydown bubbles out of its shadow root. */}
              <div
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.target as HTMLElement).id === REVENUE_FIELD_ID) {
                    e.preventDefault();
                    handleCalculate();
                  }
                }}
              >
                <s-query-container>
                  <s-grid gridTemplateColumns="@container (inline-size > 560px) 2fr 1fr, 1fr" gap="base">
                    {/* s-text-field (not s-number-field) on purpose: the validator needs the RAW
                    text so it can say exactly what is wrong ("-5", "1,5", "10.555"). The
                    prefix shows the chosen currency code. */}
                    <s-text-field
                      id={REVENUE_FIELD_ID}
                      label="Revenue"
                      autocomplete="off"
                      placeholder="0.00"
                      prefix={currency}
                      required
                      value={revenueText}
                      error={revenueError}
                      details="For example 12500.50. Commas are fine as thousands separators."
                      onInput={(e) => {
                        setDismissedFor(actionData);
                        setRevenueText((e.currentTarget as unknown as HTMLInputElement).value);
                      }}
                      onBlur={() => setTouched(true)}
                    ></s-text-field>

                    {/* No `value` prop here on purpose: the matching <s-option> carries
                    `selected` (the pass-1 pattern). A `value` set on the select before
                    its options exist left it rendering blank on a client-side render. */}
                    <s-select
                      label="Currency"
                      error={currencyError}
                      details="Used for this calculation."
                      onChange={(e) => {
                        setDismissedFor(actionData);
                        setCurrency((e.currentTarget as unknown as HTMLSelectElement).value);
                      }}
                    >
                      {SUPPORTED_CURRENCY_CODES.map((code) => (
                        <s-option key={code} value={code} selected={code === currency}>
                          {currencyOptionLabel(code)}
                        </s-option>
                      ))}
                    </s-select>
                  </s-grid>
                </s-query-container>
              </div>
            </s-stack>
          </s-section>
        </Form>

        <s-section heading="Rules used for this estimate">
          <s-stack gap="base">
            <s-stack direction="inline" gap="small" alignItems="center" justifyContent="space-between">
              <s-stack direction="inline" gap="small" alignItems="center">
                <s-badge tone="warning">Placeholder rates</s-badge>
                <s-text color="subdued">
                  {enabledCount} of {EXPENSE_CATEGORIES.length} categories on
                </s-text>
              </s-stack>
              <s-link href="/app/rules">Edit rules</s-link>
            </s-stack>

            {enabledCount === 0 && (
              <s-banner tone="warning" heading="No expense rules are switched on">
                <s-paragraph>
                  With every category off, the estimate will show no expenses.{" "}
                  <s-link href="/app/rules">Switch rules on</s-link>
                </s-paragraph>
              </s-banner>
            )}

            {/* Read-only summary. Rules are edited on the Rules page, never here. */}
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Category</s-table-header>
                <s-table-header listSlot="secondary">Rule</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {EXPENSE_CATEGORIES.map((category) => {
                  const rule = rowsByCategory.get(category.key);
                  return (
                    <s-table-row key={category.key}>
                      <s-table-cell>{category.label}</s-table-cell>
                      <s-table-cell>
                        {rule?.enabled ? formatRuleApplied(rule, currency) : <s-badge tone="neutral">Off</s-badge>}
                      </s-table-cell>
                    </s-table-row>
                  );
                })}
              </s-table-body>
            </s-table>

            <s-text color="subdued">
              Starting rates are illustrative placeholders, not real business figures or advice, until you change them.
              Calculate always uses your <strong>saved</strong> rules.
            </s-text>
          </s-stack>
        </s-section>
      </s-stack>
    </s-page>
  );
}
