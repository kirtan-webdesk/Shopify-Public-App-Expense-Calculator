# G2 Design Notes — expense-calculator

| | |
|---|---|
| **Gate** | G2 (design-approval, project.json v9) |
| **Status** | **PROPOSED mockup — for Design lead review. Not self-approved.** |
| **Author** | designer agent, 2026-09-18 |
| **Approver** | Design lead (role — named approver TBD, OQ-7 open; project stakeholder in the interim) |
| **Deliverable** | Working HTML/Polaris mockup (per `design.tool: HTML`, D-DES-01) — see `design/mockup/` |
| **Inputs** | `project.json` v9 · `spec.md` (D1, D4–D6, D8–D11) · `decisions/data-model.md` · `decisions/ADR-0004-charting-inline-svg-donut.md` · `decisions/ADR-0005-money-integer-minor-units.md` · `decisions/ADR-0006-zero-admin-api-dependency.md` |

This document does not itself constitute the G2 deliverable — `design/mockup/*.html`
does. This is the reviewer's map of what's in it and where I made a judgment call
instead of silently deciding.

---

## 1. Why G2 fires, not reduced/skipped

This app has an operational merchant UI — calculator input, results, save/history —
not a background job with no surface. `project.json` records G2 as a
"reduced-UI candidate pending OQ-8"; OQ-8 was never separately closed with a
"build-from-SOW, light review" answer, and the source doc's `0/0` mockup-revision
budget is explicitly non-authoritative per spec.md §11.6. This mockup runs the
**full** G2 workflow: a real, running HTML/Polaris mockup, not a sign-off on the
foreign SOW.

---

## 2. What's in `design/mockup/`

| File | Screen |
|---|---|
| `calculator.html` | Screen 1 — revenue input + all 10 expense-category rules (percentage / fixed / formula), validation |
| `results.html` | Screen 2 — accessible data table (primary) + hand-rolled SVG donut (supplementary), save-to-history flow |
| `history.html` | Screen 3a — saved-calculations list, pagination, empty state |
| `history-detail.html` | Screen 3b — a single saved calculation rendered from its frozen snapshot |
| `assets/styles.css` | Polaris-token-referencing layout CSS (no competing token system) |
| `assets/mockup.js` | Shared interaction layer: save-bar dirty state, validation, donut generation, modal/toast wiring, results preview switcher |

Open any HTML file directly in a browser to review — no build step. (Custom
elements from the CDN scripts will only fully render/style when there's network
access to `cdn.shopify.com`; the CSS fallbacks keep the layout legible offline,
but the real Polaris chrome requires the live CDN scripts, same as the production
app will.)

---

## 3. The three hard constraints — confirmed met

1. **Polaris web components (CDN), not Polaris React.** Every page uses
   `<s-page>`, `<s-section>`, `<s-text-field>`, `<s-select>`/`<s-option>`,
   `<s-banner>`, `<s-badge>`, `<s-button>`, `<s-link>`, `<s-modal>` from
   `https://cdn.shopify.com/shopifycloud/polaris.js`. No `@shopify/polaris`
   (React) import anywhere. **Verify at build:** exact tag/attribute set
   (e.g. `<s-text-field>` prop names, `<s-modal>` slot names, whether a Polaris
   data-table web component exists and is preferable to the native `<table>`
   used here) against the polaris.js version resolved at build time — the skill
   only hard-confirms `s-app-nav`/`s-link`/`s-modal`; everything else is
   "verify at build" by the skill's own instruction.
2. **Latest App Bridge in `<head>` of every page.** All four HTML files load
   `https://cdn.shopify.com/shopifycloud/app-bridge.js` (plus the
   `shopify-api-key` meta tag, which precedes it) before any other script,
   unpinned so it always resolves to latest. This is what makes Shopify collect
   Web Vitals post-launch — non-negotiable per the skill, done from day one so
   it's never a retrofit.
3. **Navigation via `s-app-nav`/`s-link`, not a custom sidebar.** Every page has
   the same two-item `<s-app-nav>` (Calculator, History). No bespoke nav markup
   anywhere.

WCAG 2.1 AA — see §6.

---

## 4. Judgment calls for the Design lead to accept or override

None of these were silently decided; flagging each explicitly.

1. **Category rule layout: native `<details>`/`<summary>` disclosures, one per
   category, collapsed-by-default with a live "at a glance" summary
   (e.g. "32.5% of revenue").** Ten categories, each with a rule-type choice and
   a conditional value field, is a lot of vertical space if fully expanded. I
   chose native disclosure elements over a custom accordion because they're
   keyboard-operable and exposed to assistive tech with zero extra ARIA
   plumbing, and the collapsed summary line lets a merchant scan all 10 rules at
   once before drilling into any one of them. Alternative considered: a flat
   table of 10 rows with inline selects — rejected because a table cell can't
   cleanly host "type selector + conditional value field + validation message"
   without becoming a nested table itself.
2. **Calculate uses whatever is currently in the form, saved or not** (banner
   text on `calculator.html` says this explicitly). Editing a rule's value marks
   the page dirty and raises the contextual save bar (persisting to
   `expense_rule`), but a merchant can hit **Calculate** before saving to
   preview an unsaved change. This is deliberate — a calculator that forces a
   save before it will compute anything is a worse tool — and it's structurally
   safe: `calculation_line_item` stores a value-copy of whatever was applied
   (data-model.md §4.4), not a reference to the live `expense_rule` row, so an
   unsaved-at-calc-time value still snapshots correctly if the merchant then
   saves the calculation. **Alternative if this is unwanted:** require Save
   before Calculate is enabled; flag if the Design lead prefers that stricter
   flow.
3. **Currency selector lives inline on `calculator.html`**, not on a separate
   settings screen. ADR-0006 confirmed currency is merchant-configured (no
   Admin API call), and the spec doesn't scope a settings screen. Putting the
   one settings field that exists next to Revenue keeps the three-screen scope
   intact instead of inventing a fourth screen for a single field. Flag if a
   dedicated Settings screen is wanted later — it's additive, not a rework.
4. **Frozen-snapshot signal on `history-detail.html` — four layered
   mechanisms, not just a banner color:**
   - An explicit-copy banner at the very top, before any numbers, stating the
     save timestamp and that current-rule edits are not reflected, with a link
     to compare against current rules.
   - An inline lock icon + "Snapshot" `<s-badge>` next to the page heading.
   - Every value on the page renders as plain text (`<span>`), never inside a
     form control — there is no `Save` button anywhere on this page, unlike
     `results.html`. The *absence* of an editable affordance is the most
     WCAG-robust part of the signal: it doesn't rely on a merchant reading and
     retaining banner copy, and it doesn't rely on color.
   - `engine_version` is shown next to the Snapshot badge, surfacing the
     "computed by which build" fact from `calculation.engine_version`
     (data-model.md §4.3) for merchants/support who need it.
   I added a **"Duplicate as new calculation"** action (not in spec) that routes
   to `calculator.html` — a low-risk affordance that gives a merchant somewhere
   to go with "I want to update this," instead of being tempted to think the
   detail page itself is editable. Flag for accept/reject; it's the one addition
   here beyond what D11 literally asks for.
5. **`results.html` includes a "design review aid" preview-state switcher**
   (clearly boxed and labeled as non-merchant-facing) that swaps in five
   fixture datasets so the Design lead can see every ADR-0004-mandated chart/
   table state — zero revenue, all-categories-zero, single non-zero category,
   several sub-1% slices, and the typical case — without needing five separate
   mockup pages. **This control does not ship**; it's a review aid the developer
   should strip, and it's visually/structurally isolated (dashed border, own
   CSS class, own DOM region) so it can't be mistaken for product UI.
   `history.html` has the same pattern for its empty state.
6. **Donut technique: stacked `stroke-dasharray` circles with `pathLength="100"`**,
   not arc/path math. This is a simpler, well-understood hand-rolled technique
   than computing SVG arc `d` paths by hand, satisfies ADR-0004's "no charting
   library" requirement, and makes the degenerate states tractable: a single
   100%-share category renders as one unbroken ring (no seam), sub-1% slices are
   floored to a minimum visible dash length so they don't disappear, and
   zero-revenue/all-zero renders a distinct neutral empty ring rather than a
   blank or broken chart. `buildDonutSvg()` in `assets/mockup.js` is a pure
   function, matching the "pure function" framing in ADR-0004's own decision
   text.
7. **Formula rule-type options are placeholders** (`"Tiered by revenue band
   (app-defined)"`, `"Per-unit average (app-defined)"`), explicitly labeled as
   such in the UI copy on the Payroll row. OQ-4 (default rates/formula set) is
   still open per spec.md §13.2 — these exist only to prove the layout handles
   a `<select>`-based formula picker; they are **not** a proposal for the real
   formula set and should not be read as one.
8. **All sample figures (revenue, category rates, saved-history rows) are
   illustrative mockup data**, chosen so the numbers reconcile exactly
   (`sum(line items) === total`, matching ADR-0005's invariant) for a
   convincing demo. They are not the OQ-4 default-rate sign-off.
9. **Accessible data table implemented as native `<table>`**, not a Polaris web
   component, specifically for the results/history screens where ADR-0004
   requires the table to be the unambiguous, always-rendered accessible
   primary. Native table + `<caption>` + `scope` attributes gives the strongest,
   least-ambiguous accessibility guarantee without depending on whether a
   Polaris "data table" custom element exists yet for web components or matches
   this exact semantic shape. **Verify at build** whether Polaris now ships one
   and whether swapping is worth it — if so, it must preserve `<caption>`,
   `scope`, and reading order, not just look like a table.

---

## 5. App Bridge primitives used (not cloned)

| Primitive | Where | Notes |
|---|---|---|
| Navigation | `<s-app-nav>` / `<s-link>`, every page | No custom sidebar |
| Contextual save bar | `calculator.html`, rule-edit dirty state | `<ui-save-bar>` shown/hidden via JS on input change; **verify at build** exact element/API against the resolved app-bridge.js |
| Modal | `results.html`, save-calculation confirmation | `<s-modal>` per the skill's explicit guidance; **verify at build** slot/attribute names |
| Toast | Save/discard confirmations | `window.shopify.toast.show(...)`; **verify at build** exact API surface |
| Resource picker | Not used | Nothing in D1–D16 selects a Shopify resource (no products/orders touched — ADR-0006) |

---

## 6. WCAG 2.1 AA — how it's satisfied, not just asserted

- **Every input has a real `<label>`** (via Polaris `label` attributes or
  explicit `<label for>` on the native enable-toggle checkboxes/radios).
- **Validation errors** are in `aria-live="polite"` regions tied to the field
  (`data-error-for`), and invalid fields get `aria-invalid="true"` on blur
  (`calculator.html`, percentage/fixed inputs) — errors are announced, not just
  colored red.
- **The donut chart's accessible name is one summarizing `aria-label` on the
  outer `<svg role="img">`; every element inside it is `aria-hidden="true"`.**
  This is ADR-0004's own accessibility design, implemented literally: a screen
  reader user gets one coherent announcement from the chart, then reads the
  real numbers from the table that sits right next to/above it in DOM order —
  there is no parallel "accessible alt version" to keep in sync because the
  table *is* the primary version.
  The table is never behind a tab, toggle, or `display:none` — it is
  unconditionally rendered.
- **Native `<details>`/`<summary>`** disclosures are keyboard-operable
  (Enter/Space toggles, Tab moves through them) with no custom ARIA needed, and
  a visible focus ring (`:focus-visible`) using the Polaris focus-border token.
- **Color is never the only carrier of meaning.** Every donut slice's swatch is
  paired with a text label and a numeric value in both the legend and the
  table; the "Snapshot" signal on `history-detail.html` is carried by copy +
  icon + badge + the absence of editable controls, not by a background tint
  alone.
- **Frozen-snapshot values render as plain text, not disabled form controls** —
  a `disabled` input is a known AA trap (announced inconsistently, sometimes
  skipped by assistive tech, easy to mistake for "temporarily can't edit" rather
  than "permanently can't edit"). Plain text with a `<caption>`/label pairing
  the value's meaning avoids that trap entirely.
- **Heading structure**: each `<s-page heading>` establishes the page-level
  heading; `<s-section heading>` establishes the next level down; no skipped
  levels.
- **Responsive/embedded-iframe behavior**: `.results-grid` is single-column
  (table full-width, chart stacked below) under 768px and becomes a two-column
  layout (table ~58%, chart ~42%) above it, matching Shopify Admin's narrower
  embedded breakpoints without ever hiding the table.
- **Not yet run**: an actual axe-core pass. This is HTML/CSS/JS with no build
  tooling wired up in this repo yet (that's G3/M1) — I did not fabricate a tool
  run. The structural choices above (semantic table, real labels, native
  disclosure, one accessible name per chart, no color-only meaning) are the
  same properties an axe-core pass checks for; flagging the actual automated
  run as **outstanding**, to happen once this mockup is wired into the real app
  shell at G3, and again at G5 per ADR-0004's FT-19a.

---

## 7. Verify-at-build register (carried into the developer handoff)

| Item | Why |
|---|---|
| Exact Polaris web-component tag/attribute names beyond nav/modal (e.g. `<s-text-field>`, `<s-select>`/`<s-option>`, `<s-banner>`, `<s-badge>`, `<s-button>` props/slots) | Skill only hard-confirms nav/modal/save-bar categories; everything else is versioned |
| Exact `<ui-save-bar>` element name and JS API (`.show()`/`.hide()` assumed) | Confirm against the resolved app-bridge.js |
| Exact `<s-modal>` slot names (`primary-action`/`secondary-actions` assumed) | Confirm against the resolved polaris.js |
| Exact `shopify.toast.show(...)` API surface | Confirm against the resolved app-bridge.js |
| Whether Polaris now ships a data-table web component, and whether it preserves the same table semantics (`caption`, `scope`) used here | If so, may be worth adopting instead of the native `<table>` — must not regress accessibility |
| Real formula-key set and default rates (OQ-4) | Placeholder values throughout this mockup are explicitly not a proposal |

---

## 8. Not built at G2, and why that's the right scope

- **No settings screen.** Currency lives inline on the calculator screen (§4.3).
- **No fifth "edge state" screen set for the donut/table.** Covered via the
  in-page, clearly-labeled preview switcher on `results.html` instead (§4.5) —
  keeps the deliverable at the three specified screens while still
  demonstrating every ADR-0004-mandated state to the approver.
- **No loading/error/skeleton states.** These are wiring concerns that depend
  on the real React Router 7 loader/action shape (G3+), not on the visual
  design; the developer should add Polaris skeleton/loading equivalents
  consistent with the components used here, not invent new visual language.

---

_This mockup is a PROPOSAL awaiting the Design lead's G2 decision in
`project.json`. It is not self-approved. On CONFIRM, the mockup version should
be tagged in `audit_log` and handed to the developer as the production scaffold
per the standard G2 workflow — the developer refines this markup into the React
Router 7 app, it does not rebuild it from scratch._
