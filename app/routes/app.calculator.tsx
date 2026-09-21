import { useEffect, useMemo, useRef, useState } from "react";
import { Form, redirect, useActionData, useLoaderData, useNavigation, useSearchParams } from "react-router";
import type { Route } from "./+types/app.calculator";
import { authenticate } from "~/shopify.server";
import { requireShopContext } from "~/services/shop-context.service";
import { getOrSeedExpenseRules, saveExpenseRules, type ExpenseRuleView } from "~/services/expense-rule.service";
import { runCalculation } from "~/services/expense-calculation.service";
import { getDuplicatePrefill } from "~/services/calculation-history.service";
import { encodeCalculationResult } from "~/domain/calculation-transport";
import { EXPENSE_CATEGORIES, type ExpenseCategoryKey } from "~/domain/expense-categories";
import { EXPENSE_FORMULAS } from "~/domain/expense-formulas";
import {
  currencyOptionLabel,
  currencySymbol,
  formatSavedAt,
  minorUnitsToInputString,
  trimDecimalZeros,
} from "~/domain/presentation";
import {
  SUPPORTED_CURRENCY_CODES,
  hasAnyFieldError,
  isSupportedCurrencyCode,
  parseDecimalString,
  validateCurrencyCode,
  validateExpenseRuleRow,
  validateRevenueText,
  type ExpenseRuleFieldErrors,
  type ExpenseRuleFormInput,
} from "~/domain/expense-rule-validation";
import type { RuleType } from "~/domain/rule-types";

// --------------------------------------------------------------------------
// /app/calculator — M2 (expense-rule configuration) + M3 (live "Calculate"
// preview) real implementation, replacing the M1 static shell.
//
// Ports design/mockup/calculator.html (G2-confirmed) — same layout (revenue
// + currency, 10 <details> rule rows, contextual save bar, Calculate at the
// bottom) — this file wires it to real loader/action/engine code rather than
// redesigning it, per the task brief.
//
// PLACEHOLDER RATES (human's explicit instruction, G4-sprint-2.1): OQ-4
// (real business sign-off) is still open. Every default value here is
// illustrative, sourced from app/domain/expense-rule-defaults.ts, and the
// banner below labels them as such — this is NOT business advice.
// --------------------------------------------------------------------------

export async function loader({ request }: Route.LoaderArgs) {
  const { session } = await authenticate.admin(request);
  const ctx = await requireShopContext(session);
  const liveRules = await getOrSeedExpenseRules(ctx);

  // "Duplicate as new calculation" (G2 default-accepted): /app/calculator?from=<id>
  // pre-fills the form from a saved snapshot's stored inputs. The lookup is
  // tenant-scoped through the history service; a malformed, nonexistent, or
  // other-shop id simply yields no prefill (the normal calculator renders —
  // the response does not reveal whether such an id exists). Read-only:
  // nothing is written and the saved record is never modified.
  const from = new URL(request.url).searchParams.get("from");
  const prefill = from ? await getDuplicatePrefill(ctx, from, liveRules) : null;

  return {
    rules: prefill ? prefill.rules : liveRules,
    prefill: prefill
      ? {
          savedAtIso: prefill.savedAtIso,
          revenueMinor: prefill.revenueMinor,
          currencyCode: prefill.currencyCode,
        }
      : null,
  };
}

interface ActionResult {
  readonly intent: "save" | "calculate";
  readonly ok: boolean;
  readonly revenueError?: string;
  readonly currencyError?: string;
  readonly fieldErrors: Readonly<Record<string, ExpenseRuleFieldErrors>>;
}

export async function action({ request }: Route.ActionArgs) {
  const { session } = await authenticate.admin(request);
  const ctx = await requireShopContext(session);

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const revenueRaw = String(formData.get("revenue") ?? "");
  const currencyCode = String(formData.get("currency") ?? "");
  const rows = parseRuleRowsFromFormData(formData);

  if (intent === "save") {
    const result = await saveExpenseRules(ctx, rows);
    const actionResult: ActionResult = { intent: "save", ok: result.ok, fieldErrors: result.fieldErrors };
    return actionResult;
  }

  if (intent === "calculate") {
    // The RAW revenue text goes in: the validator, not a pre-parse to a number,
    // decides whether "-5" / "1e5" / "" is reported and with which message.
    const calcResult = runCalculation({ revenueText: revenueRaw, currencyCode, rows });
    if (!calcResult.ok) {
      const actionResult: ActionResult = {
        intent: "calculate",
        ok: false,
        revenueError: calcResult.revenueError,
        currencyError: calcResult.currencyError,
        fieldErrors: calcResult.fieldErrors,
      };
      return actionResult;
    }
    const encoded = encodeCalculationResult(calcResult.result);
    return redirect(`/app/results?d=${encoded}`);
  }

  throw new Response(`Unknown intent "${intent}".`, { status: 400 });
}

function parseRuleRowsFromFormData(formData: FormData): ExpenseRuleFormInput[] {
  return EXPENSE_CATEGORIES.map((category) => {
    const key = category.key;
    const enabled = formData.get(`enabled-${key}`) !== null;
    const ruleType = String(formData.get(`type-${key}`) ?? "percentage");
    const percentRaw = String(formData.get(`percent-${key}`) ?? "");
    const fixedRaw = String(formData.get(`fixed-${key}`) ?? "");
    const formulaKeyRaw = formData.get(`formula-${key}`);
    return {
      categoryKey: key,
      enabled,
      ruleType,
      rateBasisPoints: ruleType === "percentage" ? parseDecimalString(percentRaw, 2) : null,
      fixedAmountMinor: ruleType === "fixed" ? parseDecimalString(fixedRaw, 2) : null,
      formulaKey: ruleType === "formula" ? (formulaKeyRaw ? String(formulaKeyRaw) : null) : null,
    };
  });
}

// --------------------------------------------------------------------------
// Client-side editable state. Mirrors ExpenseRuleFormInput but keeps values
// as display strings while being typed (so a merchant can clear a field
// without it snapping back to "0"), converted through the SAME
// parseDecimalString the server uses for validation (never a separate,
// possibly-drifting client parser).
// --------------------------------------------------------------------------
interface RuleRowState {
  readonly categoryKey: ExpenseCategoryKey;
  enabled: boolean;
  ruleType: RuleType;
  percentText: string;
  fixedText: string;
  formulaKey: string;
}

function toRowState(view: ExpenseRuleView): RuleRowState {
  return {
    categoryKey: view.categoryKey,
    enabled: view.enabled,
    ruleType: view.ruleType,
    percentText: view.rateBasisPoints !== null ? minorUnitsToInputString(view.rateBasisPoints) : "0.00",
    fixedText: view.fixedAmountMinor !== null ? minorUnitsToInputString(view.fixedAmountMinor) : "0.00",
    formulaKey: view.formulaKey ?? EXPENSE_FORMULAS[0]?.key ?? "",
  };
}

function toFormInput(row: RuleRowState): ExpenseRuleFormInput {
  return {
    categoryKey: row.categoryKey,
    enabled: row.enabled,
    ruleType: row.ruleType,
    rateBasisPoints: row.ruleType === "percentage" ? parseDecimalString(row.percentText, 2) : null,
    fixedAmountMinor: row.ruleType === "fixed" ? parseDecimalString(row.fixedText, 2) : null,
    formulaKey: row.ruleType === "formula" ? row.formulaKey || null : null,
  };
}

function ruleSummary(row: RuleRowState, currencyCode: string): string {
  if (!row.enabled) return "Disabled";
  if (row.ruleType === "percentage") return `${trimDecimalZeros(row.percentText) || "0"}% of revenue`;
  if (row.ruleType === "fixed") return `${currencySymbol(currencyCode)}${row.fixedText || "0.00"} fixed`;
  const formula = EXPENSE_FORMULAS.find((f) => f.key === row.formulaKey);
  return formula ? formula.label : "Formula";
}

interface ToastHost {
  readonly shopify?: { readonly toast?: { readonly show: (message: string) => void } };
}

// Keys for the "which fields has the merchant touched since the last server
// response" bookkeeping below.
const REVENUE_KEY = "revenue";
const CURRENCY_KEY = "currency";
const rowKey = (categoryKey: string) => `row:${categoryKey}`;

/**
 * Which fields were edited (or discarded) since the server last responded, so
 * that a server-side error never outlives the edit that fixes it. It is tied to
 * the specific action response it applies to (`response`): when a new response
 * arrives the record no longer matches and everything counts as untouched again
 * — no effect needed to reset it.
 */
interface ServerErrorDismissals {
  readonly response: unknown;
  readonly all: boolean;
  readonly keys: ReadonlySet<string>;
}

const NO_KEYS: ReadonlySet<string> = new Set();

export default function CalculatorPage() {
  // `key` re-initialises the form state whenever ?from= changes while this route
  // stays mounted (Duplicate -> a different Duplicate, or back to the live rules):
  // the useState initialisers below only run on mount, and would otherwise keep
  // showing the previous calculation's revenue, currency and rules.
  const [searchParams] = useSearchParams();
  return <CalculatorForm key={searchParams.get("from") ?? ""} />;
}

function CalculatorForm() {
  const { rules, prefill } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as ActionResult | undefined;
  const navigation = useNavigation();

  // The submission in flight (or just completed and redirecting), by intent.
  const pendingIntent = navigation.state !== "idle" && navigation.formData ? String(navigation.formData.get("intent") ?? "") : null;
  const isBusy = pendingIntent !== null;
  const isCalculating = pendingIntent === "calculate";

  const initialRevenueText = prefill ? minorUnitsToInputString(prefill.revenueMinor) : "0.00";
  const initialCurrency: string =
    prefill && isSupportedCurrencyCode(prefill.currencyCode) ? prefill.currencyCode : SUPPORTED_CURRENCY_CODES[0];
  const [revenueText, setRevenueText] = useState(initialRevenueText);
  const [currency, setCurrency] = useState<string>(initialCurrency);
  const [rows, setRows] = useState<Record<string, RuleRowState>>(() => {
    const initial: Record<string, RuleRowState> = {};
    for (const view of rules) initial[view.categoryKey] = toRowState(view);
    return initial;
  });
  const [dismissals, setDismissals] = useState<ServerErrorDismissals>({ response: actionData, all: false, keys: NO_KEYS });
  const formRef = useRef<HTMLFormElement>(null);
  const intentInputRef = useRef<HTMLInputElement>(null);
  const toastedFor = useRef<unknown>(null);

  // Dismissals recorded against an older response no longer apply to this one.
  const activeDismissals = dismissals.response === actionData ? dismissals : { response: actionData, all: false, keys: NO_KEYS };
  const isDismissed = (key: string) => activeDismissals.all || activeDismissals.keys.has(key);

  function dismissServerError(key: string) {
    setDismissals((prev) => {
      const base = prev.response === actionData ? prev : { response: actionData, all: false, keys: NO_KEYS };
      if (base.all || base.keys.has(key)) return base;
      return { ...base, keys: new Set(base.keys).add(key) };
    });
  }

  function resetToLoadedRules() {
    const reset: Record<string, RuleRowState> = {};
    for (const view of rules) reset[view.categoryKey] = toRowState(view);
    setRows(reset);
    setRevenueText(initialRevenueText);
    setCurrency(initialCurrency);
    // Discard reverts everything the merchant sees, including any error the
    // server last reported about the values that were just thrown away.
    setDismissals({ response: actionData, all: true, keys: NO_KEYS });
  }

  function handleCalculateClick() {
    if (intentInputRef.current) intentInputRef.current.value = "calculate";
    formRef.current?.requestSubmit();
    // The submission has already captured the form data synchronously; put the
    // shared intent back to "save" so the contextual save bar's own Save (which
    // carries no intent of its own) can never replay "calculate" after a
    // validation error kept the merchant on this page.
    if (intentInputRef.current) intentInputRef.current.value = "save";
  }

  // "Rule changes saved" confirmation: once per successful Save response. The
  // ref (not just the effect dependency) is what stops a re-run of the effect
  // for the SAME response — React strict-mode double effects, a re-render that
  // keeps the response — from showing the toast twice. The response itself is
  // dropped by React Router on the next navigation, so leaving and coming back
  // to the calculator does not replay it either.
  useEffect(() => {
    if (!actionData || actionData.intent !== "save" || !actionData.ok) return;
    if (toastedFor.current === actionData) return;
    toastedFor.current = actionData;
    (window as unknown as ToastHost).shopify?.toast?.show("Rule changes saved");
  }, [actionData]);

  // Live client-side validation, recomputed from current state — the SAME pure
  // validators the server calls (S2.2's "client and server side" is one
  // implementation exercised twice, not two).
  const revenueCheck = useMemo(() => validateRevenueText(revenueText), [revenueText]);
  const currencyCheck = validateCurrencyCode(currency);

  // Two views of a row's validity. `saveErrors` treats every row as enabled —
  // what Save will demand, since a disabled row is still written and must carry
  // a value. `calculateErrors` is what Calculate demands (a disabled row does
  // not take part in a calculation, so it need not be valid to calculate).
  const { saveErrors, calculateErrors } = useMemo(() => {
    const save: Record<string, ExpenseRuleFieldErrors> = {};
    const calc: Record<string, ExpenseRuleFieldErrors> = {};
    for (const key of Object.keys(rows)) {
      const row = rows[key];
      if (!row) continue;
      const input = toFormInput(row);
      const strict = validateExpenseRuleRow({ ...input, enabled: true });
      if (hasAnyFieldError(strict)) save[key] = strict;
      const lenient = validateExpenseRuleRow(input);
      if (hasAnyFieldError(lenient)) calc[key] = lenient;
    }
    return { saveErrors: save, calculateErrors: calc };
  }, [rows]);

  // Server-reported errors (S2.2: the server re-validates regardless of client
  // state — this renders that response back into the form), shown only for a
  // field that has not been edited or discarded since the response arrived.
  const serverFieldErrors = actionData && !actionData.ok ? actionData.fieldErrors : {};
  const serverRevenueError =
    actionData && !actionData.ok && !isDismissed(REVENUE_KEY) ? actionData.revenueError : undefined;
  const serverCurrencyError =
    actionData && !actionData.ok && !isDismissed(CURRENCY_KEY) ? actionData.currencyError : undefined;

  const revenueError = revenueCheck.valid ? serverRevenueError : revenueCheck.error;
  const currencyError = currencyCheck.valid ? serverCurrencyError : currencyCheck.error;
  const errorsFor = (categoryKey: string): ExpenseRuleFieldErrors => {
    const client = saveErrors[categoryKey];
    if (client) return client;
    return isDismissed(rowKey(categoryKey)) ? {} : (serverFieldErrors[categoryKey] ?? {});
  };

  const hasBlockingErrors = !revenueCheck.valid || !currencyCheck.valid || Object.keys(calculateErrors).length > 0;
  const rowsNeedingAttention = EXPENSE_CATEGORIES.filter((c) => hasAnyFieldError(errorsFor(c.key)));
  const showSaveFailedBanner =
    actionData?.intent === "save" && !actionData.ok && rowsNeedingAttention.length > 0 && !activeDismissals.all;

  function updateRow(categoryKey: string, patch: Partial<RuleRowState>) {
    dismissServerError(rowKey(categoryKey));
    setRows((prev) => {
      const existing = prev[categoryKey];
      if (!existing) return prev;
      return { ...prev, [categoryKey]: { ...existing, ...patch } };
    });
  }

  const sortedCategories = [...EXPENSE_CATEGORIES].sort((a, b) => a.sortOrder - b.sortOrder);
  const currencyAffix = currencySymbol(currency);

  return (
    <s-page heading="Expense Calculator">
      {/*
        Contextual save bar: the `data-save-bar` FORM ATTRIBUTE approach
        (App Bridge "Save bar" API, verified against shopify.dev docs), not
        a hand-rolled <ui-save-bar> element — <ui-save-bar> is real but is
        for controlling a save bar defined on a PARENT page from inside a
        nested <s-app-window> iframe, which this page is not. With
        data-save-bar present, App Bridge auto-detects form changes and
        shows its own Save/Discard actions; Save triggers this form's native
        submit (intent defaults to "save" via the hidden field below, since
        App Bridge's own Save button carries no name/value pair we control),
        Discard triggers the form's native `reset` event, handled by
        onReset below to restore the loaded rule values. Per the docs:
        "Choose one approach or the other" — this page uses ONLY
        data-save-bar, never the programmatic shopify.saveBar.* API too.
      */}
      <Form method="post" ref={formRef} data-save-bar="true" onReset={resetToLoadedRules}>
        <input type="hidden" name="intent" defaultValue="save" ref={intentInputRef} />
        {/* The submitted revenue / currency come from state, not from the
            s-* fields' own form participation: a Polaris select that ever
            renders blank would otherwise submit an empty currency, and a
            number field sanitises non-numeric paste to "" before the server
            can name the real problem. */}
        <input type="hidden" name="revenue" value={revenueText} />
        <input type="hidden" name="currency" value={currency} />
        {prefill && (
          <s-section>
            <s-banner tone="info" heading="New calculation, pre-filled from a saved snapshot">
              <p>
                These values were loaded from the calculation saved {formatSavedAt(prefill.savedAtIso)}.
                This is a new, unsaved calculation — changing it will not edit that saved record.
              </p>
            </s-banner>
          </s-section>
        )}

        {showSaveFailedBanner && (
          <s-section>
            <s-banner tone="critical" heading="Rule changes not saved">
              <p>
                Nothing was saved. Fix the categories marked &ldquo;Needs attention&rdquo; below
                (every category needs a valid value, even a disabled one), then save again.
              </p>
            </s-banner>
          </s-section>
        )}

        <s-section>
          <s-banner tone="info" heading="Revenue is entered manually">
            <p>
              This app never reads your store&apos;s real sales figures — you type in a revenue
              amount and it&apos;s used only for this estimate.
            </p>
          </s-banner>
        </s-section>

        <s-section>
          <s-banner tone="warning" heading="Illustrative placeholder defaults">
            <p>
              The starting percentages and amounts below are placeholder examples, not real
              business figures or advice — they exist so every category has a starting point
              before your own numbers are confirmed. Edit any of them to match your business.
            </p>
          </s-banner>
        </s-section>

        <s-section heading="Revenue">
          <div className="rule-row__field-group">
            <s-number-field
              label="Revenue amount"
              min={0}
              step={0.01}
              prefix={currencyAffix}
              suffix={currency}
              value={revenueText}
              error={revenueError}
              details="Enter the revenue figure you want to run this estimate against."
              onInput={(e) => {
                dismissServerError(REVENUE_KEY);
                setRevenueText((e.currentTarget as unknown as HTMLInputElement).value);
              }}
            ></s-number-field>
            {/* No `value` prop here on purpose: the matching <s-option> carries
                `selected` (the G2 pattern). A `value` set on the select before its
                options exist left it rendering blank on a client-side render. */}
            <s-select
              label="Currency"
              error={currencyError}
              details="Used to format this calculation's amounts. It is not saved with your rules."
              onChange={(e) => {
                dismissServerError(CURRENCY_KEY);
                setCurrency((e.currentTarget as unknown as HTMLSelectElement).value);
              }}
            >
              {SUPPORTED_CURRENCY_CODES.map((code) => (
                <s-option key={code} value={code} selected={code === currency}>
                  {currencyOptionLabel(code)}
                </s-option>
              ))}
            </s-select>
          </div>
        </s-section>

        <s-section heading="Expense category rules">
          <p>
            {EXPENSE_CATEGORIES.length} categories. Each one has a rule type (percentage of
            revenue, fixed amount, or a predefined placeholder formula) and can be turned off
            without deleting its configuration.
          </p>

          <div className="rule-list">
            {sortedCategories.map((category) => {
              const row = rows[category.key];
              if (!row) return null;
              const errors = errorsFor(category.key);
              const needsAttention = hasAnyFieldError(errors);
              return (
                <details
                  className="rule-row"
                  key={category.key}
                  open={category.sortOrder === 0}
                  // A row with something to fix is opened so the error is visible.
                  // Imperative on purpose: tying the `open` PROP to the error would
                  // close the row again the moment the merchant's edit clears the
                  // error, i.e. mid-typing.
                  ref={(el) => {
                    if (el && needsAttention) el.open = true;
                  }}
                >
                  <summary className="rule-row__summary">
                    <svg
                      className="rule-row__chevron"
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      aria-hidden="true"
                    >
                      <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.5" />
                    </svg>
                    <span className="rule-row__title">{category.label}</span>
                    <span
                      className={
                        needsAttention
                          ? "rule-row__at-a-glance rule-row__at-a-glance--error"
                          : "rule-row__at-a-glance"
                      }
                    >
                      {needsAttention ? "Needs attention" : ruleSummary(row, currency)}
                    </span>
                    {/* The label lives on the control itself (aria-label), not in a
                        hidden <label> inside <summary> — text inside a summary is
                        part of the summary's own accessible name. Activating a
                        control nested in a summary does not toggle the <details>. */}
                    <input
                      type="checkbox"
                      id={`enabled-${category.key}`}
                      name={`enabled-${category.key}`}
                      aria-label={`Enable ${category.label} rule`}
                      checked={row.enabled}
                      onChange={(e) =>
                        updateRow(category.key, {
                          enabled: (e.currentTarget as HTMLInputElement).checked,
                        })
                      }
                    />
                  </summary>
                  <div className="rule-row__body">
                    <fieldset className="rule-row__types">
                      <legend className="visually-hidden">Rule type for {category.label}</legend>
                      {(["percentage", "fixed", "formula"] as const).map((type) => (
                        <label key={type}>
                          <input
                            type="radio"
                            name={`type-${category.key}`}
                            value={type}
                            checked={row.ruleType === type}
                            onChange={() => updateRow(category.key, { ruleType: type })}
                          />{" "}
                          {type === "percentage"
                            ? "Percentage of revenue"
                            : type === "fixed"
                              ? "Fixed amount"
                              : "Formula"}
                        </label>
                      ))}
                    </fieldset>

                    {row.ruleType === "percentage" && (
                      <div className="rule-row__field-group">
                        <s-number-field
                          label="Percentage"
                          min={0}
                          step={0.01}
                          suffix="%"
                          value={row.percentText}
                          error={errors.rateBasisPoints}
                          onInput={(e) =>
                            updateRow(category.key, {
                              percentText: (e.currentTarget as unknown as HTMLInputElement).value,
                            })
                          }
                        ></s-number-field>
                      </div>
                    )}
                    {row.ruleType === "fixed" && (
                      <div className="rule-row__field-group">
                        <s-number-field
                          label="Fixed amount"
                          min={0}
                          step={0.01}
                          prefix={currencyAffix}
                          suffix={currency}
                          value={row.fixedText}
                          error={errors.fixedAmountMinor}
                          onInput={(e) =>
                            updateRow(category.key, {
                              fixedText: (e.currentTarget as unknown as HTMLInputElement).value,
                            })
                          }
                        ></s-number-field>
                      </div>
                    )}
                    {row.ruleType === "formula" && (
                      <div className="rule-row__field-group">
                        <s-select
                          label="Formula"
                          error={errors.formulaKey}
                          onChange={(e) =>
                            updateRow(category.key, {
                              formulaKey: (e.currentTarget as unknown as HTMLSelectElement).value,
                            })
                          }
                        >
                          {EXPENSE_FORMULAS.map((f) => (
                            <s-option key={f.key} value={f.key} selected={f.key === row.formulaKey}>
                              {f.label}
                            </s-option>
                          ))}
                        </s-select>
                        <p className="help-text">
                          {EXPENSE_FORMULAS.find((f) => f.key === row.formulaKey)?.placeholderNote ??
                            "PLACEHOLDER formula pattern — illustrative only, pending OQ-4 sign-off."}
                        </p>
                      </div>
                    )}
                    {/* Every rule type's value is submitted from state through a
                        hidden input, whichever type is active: the server ignores
                        the fields that don't match the active rule_type but the
                        values stay stable across toggles, and the s-* controls
                        never have to take part in the form themselves. */}
                    <input type="hidden" name={`percent-${category.key}`} value={row.percentText} />
                    <input type="hidden" name={`fixed-${category.key}`} value={row.fixedText} />
                    <input type="hidden" name={`formula-${category.key}`} value={row.formulaKey} />
                  </div>
                </details>
              );
            })}
          </div>
        </s-section>

        <s-section>
          <div className="action-row">
            {/* type="button" (not "submit"): s-button has no name/value pair
                to carry the "calculate" intent (verified via Dev MCP
                validate_component_codeblocks — s-button does not support a
                `name` prop), so this triggers submission programmatically
                via handleCalculateClick, which sets the shared hidden
                intent field to "calculate" first. */}
            <s-button
              type="button"
              variant="primary"
              loading={isCalculating}
              disabled={isBusy || hasBlockingErrors}
              onClick={handleCalculateClick}
            >
              Calculate
            </s-button>
          </div>
          <p className="help-text help-text--end">
            Uses the rule values shown above, including any unsaved edits — save your rules
            first if you want to reuse these values next time.
          </p>
        </s-section>
      </Form>
    </s-page>
  );
}
