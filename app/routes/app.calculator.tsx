import { EXPENSE_CATEGORIES } from "~/domain/expense-categories";

// --------------------------------------------------------------------------
// /app/calculator — M1 SCAFFOLD PAGE.
//
// This is a structural port of design/mockup/calculator.html (G2-confirmed,
// project.json v9) demonstrating the real App Bridge/Polaris wiring (root
// layout <head>, s-app-nav, Polaris web components) end-to-end in the real
// React Router app. It is explicitly NOT the M2 deliverable: there is no
// loader reading expense_rule rows, no action writing them, no client/server
// validation, and no contextual save bar wiring. D4 (calculator input UI +
// validation) and D6 (rule configuration) are M2 scope per the G1 estimate
// table and the G3 task brief ("do NOT build the expense-configuration UI").
//
// Category rows below ARE data-driven from the real
// app/domain/expense-categories.ts constant (not 10 copy-pasted blocks),
// which is itself real M1 scope (the code-constant decided at G-Schema).
// --------------------------------------------------------------------------

export default function CalculatorPage() {
  return (
    <s-page heading="Expense Calculator">
      <s-section>
        <s-banner tone="info" heading="Revenue is entered manually">
          <p>
            This app never reads your store&apos;s real sales figures — you
            type in a revenue amount and it&apos;s used only for this
            estimate.
          </p>
        </s-banner>
      </s-section>

      <s-section heading="Revenue">
        {/* s-number-field, not s-text-field type="number" — verified via
            Dev MCP validate_component_codeblocks: s-text-field has no
            `type` prop; typed numeric input is its own component. */}
        <s-number-field
          label="Revenue amount"
          name="revenue"
          min={0}
          step={0.01}
          placeholder="0.00"
          disabled
          details="Configuration + calculation (M2/M3) are not yet wired — this field is a structural placeholder."
        ></s-number-field>
      </s-section>

      <s-section heading="Expense category rules">
        <p>
          {EXPENSE_CATEGORIES.length} categories are defined
          (app/domain/expense-categories.ts). Per-shop rule configuration
          (percentage / fixed / formula), validation, and persistence are M2
          scope and are not built in this M1 scaffold.
        </p>
        <ul>
          {EXPENSE_CATEGORIES.map((category) => (
            <li key={category.key}>{category.label}</li>
          ))}
        </ul>
      </s-section>

      <s-section>
        <s-button variant="primary" disabled>
          Calculate
        </s-button>
        <p>The calculation engine (D7) is M3 scope.</p>
      </s-section>
    </s-page>
  );
}
