import { useMemo, useRef, useState } from "react";
import { Form, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import type { Route } from "./+types/app.calculator";
import { authenticate } from "~/shopify.server";
import { findShopContextByDomain } from "~/db/repositories/shop.repository";
import { getOrSeedExpenseRules, saveExpenseRules, type ExpenseRuleView } from "~/services/expense-rule.service";
import { runCalculation } from "~/services/expense-calculation.service";
import { getDuplicatePrefill } from "~/services/calculation-history.service";
import { encodeCalculationResult } from "~/domain/calculation-transport";
import { EXPENSE_CATEGORIES, type ExpenseCategoryKey } from "~/domain/expense-categories";
import { EXPENSE_FORMULAS } from "~/domain/expense-formulas";
import { formatSavedAt, minorUnitsToInputString } from "~/domain/presentation";
import {
  SUPPORTED_CURRENCY_CODES,
  hasAnyFieldError,
  isSupportedCurrencyCode,
  parseDecimalString,
  validateExpenseRuleRow,
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
  const ctx = await findShopContextByDomain(session.shop);
  if (!ctx) {
    throw new Response("Shop record not found for this session — try reinstalling the app.", {
      status: 404,
    });
  }
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
  const ctx = await findShopContextByDomain(session.shop);
  if (!ctx) {
    throw new Response("Shop record not found for this session — try reinstalling the app.", {
      status: 404,
    });
  }

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const revenueRaw = String(formData.get("revenue") ?? "");
  const currencyCode = String(formData.get("currency") ?? "");
  const revenueMinor = parseDecimalString(revenueRaw, 2);
  const rows = parseRuleRowsFromFormData(formData);

  if (intent === "save") {
    const result = await saveExpenseRules(ctx, rows);
    const actionResult: ActionResult = { intent: "save", ok: result.ok, fieldErrors: result.fieldErrors };
    return actionResult;
  }

  if (intent === "calculate") {
    const calcResult = runCalculation({ revenueMinor, currencyCode, rows });
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

function ruleSummary(row: RuleRowState): string {
  if (!row.enabled) return "Disabled";
  if (row.ruleType === "percentage") return `${row.percentText || "0"}% of revenue`;
  if (row.ruleType === "fixed") return `$${row.fixedText || "0.00"} fixed`;
  const formula = EXPENSE_FORMULAS.find((f) => f.key === row.formulaKey);
  return formula ? formula.label : "Formula";
}

export default function CalculatorPage() {
  const { rules, prefill } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as ActionResult | undefined;
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const initialRevenueText = prefill ? minorUnitsToInputString(prefill.revenueMinor) : "0.00";
  const [revenueText, setRevenueText] = useState(initialRevenueText);
  const [currency, setCurrency] = useState<string>(
    prefill && isSupportedCurrencyCode(prefill.currencyCode)
      ? prefill.currencyCode
      : SUPPORTED_CURRENCY_CODES[0],
  );
  const [rows, setRows] = useState<Record<string, RuleRowState>>(() => {
    const initial: Record<string, RuleRowState> = {};
    for (const view of rules) initial[view.categoryKey] = toRowState(view);
    return initial;
  });
  const formRef = useRef<HTMLFormElement>(null);
  const intentInputRef = useRef<HTMLInputElement>(null);

  function resetToLoadedRules() {
    const reset: Record<string, RuleRowState> = {};
    for (const view of rules) reset[view.categoryKey] = toRowState(view);
    setRows(reset);
    setRevenueText(initialRevenueText);
  }

  function handleCalculateClick() {
    if (intentInputRef.current) intentInputRef.current.value = "calculate";
    formRef.current?.requestSubmit();
  }

  // Server-side field errors from the last "save" or "calculate" submission
  // (S2.2: server re-validates regardless of client state — this is that
  // server response rendered back into the form, not a client-only check).
  const serverFieldErrors = actionData && !actionData.ok ? actionData.fieldErrors : {};
  const serverRevenueError = actionData && !actionData.ok ? actionData.revenueError : undefined;

  // Live client-side validation, recomputed on every render from current
  // state — the SAME pure validators the server calls (S2.2's "client and
  // server side" is one implementation exercised twice, not two).
  const clientFieldErrors = useMemo(() => {
    const out: Record<string, ExpenseRuleFieldErrors> = {};
    for (const key of Object.keys(rows)) {
      const row = rows[key];
      if (!row) continue;
      const errors = validateExpenseRuleRow(toFormInput(row));
      if (hasAnyFieldError(errors)) out[key] = errors;
    }
    return out;
  }, [rows]);

  const hasClientErrors = Object.keys(clientFieldErrors).length > 0;

  function updateRow(categoryKey: string, patch: Partial<RuleRowState>) {
    setRows((prev) => {
      const existing = prev[categoryKey];
      if (!existing) return prev;
      return { ...prev, [categoryKey]: { ...existing, ...patch } };
    });
  }

  const sortedCategories = [...EXPENSE_CATEGORIES].sort((a, b) => a.sortOrder - b.sortOrder);

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
              name="revenue"
              min={0}
              step={0.01}
              value={revenueText}
              error={serverRevenueError}
              details="Enter the revenue figure you want to run this estimate against."
              onInput={(e) => {
                setRevenueText((e.currentTarget as unknown as HTMLInputElement).value);
              }}
            ></s-number-field>
            <s-select
              label="Currency"
              name="currency"
              value={currency}
              details="Set once; used to format every calculation."
              onChange={(e) => {
                setCurrency((e.currentTarget as unknown as HTMLSelectElement).value);
              }}
            >
              {SUPPORTED_CURRENCY_CODES.map((code) => (
                <s-option key={code} value={code}>
                  {code}
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
              const errors = serverFieldErrors[category.key] ?? clientFieldErrors[category.key] ?? {};
              return (
                <details className="rule-row" key={category.key} open={category.sortOrder === 0}>
                  <summary className="rule-row__summary">
                    <span className="rule-row__title">{category.label}</span>
                    <span className="rule-row__at-a-glance">{ruleSummary(row)}</span>
                    <label className="visually-hidden" htmlFor={`enabled-${category.key}`}>
                      Enable {category.label} rule
                    </label>
                    <input
                      type="checkbox"
                      id={`enabled-${category.key}`}
                      name={`enabled-${category.key}`}
                      checked={row.enabled}
                      onChange={(e) =>
                        updateRow(category.key, {
                          enabled: (e.currentTarget as HTMLInputElement).checked,
                        })
                      }
                    />
                  </summary>
                  <div className="rule-row__body">
                    <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
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
                        <input type="hidden" name={`percent-${category.key}`} value={row.percentText} />
                      </div>
                    )}
                    {row.ruleType === "fixed" && (
                      <div className="rule-row__field-group">
                        <s-number-field
                          label="Fixed amount"
                          min={0}
                          step={0.01}
                          prefix="$"
                          value={row.fixedText}
                          error={errors.fixedAmountMinor}
                          onInput={(e) =>
                            updateRow(category.key, {
                              fixedText: (e.currentTarget as unknown as HTMLInputElement).value,
                            })
                          }
                        ></s-number-field>
                        <input type="hidden" name={`fixed-${category.key}`} value={row.fixedText} />
                      </div>
                    )}
                    {row.ruleType === "formula" && (
                      <div className="rule-row__field-group">
                        <s-select
                          label="Formula"
                          name={`formula-${category.key}`}
                          value={row.formulaKey}
                          error={errors.formulaKey}
                          onChange={(e) =>
                            updateRow(category.key, {
                              formulaKey: (e.currentTarget as unknown as HTMLSelectElement).value,
                            })
                          }
                        >
                          {EXPENSE_FORMULAS.map((f) => (
                            <s-option key={f.key} value={f.key}>
                              {f.label}
                            </s-option>
                          ))}
                        </s-select>
                        <p style={{ color: "var(--p-color-text-secondary, #616161)", fontSize: "0.8125rem" }}>
                          {EXPENSE_FORMULAS.find((f) => f.key === row.formulaKey)?.placeholderNote ??
                            "PLACEHOLDER formula pattern — illustrative only, pending OQ-4 sign-off."}
                        </p>
                      </div>
                    )}
                    {/* Hidden inputs so an unselected rule type's value is still
                        submitted as-is (server ignores fields that don't match
                        the active rule_type, but keeps state stable across
                        toggles). */}
                    {row.ruleType !== "percentage" && (
                      <input type="hidden" name={`percent-${category.key}`} value={row.percentText} />
                    )}
                    {row.ruleType !== "fixed" && (
                      <input type="hidden" name={`fixed-${category.key}`} value={row.fixedText} />
                    )}
                    {row.ruleType !== "formula" && (
                      <input type="hidden" name={`formula-${category.key}`} value={row.formulaKey} />
                    )}
                  </div>
                </details>
              );
            })}
          </div>
        </s-section>

        <s-section>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px" }}>
            {/* type="button" (not "submit"): s-button has no name/value pair
                to carry the "calculate" intent (verified via Dev MCP
                validate_component_codeblocks — s-button does not support a
                `name` prop), so this triggers submission programmatically
                via handleCalculateClick, which sets the shared hidden
                intent field to "calculate" first. */}
            <s-button
              type="button"
              variant="primary"
              disabled={isSubmitting || hasClientErrors}
              onClick={handleCalculateClick}
            >
              Calculate
            </s-button>
          </div>
          <p style={{ color: "var(--p-color-text-secondary, #616161)", fontSize: "0.8125rem", textAlign: "right" }}>
            Uses the rule values shown above, including any unsaved edits — save your rules
            first if you want to reuse these values next time.
          </p>
        </s-section>
      </Form>
    </s-page>
  );
}
