# G2-revision Design Notes (v2) — expense-calculator

| | |
|---|---|
| **Gate** | G2-revision (Human design gate; approver = Design lead) |
| **Status** | **PROPOSED. Not self-approved.** |
| **Author** | designer agent, 2026-09-21 |
| **Deliverable** | Running HTML/Polaris + App Bridge mockup in `design/v2/` (open `index.html`; no build step) |
| **Companion docs** | `design/v2/IA-v2.md` (information architecture), `listing-assets/logo/logo-notes.md` (app icon) |
| **Inputs** | `design/DESIGN-NOTES.md`, `design/mockup/*`, `spec.md`, `decisions/ADR-0004-charting-inline-svg-donut.md`, `project.json` audit entries `ia_restructure_ui_redesign_logo_request` and `static_trace_ui_defects_delivered`, the two live screenshots (Calculator, History), and read-only reads of `app/` |

**What I did not do (no shell, no browser, no MCP in this session):** I did not open the pages in a browser, so nothing here has been
visually reviewed; I did not run axe-core; I did not run the Dev MCP `validate_component_codeblocks`. Section 8 lists exactly what a
developer must validate. The mockup is written to be correct by construction, not confirmed by a tool.

---

## 1. Why the current UI looks "not proper"

From the screenshots and the v1 files: Polaris only supplies the page frame and the buttons, while the *content* is native HTML.
Ten `<details>/<summary>` disclosures with a checkbox nested in each `<summary>`, native radios, a native `<table>` with a hand-rolled CSS
stylesheet, hand-rolled "cards" and flex rows. Native controls do not pick up Polaris typography, spacing, focus rings or density,
so the page reads as a web form dropped into Admin. One page also carried everything (revenue, currency, two banners, ten rules, Calculate),
which is what makes it feel crowded.

v2 fixes both causes: **structure** (rules move to their own page; Calculator becomes short) and **materials** (Polaris layout and data
components; almost no custom CSS).

## 2. What is in `design/v2/`

| File | Screen / purpose |
|---|---|
| `index.html` | Review index (not product): every screen and every state |
| `calculator.html` | App home: revenue, currency, read-only rules summary, Calculate. States: prefilled-from-snapshot, rules variants, empty / negative / 3-decimals / "1,5" revenue errors |
| `rules.html` | New Expense rules page: 10 rule rows, placeholder banner, save bar, optional reset. States: variants, unsaved edit, validation errors (incl. an OFF row), saved toast |
| `results.html` | Results: banners, three figures, table (primary) + donut (supplementary), save modal. States: zero revenue, expenses exceed revenue, single category, small slices, all rules off, invalid link, no calculation |
| `history.html` | History list with pagination. States: empty, loading, paginated |
| `history-detail.html` | Frozen snapshot. States: just saved, not found |
| `assets/v2.css`, `assets/v2.js` | Tiny stylesheet; fixtures + interaction layer + preview-only aids |

Every page has the same `<head>`: `meta shopify-api-key`, then `app-bridge.js`, then `polaris.js` (unpinned CDN), then our CSS/JS (deferred).
Every page has the same `<s-app-nav>` with the Calculator as `rel="home"`.
Outside Shopify admin the App Bridge sidebar does not render, so the bottom **review bar** (preview only) and `index.html` provide navigation.

## 3. Component map (idiomatic Polaris; minimal custom CSS)

| Need | Used | Notes |
|---|---|---|
| Page frame, title, actions | `s-page` + slots `primary-action`, `secondary-actions`, `breadcrumb-actions` | One primary action per page, in the header. Sub-pages (Results, History detail) get a breadcrumb; nav pages do not |
| Cards with headings | `s-section heading` | |
| Layout | `s-stack`, `s-grid` (container-query `gridTemplateColumns`), `s-box` | Replaces every hand-rolled flex/grid |
| Tabular data | `s-table` (+ `-header-row`, `-header`, `-body`, `-row`, `-cell`) | Calculator summary, Results, History, History detail. Responsive: list layout on narrow widths (removes the overflow-x problem) |
| Enable/disable a rule | `s-switch` (label = category name) | Replaces the checkbox nested in `<summary>` |
| Rule type | `s-select` | Chosen over `s-choice-list` (see J4) |
| Percentage / fixed amount | `s-number-field` (`suffix="%"`) | |
| Revenue | `s-text-field inputMode="decimal"` with the currency code as `prefix` | Raw text is needed so the validator can name the exact problem (B3) |
| Formula | `s-select` | Currency-neutral notes |
| Status / snapshot | `s-badge` (`Off`, `Placeholder rates`, `Snapshot`, `Expenses exceed revenue`) | Text badges, never colour alone |
| Messages | `s-banner` | |
| Confirmation | `s-modal` (`commandFor` / `command="--show"`, same as the live app) | Save calculation; reset defaults |
| Nav | `<s-app-nav>` / `<s-link rel="home">` (App Bridge) | |
| Unsaved changes | `form[data-save-bar]` (App Bridge contextual save bar) | Same approach the live calculator already uses |
| Toast | `shopify.toast.show()` | With a "Calculate" action after saving rules |
| Loading | `loading` on `s-button` and `s-table` | |

Still native, deliberately: the `<svg>` donut (ADR-0004), the legend `<ul>`, `<strong>`, `<form>` (App Bridge needs a form), and one small
`.swatch` span. All are semantic and styled with ~40 lines of CSS.

## 4. Judgment calls the human must accept or reject

Each has my default. Reply "accept all defaults" or override by number.

| # | Decision | Default | Alternative |
|---|---|---|---|
| **J1** | **Calculate uses the SAVED rules** (changes the G2-v1 approved behaviour "Calculate runs on unsaved form state") | **Accept saved-only.** Save bar + leave-page prompt protect unsaved edits; toast offers "Calculate" after saving | Keep unsaved what-if by carrying rule values to Calculate (needs a rules payload in the URL/state and reintroduces "which values did this use?") |
| **J2** | Calculator shows a compact read-only **table of all 10 rules** | Table | A one-line "10 of 10 on, placeholder rates" with a disclosure (shorter page, less transparent) |
| **J3** | The dismissible "Revenue is entered manually" banner is replaced by **always-visible helper text** under Revenue | Replace | Keep the banner |
| **J4** | Rules layout: **compact rows** (switch, type select, value field on one line from ~640px, stacked below) | Compact rows | 10 separate `s-section` cards with radios (cleaner per rule, ~1500px tall: the crowding you reported); summary table + edit-in-modal (more clicks, 10 modals) |
| **J5** | **"Reset to placeholder defaults"** on Rules | Include (optional; fills the form, nothing saved until Save, Discard undoes it) | Omit |
| **J6** | **Duplicate as new calculation** copies revenue + currency only, not the snapshot's rules | Revenue + currency | Also offer "Load these rules into the Rules page" as an unsaved edit (extra route param and state) |
| **J7** | **Currency** stays a per-calculation field on Calculator (not persisted; the v1 copy "Set once" was false). Fixed amounts on Rules are bare numbers; the page says they use the currency chosen at calculate time | Per calculation | Persisted default currency (needs storage: a schema/G-Schema change) |
| **J8** | **Chart palette** replaced with 10 colours that are each >= 3:1 on white (v1 had some below; finding p4) | Replace `CATEGORY_COLORS` | Keep v1 colours (table still carries the data, but a11y reviewers may flag) |
| **J9** | History: the **date is the row link**, the separate "View" column is dropped; add a header **"New calculation"** action | Accept | Keep "View" |
| **J10** | **Sidebar label**: "Expense rules" (page heading the same) | "Expense rules" | "Expense category rules" (your wording; longer in the sidebar), "Rules" |
| **J11** | A rule that is **OFF must still hold a valid value** (from finding NEW_P2, so the DB can never receive a null for the active type); the row's error text says why | Accept | Store nothing for OFF rows (schema change) |
| **J12** | The **placeholder label stays permanently** (badge on Calculator, banner on Rules and Results) because the data model does not record "merchant has edited this rate" | Permanent | Hide once edited (needs a per-rule flag: schema change) |

## 5. What changed vs G2 v1

- Navigation: Calculator no longer a child; **Expense rules** added.
- Calculator: from "everything" to revenue + currency + read-only summary + Calculate (header primary action).
- Rules editing moved to `/app/rules` with a proper Polaris row layout (no `<details>`, no native radios/checkboxes).
- All tables are `s-table`; History date is the link; metrics in `s-box` tiles; native CSS cards removed.
- Currency code shown wherever `$` would be ambiguous (prefix, column headers, tile subtitle, History column).
- Donut: plotted by expense **amount**, basis stated on screen and in `aria-label`, legend adds "Left over (net)" when the ring is revenue-based.
- Errors: exact revenue messages; stale errors clear as you type; failed rule save gets a summary banner listing every row.
- Results: "Change revenue" returns to a filled form; invalid link and no-calculation states; loading states on buttons and table.
- Removed: the design-review `<select>`/checkbox switchers inside page content (replaced by one bottom bar that ships nowhere).

## 6. Defect-to-design map (code-review findings)

Finding IDs are from audit entry `static_trace_ui_defects_delivered`. "Design does" = what v2 specifies; "Dev still must" = code work the design cannot do.

| Finding | Design does | Where to see it | Dev still must |
|---|---|---|---|
| **B1** currency blank; `currencyError` never rendered; "Set once" false | Options carry `selected`, no `value` on `s-select`; copy now "Used for this calculation." (J7). The mockup does not demo a currency error (a valid option is always selected); if the server ever returns one it should show through the select's `error` | `calculator.html` | Render `currencyError` via the select's `error`; drop `value=`; imperative sync only if still blank |
| **B2** donut "No data" at zero revenue | Slices keyed on amount; ring basis = share of total expenses when revenue is 0; banner explains | `results.html?state=zero-revenue` | Already in `donut-chart.ts` (3.5); make the UI text match |
| **B2b** donut wrong when expenses exceed revenue | Same basis rule (share of expenses, ring closes at 100%); warning banner + "Expenses exceed revenue" badge (not colour-only) | `?state=expenses-exceed` | Same |
| **B3** negative revenue gets "Enter a revenue amount" | Exact messages per case, live clearing, inline error under the field, Calculate stays available (validates on click, focuses the field) | `calculator.html?state=error-negative|error-empty|error-decimals|error-comma` | Use `validateRevenueText` client and server |
| **NEW_P2** save with cleared value on a disabled row -> 500 | OFF rows still validated; summary banner lists them with "(this rule is off, but its value must still be valid...)" | `rules.html?state=errors` | Validate as `{...row, enabled: true}` in `saveExpenseRules`; catch check_violation |
| p3 stale server errors persist | Errors re-validate live and clear on edit | calculator error states; `rules.html?state=errors` (edit a field) | Clear server-error state on change |
| p3 Discard doesn't reset currency / clear errors | Rules form contains only rules; Discard resets all of it and clears the error banner. Currency lives on Calculator, no save bar there | `rules.html` | Wire `onReset` |
| p3 no success toast after Save | Toast "Rules saved" with a "Calculate" action | `rules.html?state=saved` | `shopify.toast.show` on success |
| p3 USD and CAD both show `$`, no code | Code in the revenue prefix, `Amount (USD)` header, tile subtitle, History currency column | `results.html?...&currency=CAD`, `history.html` | Add code to `formatMoney` call sites |
| p3 formula help hardcodes `$` | Currency-neutral formula notes; fixed amounts on Rules are bare numbers | `rules.html?state=variants` (Payroll formula) | Use the existing neutral `placeholderNote` |
| p3 generic messages; "1,5" -> 15.00 | Exact messages for 3 decimals, ".5", "1e5", "1,5" | calculator error states | Already in validators |
| p3 `?from=` initialisers don't re-run (suspected) | n/a design; prefill now only revenue + currency (J6) | `calculator.html?from=5` | Keep `key={from}` |
| p3 Back loses revenue / unsaved rule edits | "Change revenue" carries revenue + currency; unsaved rules are guarded by the save bar and Admin leave prompt, and cannot travel to Calculator | `results.html` | Build the link from the decoded result |
| p3 no loading indicator | `loading` on Calculate, Save calculation, and `s-table` | `history.html?state=loading` | Bind `loading` to navigation state |
| p3 tables lack overflow-x (suspected) | `s-table` switches to list layout on narrow widths | all tables at ~600px | Confirm at build |
| p3 enable checkbox inside `<summary>` | No disclosures; `s-switch` in a named group | `rules.html` | n/a |
| p3 tiered formula "cliff" ($500 -> $350 at +1c) | **Not resolved by design**: a product decision. The note states "one rate chosen by revenue band" | `rules.html?state=variants` | Human/product decision |
| p4 crafted `?d=` crashes Results | "This results link isn't valid" state | `?state=invalid-link` | Guard `Intl` and decode errors |
| p4 chart colours < 3:1 | New palette (J8) | any results page | Update `CATEGORY_COLORS` |
| Screenshot duplicated "Payroll" / clipped radios | Treated as scroll-stitch capture artifacts (as instructed); no design change | n/a | Confirm with a normal screenshot / a row-count test |

## 7. Migration impact for developers

Routes and files (developers are editing app code now; this is the plan, not an edit):

1. **`app/routes.ts`**: add `route("rules", "routes/app.rules.tsx")` inside the `app` children. No route removed.
2. **`app/routes/app.tsx`**: add `<s-link href="/app/rules">Expense rules</s-link>` between the `rel="home"` Calculator link and History. Calculator stays `rel="home"` (already done).
3. **New `app/routes/app.rules.tsx`**: loader = `getOrSeedExpenseRules`; action = `saveExpenseRules` (with the NEW_P2 fix); UI = the rule-row state and `<Form data-save-bar onReset>` **moved out of `app.calculator.tsx`**, rebuilt from `rules.html`. Keep the existing form field names (`enabled-<key>`, `type-<key>`, `percent-<key>`, `fixed-<key>`, `formula-<key>`); the mockup's dotted names are illustrative.
4. **`app/routes/app.calculator.tsx` slimmed**: remove the rules form, `intent=save`, the save bar and rule dismissal state. Loader returns the **saved** rules for the read-only summary; `?from=` prefill returns revenue + currency only (J6). Action = Calculate only.
5. **`runCalculation` (`expense-calculation.service.ts`) must read saved rules from the DB** instead of receiving `rows` from the form. Existing tests in `tests/services/expense-calculation.service.test.ts` and `tests/ui/calculator-render.test.ts` change; add tests for "calculate uses saved rules, ignores anything else".
6. **`app.results.tsx`, `expense-breakdown.tsx`, `saved-calculation-page.tsx`, `app.history.tsx`**: replace native tables/CSS with `s-table`, tiles with `s-box`; banner copy "uses your saved rules"; "Change revenue" link; invalid-link state; palette.
7. **`app/types/polaris-web-components.d.ts`**: add JSX declarations for the tags v2 introduces: `s-stack`, `s-grid`, `s-box`, `s-switch`, `s-heading`, `s-paragraph`, `s-text`, `s-divider`, `s-table`, `s-table-header-row`, `s-table-header`, `s-table-body`, `s-table-row`, `s-table-cell`.
8. **`app/styles/app.css`**: delete rule-row / results-grid / data-table / summary-row CSS; keep only `.swatch`, `.donut`, `.legend`, `.tabular`.
9. **Strip preview-only code** (not for production): the review bar (`reviewAid` in `v2.js`, `.review-aid` CSS), `previewSaveBar` and the preview toast, `index.html`, the `?state=` machinery (`data-only` / `data-hide-in`, the `[hidden]` guard), and the fixture engine in `v2.js` (the real engine is `app/domain/expense-engine.ts`).
10. **Listing asset**: app icon (human task, see `logo-notes.md`).

`design/mockup/` (v1) stays untouched as the record of what G2 approved. On approval, freeze `design/v2/` and tag it in `audit_log`.

## 8. Verify-at-build register (nothing below was tool-verified)

| Item | Risk | How |
|---|---|---|
| Every Polaris tag and attribute in `design/v2/*.html` and the `<template>` bodies | I am confident about tags the app already uses (`s-page`, `s-section`, `s-banner`, `s-button`, `s-badge`, `s-modal`, `s-text-field`, `s-number-field`, `s-select`, `s-option`, `s-link`). Newly introduced ones (`s-stack`, `s-grid`, `s-box`, `s-table*`, `s-switch`, `s-heading`, `s-paragraph`, `s-text`, `s-divider`) are believed to exist but are unconfirmed | Dev MCP `validate_component_codeblocks` on every file and template |
| Specific attributes | `s-grid gridTemplateColumns` container-query syntax (`@container (inline-size > N) a b, c`); `s-table` `listSlot`, `format="currency|numeric"`, `paginate`, `hasNextPage`/`hasPreviousPage`, `loading`, row `clickDelegate`; `s-stack` `gap`/`alignItems`/`justifyContent` values; `s-box` `border`/`background`/`borderRadius`/`padding`; `s-text` and `s-paragraph` `color="subdued"`; `s-badge icon="lock|alert-circle"`; `s-banner dismissible`; `s-switch label/checked` | Same validator; if `s-grid` container queries are unsupported, use `s-grid` with fixed columns and `s-stack` fallbacks |
| Accessible name and semantics of `s-table` | ADR-0004 needs the table to be the unambiguous primary. `s-table` has no `<caption>`; I set `aria-label` on the host, which only works if the host owns the table role. **Run axe on Results and History detail.** If it fails, fall back to the v1 native `<table>` + `<caption>` + `scope` inside `s-section` (approved at G2 v1) | axe-core, plus a screen-reader pass |
| `role="group"` and `aria-label` on `s-box` (each rule row) | Same host-ARIA caveat | axe |
| Form participation of Polaris fields under `form[data-save-bar]` | Fields must fire `input`/`change` that App Bridge sees; Save = submit, Discard = reset | Test embedded on a dev store |
| `commandFor` / `command="--show" / "--hide"` on `s-modal` | The live app already uses it | Test embedded |
| Toast action (`shopify.toast.show(msg, { action, onAction })`) | Signature may differ | Check current App Bridge docs |
| Banner action slots | I avoided slotted banner buttons and used inline `s-link`s because slot names are uncertain | n/a |
| `s-empty-state` | May exist; I composed the empty state from stack/heading/paragraph/button as the safe option | Swap if available |
| Container-query breakpoints (560 / 640 / 720 px) at the two target widths | Chosen so that ~600px iframe stacks everything and ~1000px shows 3-up tiles, 3-column rule rows and table + chart side by side. I could not render it, and which element `@container` measures is unconfirmed | Look at both widths in a browser |
| Colour contrast of the new palette | Calculated by hand (each >= 3:1 on white), not tool-measured | axe / contrast checker |
| Table sort order | Mockup sorts largest-first (as v1 did). I did not confirm the app's current order | Check `ExpenseBreakdown`; either is fine, just be consistent between Results and History detail |
| Engine version "1.0.0" shown on History detail | Carried from v1 mockup | Use `calculation.engine_version` |

## 9. Accessibility (WCAG 2.1 AA) approach

- **Table is the primary chart equivalent**: first in DOM order, always rendered; the donut is `role="img"` with one summarising `aria-label` (states the basis) and everything inside it `aria-hidden`; the legend is a real list with label + share; all numbers appear as text.
- **Not colour-only**: "Off" badge, "Expenses exceed revenue" badge with minus sign, "Snapshot" badge with lock icon, error text (not just red), swatches always paired with labels.
- **Labelled inputs**: every field has a visible Polaris label; switch label = category name; each rule row is a named group; errors are set through the field's `error` so Polaris associates them; the rules error summary lists links to each field.
- **Keyboard**: no custom widgets; the only custom elements are the SVG (not interactive), the legend, and preview-only aids. History rows are reachable through the date link (unique link text) and `clickDelegate` is a mouse convenience only.
- **Focus management**: on a failed Calculate or Save, focus moves to the first invalid field.
- **Motion**: none added.
- **Responsive**: stacks below ~560-720px container widths, so ~600px shows one column and ~1000px shows the wide layouts (unverified visually; see section 8).

## 10. Suggested `audit_log` entry (orchestrator to record; I do not edit `project.json`)

`action: g2_revision_v2_mockup_proposed` · `actor: designer-agent` · details: files under `design/v2/` and `listing-assets/logo/`; IA v2; J1-J12 awaiting Design lead decision; recommended logo concept 1; not verified: browser render, axe, Dev MCP validation. No gate decision recorded.
