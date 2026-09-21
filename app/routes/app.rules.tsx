import { useEffect, useMemo, useRef, useState } from "react";
import { Form, useActionData, useLoaderData, useNavigate } from "react-router";
import type { Route } from "./+types/app.rules";
import { authenticate } from "~/shopify.server";
import { requireShopContext } from "~/services/shop-context.service";
import { getOrSeedExpenseRules, saveExpenseRules } from "~/services/expense-rule.service";
import { focusField } from "~/components/focus-field";
import { EXPENSE_CATEGORIES } from "~/domain/expense-categories";
import { EXPENSE_FORMULAS } from "~/domain/expense-formulas";
import {
  enabledField,
  fixedField,
  formulaField,
  parseRuleRowsFromFormData,
  percentField,
  placeholderDefaultRowStates,
  rowStatesFromRules,
  toFormInput,
  typeField,
  type RuleRowState,
} from "~/domain/expense-rule-form";
import {
  hasAnyFieldError,
  validateExpenseRuleRow,
  type ExpenseRuleFieldErrors,
} from "~/domain/expense-rule-validation";
import type { RuleType } from "~/domain/rule-types";

// --------------------------------------------------------------------------
// /app/rules - "Expense rules" (G2-revision v2, design/v2/rules.html).
//
// The rules editor, moved out of the Calculator: ten categories, each with an
// enable switch, a rule type and its value. It owns the App Bridge contextual
// save bar, the Save action (saveExpenseRules - every row is validated as if it
// were enabled, so a switched-off row still has to hold a valid value, J11),
// Discard, and the optional "Reset to placeholder defaults" (J5).
//
// PLACEHOLDER RATES (OQ-4 still open): the starting values are illustrative,
// and the banner below says so permanently (J12).
// --------------------------------------------------------------------------

export async function loader({ request }: Route.LoaderArgs) {
  const { session } = await authenticate.admin(request);
  const ctx = await requireShopContext(session);
  return { rules: await getOrSeedExpenseRules(ctx) };
}

interface SaveResult {
  readonly ok: boolean;
  readonly fieldErrors: Readonly<Record<string, ExpenseRuleFieldErrors>>;
}

export async function action({ request }: Route.ActionArgs) {
  const { session } = await authenticate.admin(request);
  const ctx = await requireShopContext(session);

  // Save is the only thing this route does. Revenue and currency are not part
  // of this form and are not persisted anywhere.
  const rows = parseRuleRowsFromFormData(await request.formData());
  const result = await saveExpenseRules(ctx, rows);
  const actionResult: SaveResult = { ok: result.ok, fieldErrors: result.fieldErrors };
  return actionResult;
}

export default function RulesPage() {
  const { rules } = useLoaderData<typeof loader>();
  // Re-keyed on the saved values: after a successful Save the loader returns the
  // rules that were just written, the editor remounts on them, and the App Bridge
  // save bar (which tracks the form against its initial values) starts clean. A
  // failed Save changes nothing in the loader, so the merchant's edits stay.
  const fingerprint = useMemo(() => JSON.stringify(rules), [rules]);
  return <RulesEditor key={fingerprint} rules={rules} />;
}

interface ToastHost {
  readonly shopify?: {
    readonly toast?: {
      readonly show: (message: string, options?: { action?: string; onAction?: () => void }) => void;
    };
  };
}

// Once per successful Save RESPONSE, even if the editor remounts on the new
// rules or React runs an effect twice.
const toastedResponses = new WeakSet<object>();

const TAX_NOTE = "Estimate only. This is a rough figure based on your own assumption, not tax or legal advice.";

/** Which errors the merchant has started fixing since the server last answered. */
interface Edited {
  readonly response: unknown;
  readonly keys: ReadonlySet<string>;
}
const NOTHING_EDITED: ReadonlySet<string> = new Set();

const RULE_TYPE_LABELS: Record<RuleType, string> = {
  percentage: "Percentage of revenue",
  fixed: "Fixed amount",
  formula: "Formula",
};

// The field an error belongs to, for the summary links and focus.
function firstErrorField(errors: ExpenseRuleFieldErrors): "percent" | "fixed" | "formula" | "type" | null {
  if (errors.rateBasisPoints) return "percent";
  if (errors.fixedAmountMinor) return "fixed";
  if (errors.formulaKey) return "formula";
  if (errors.ruleType) return "type";
  return null;
}
const errorMessage = (e: ExpenseRuleFieldErrors): string =>
  e.rateBasisPoints ?? e.fixedAmountMinor ?? e.formulaKey ?? e.ruleType ?? e.categoryKey ?? "";

type LoaderRules = Awaited<ReturnType<typeof loader>>["rules"];

function RulesEditor({ rules }: { readonly rules: LoaderRules }) {
  const actionData = useActionData<typeof action>() as SaveResult | undefined;
  const navigate = useNavigate();
  const loadedRows = useMemo(() => rowStatesFromRules(rules), [rules]);
  const [rows, setRows] = useState<Record<string, RuleRowState>>(loadedRows);
  const [edited, setEdited] = useState<Edited>({ response: actionData, keys: NOTHING_EDITED });
  // Bumped whenever the values are replaced wholesale (Discard, Reset to
  // defaults) so every Polaris control is rebuilt from the new state instead of
  // relying on each one to re-sync a changed `selected` / `value` in place.
  const [generation, setGeneration] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const defaultsApplied = useRef(0);

  const activeEdited = edited.response === actionData ? edited : { response: actionData, keys: NOTHING_EDITED };
  const markEdited = (categoryKey: string) =>
    setEdited((prev) => {
      const base = prev.response === actionData ? prev : { response: actionData, keys: NOTHING_EDITED };
      return base.keys.has(categoryKey) ? base : { response: actionData, keys: new Set(base.keys).add(categoryKey) };
    });

  // Every row is validated as if it were ENABLED - what Save demands (J11): a
  // disabled row is still written and must carry a value the database accepts.
  const clientErrors = useMemo(() => {
    const found: Record<string, ExpenseRuleFieldErrors> = {};
    for (const category of EXPENSE_CATEGORIES) {
      const row = rows[category.key];
      if (!row) continue;
      const errors = validateExpenseRuleRow({ ...toFormInput(row), enabled: true });
      if (hasAnyFieldError(errors)) found[category.key] = errors;
    }
    return found;
  }, [rows]);

  // Server-reported errors (the server re-validates regardless of client state)
  // apply only to a row that has not been edited since the response arrived.
  const serverErrors = actionData && !actionData.ok ? actionData.fieldErrors : {};
  const errorsFor = (categoryKey: string): ExpenseRuleFieldErrors => {
    const client = clientErrors[categoryKey];
    if (client) return client;
    return activeEdited.keys.has(categoryKey) ? {} : (serverErrors[categoryKey] ?? {});
  };
  const rowsNeedingAttention = EXPENSE_CATEGORIES.filter((c) => hasAnyFieldError(errorsFor(c.key)));
  const showSaveFailedBanner = actionData !== undefined && !actionData.ok && rowsNeedingAttention.length > 0;

  function updateRow(categoryKey: string, patch: Partial<RuleRowState>) {
    markEdited(categoryKey);
    setRows((prev) => {
      const existing = prev[categoryKey];
      return existing ? { ...prev, [categoryKey]: { ...existing, ...patch } } : prev;
    });
  }

  // Discard (the App Bridge save bar resets the form): everything the merchant
  // sees goes back to the saved rules, including any error about the values
  // that were just thrown away.
  function discard() {
    setRows(loadedRows);
    setEdited({ response: actionData, keys: new Set(EXPENSE_CATEGORIES.map((c) => c.key)) });
    setGeneration((g) => g + 1);
  }

  // J5: fills the form with the placeholder defaults. Nothing is written until
  // the merchant saves, and Discard brings the saved values back.
  function applyPlaceholderDefaults() {
    setRows(placeholderDefaultRowStates());
    setEdited({ response: actionData, keys: new Set(EXPENSE_CATEGORIES.map((c) => c.key)) });
    setGeneration((g) => g + 1);
    defaultsApplied.current += 1;
    (window as unknown as ToastHost).shopify?.toast?.show("Placeholder defaults loaded. Select Save to keep them.");
  }

  // The reset changes values without any user input event, so tell the form (and
  // with it the App Bridge save bar) that it changed. Runs after the DOM update.
  useEffect(() => {
    if (defaultsApplied.current === 0) return;
    const form = formRef.current;
    form?.dispatchEvent(new Event("input", { bubbles: true }));
    form?.dispatchEvent(new Event("change", { bubbles: true }));
  }, [generation]);

  // "Rule changes saved": once per successful Save response, with a shortcut to
  // Calculate (a saved rule set is exactly what Calculate uses).
  useEffect(() => {
    if (!actionData?.ok || toastedResponses.has(actionData)) return;
    toastedResponses.add(actionData);
    (window as unknown as ToastHost).shopify?.toast?.show("Rule changes saved", {
      action: "Calculate",
      onAction: () => navigate("/app/calculator"),
    });
  }, [actionData, navigate]);

  // After a failed Save, focus goes to the first field that needs fixing.
  useEffect(() => {
    if (!actionData || actionData.ok) return;
    const first = EXPENSE_CATEGORIES.find((c) => hasAnyFieldError(actionData.fieldErrors[c.key] ?? {}));
    if (!first) return;
    const field = firstErrorField(actionData.fieldErrors[first.key] ?? {});
    if (field) focusField(`${first.key}-${field}`);
  }, [actionData]);

  return (
    <s-page heading="Expense rules">
      <s-button slot="secondary-actions" commandFor="reset-modal" command="--show">
        Reset to placeholder defaults
      </s-button>

      <s-stack gap="base">
        <s-banner tone="warning" heading="Illustrative placeholder defaults">
          <s-paragraph>
            The starting percentages and amounts are placeholder examples, not real business figures or advice. They
            exist so every category has a starting point. Edit any of them to match your business.
          </s-paragraph>
        </s-banner>

        {showSaveFailedBanner && (
          <s-banner tone="critical" heading="Rule changes not saved">
            <s-paragraph>
              Nothing was saved.{" "}
              {rowsNeedingAttention.length === 1
                ? "One category needs"
                : `${rowsNeedingAttention.length} categories need`}{" "}
              attention (every category needs a valid value, even one that is switched off):
            </s-paragraph>
            <ul>
              {rowsNeedingAttention.map((category) => {
                const errors = errorsFor(category.key);
                const field = firstErrorField(errors) ?? "type";
                const off = rows[category.key]?.enabled === false;
                return (
                  <li key={category.key}>
                    <s-link
                      href={`#${category.key}-${field}`}
                      onClick={(e: { preventDefault: () => void }) => {
                        e.preventDefault();
                        focusField(`${category.key}-${field}`);
                      }}
                    >
                      {category.label}: {errorMessage(errors)}
                    </s-link>
                    {off && " (this rule is off, but its value must still be valid so it can be switched on later)"}
                  </li>
                );
              })}
            </ul>
          </s-banner>
        )}

        {/*
          Contextual save bar: the `data-save-bar` FORM ATTRIBUTE approach (App
          Bridge "Save bar" API, verified against shopify.dev docs via the Dev
          MCP): the save bar appears whenever a form input value changes from its
          initial state and hides when the form is submitted or reset; Save = the
          form's native submit, Discard = its native reset (onReset below). Per the
          docs "choose one approach or the other": this page uses ONLY
          data-save-bar, never the programmatic shopify.saveBar.* API too. It also
          raises Shopify's "Leave page?" prompt on navigation away with edits.

          What is SUBMITTED comes from hidden inputs carrying React state, not from
          the s-* fields' own form participation (a Polaris number field sanitises
          non-numeric paste to "" before the server can name the real problem, and a
          select that ever renders blank would submit ""). The s-* controls still
          carry a dotted `name` (the design's naming): that gives App Bridge's change
          detection a native form value to compare on every keystroke; the server
          reads only the hyphenated hidden fields (expense-rule-form.ts).
        */}
        <Form method="post" ref={formRef} data-save-bar="true" onReset={discard}>
          <s-section heading="Category rules">
            <s-stack gap="base">
              <s-paragraph color="subdued">
                {EXPENSE_CATEGORIES.length} fixed categories. Each has a rule type (percentage of revenue, a fixed
                amount, or a preset formula) and can be switched off without losing its values. Fixed amounts are
                numbers in whichever currency you choose when you calculate.
              </s-paragraph>
              <s-divider></s-divider>
              {EXPENSE_CATEGORIES.map((category, index) => {
                const row = rows[category.key];
                if (!row) return null;
                return (
                  <RuleRow
                    key={`${category.key}-${generation}`}
                    label={category.label}
                    categoryKey={category.key}
                    row={row}
                    errors={errorsFor(category.key)}
                    isLast={index === EXPENSE_CATEGORIES.length - 1}
                    onChange={(patch) => updateRow(category.key, patch)}
                  />
                );
              })}
            </s-stack>
          </s-section>
        </Form>
      </s-stack>

      <s-modal id="reset-modal" heading="Reset to placeholder defaults?">
        <s-paragraph>
          This replaces the values on this page with the illustrative placeholder defaults. Nothing is saved until you
          select <strong>Save</strong>, and <strong>Discard</strong> brings your values back. Saved calculations in
          History are never affected.
        </s-paragraph>
        <s-button
          slot="primary-action"
          variant="primary"
          commandFor="reset-modal"
          command="--hide"
          onClick={applyPlaceholderDefaults}
        >
          Replace values
        </s-button>
        <s-button slot="secondary-actions" commandFor="reset-modal" command="--hide">
          Cancel
        </s-button>
      </s-modal>
    </s-page>
  );
}

function RuleRow({
  label,
  categoryKey,
  row,
  errors,
  isLast,
  onChange,
}: {
  readonly label: string;
  readonly categoryKey: string;
  readonly row: RuleRowState;
  readonly errors: ExpenseRuleFieldErrors;
  readonly isLast: boolean;
  readonly onChange: (patch: Partial<RuleRowState>) => void;
}) {
  const formula = EXPENSE_FORMULAS.find((f) => f.key === row.formulaKey);
  let note = "";
  if (row.ruleType === "formula") {
    note = formula?.placeholderNote ?? "PLACEHOLDER formula pattern - illustrative only, pending OQ-4 sign-off.";
  }
  if (categoryKey === "taxes") note = note ? `${note} ${TAX_NOTE}` : TAX_NOTE;

  return (
    <s-box>
      <s-stack gap="base">
        <s-query-container>
          <s-grid gridTemplateColumns="@container (inline-size > 640px) 1fr 1fr 1fr, 1fr" gap="base" alignItems="start">
            <s-stack direction="inline" gap="small" alignItems="center">
              <s-switch
                id={`${categoryKey}-enabled`}
                name={`${categoryKey}.enabled`}
                label={label}
                checked={row.enabled}
                // React's onChange never fired for s-switch in Chromium (the host DID dispatch `change`;
                // measured G4-sprint-4.1, the row stayed switched on and the form still posted it), while
                // onInput does. Both handlers set the same value, so listening to both is harmless.
                onInput={(e) => onChange({ enabled: (e.currentTarget as unknown as HTMLInputElement).checked })}
                onChange={(e) => onChange({ enabled: (e.currentTarget as unknown as HTMLInputElement).checked })}
              ></s-switch>
              {!row.enabled && <s-badge tone="neutral">Off</s-badge>}
            </s-stack>

            {/* No `value` on the select: the matching <s-option> carries `selected`. */}
            <s-select
              id={`${categoryKey}-type`}
              name={`${categoryKey}.type`}
              label="Rule type"
              error={errors.ruleType}
              onChange={(e) =>
                onChange({ ruleType: (e.currentTarget as unknown as HTMLSelectElement).value as RuleType })
              }
            >
              {(["percentage", "fixed", "formula"] as const).map((type) => (
                <s-option key={type} value={type} selected={type === row.ruleType}>
                  {RULE_TYPE_LABELS[type]}
                </s-option>
              ))}
            </s-select>

            {/* One value control at a time. */}
            {row.ruleType === "percentage" && (
              <s-number-field
                id={`${categoryKey}-percent`}
                name={`${categoryKey}.percent`}
                label="Percentage"
                suffix="%"
                min={0}
                step={0.01}
                inputMode="decimal"
                value={row.percentText}
                error={errors.rateBasisPoints}
                onInput={(e) => onChange({ percentText: (e.currentTarget as unknown as HTMLInputElement).value })}
              ></s-number-field>
            )}
            {row.ruleType === "fixed" && (
              <s-number-field
                id={`${categoryKey}-fixed`}
                name={`${categoryKey}.fixed`}
                label="Fixed amount"
                min={0}
                step={0.01}
                inputMode="decimal"
                value={row.fixedText}
                error={errors.fixedAmountMinor}
                onInput={(e) => onChange({ fixedText: (e.currentTarget as unknown as HTMLInputElement).value })}
              ></s-number-field>
            )}
            {row.ruleType === "formula" && (
              <s-select
                id={`${categoryKey}-formula`}
                name={`${categoryKey}.formula`}
                label="Formula"
                error={errors.formulaKey}
                onChange={(e) => onChange({ formulaKey: (e.currentTarget as unknown as HTMLSelectElement).value })}
              >
                {EXPENSE_FORMULAS.map((f) => (
                  <s-option key={f.key} value={f.key} selected={f.key === row.formulaKey}>
                    {f.label}
                  </s-option>
                ))}
              </s-select>
            )}
          </s-grid>
        </s-query-container>

        {note && <s-paragraph color="subdued">{note}</s-paragraph>}

        {/* What the server reads: every value is submitted from state, whichever rule
            type is active. The server ignores the fields that do not match the active
            type, but the values stay stable across type toggles. */}
        {row.enabled && <input type="hidden" name={enabledField(categoryKey)} value="on" />}
        <input type="hidden" name={typeField(categoryKey)} value={row.ruleType} />
        <input type="hidden" name={percentField(categoryKey)} value={row.percentText} />
        <input type="hidden" name={fixedField(categoryKey)} value={row.fixedText} />
        <input type="hidden" name={formulaField(categoryKey)} value={row.formulaKey} />

        {!isLast && <s-divider></s-divider>}
      </s-stack>
    </s-box>
  );
}
