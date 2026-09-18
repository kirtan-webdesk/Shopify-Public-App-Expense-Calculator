# ADR-0004 — Render the expense breakdown as a hand-rolled inline SVG donut over an always-rendered data table; no charting library

| | |
|---|---|
| **Status** | PROPOSED — pending G1.5 approval (Tech lead). Not self-approved. |
| **Date** | 2026-09-17 |
| **Gate** | G1.5 |
| **Satisfies** | A5 ("one charting approach is chosen at G1.5 and not revisited") |
| **Related** | D9, spec.md §12, S3.2 acceptance criteria, ADR-0005 |

---

## Context

D9 requires a donut/pie chart of the expense breakdown. Polaris web components do
not provide one, so this is an explicit architecture decision assigned to G1.5,
and A5 prices the estimate on it not being revisited in M3.

The requirement is precisely **one** chart type, over **at most ten** slices, of
numbers the app has already computed client-side-available, rendered inside an
Admin iframe, and required by S3.2 to be "keyboard- and screen-reader-accessible
or have an accessible equivalent".

## Decision

**The results view renders an accessible data table as the primary
representation, with a hand-rolled inline SVG donut as a visual enhancement
beside it.** Both render from the same computed line-item array; neither derives
numbers the other doesn't have.

- The donut is SVG arcs (or stroked circle segments) produced by a small pure
  function from `[{ categoryKey, label, amountMinor, percentage }]`. No
  third-party dependency, no canvas.
- The SVG carries `role="img"` and an `aria-label` summarising the breakdown, and
  is `aria-hidden` from the screen-reader traversal of the numbers themselves —
  the table is the accessible source of truth, so there is no parallel
  "accessible alternative" to keep in sync.
- Colour is never the only carrier of meaning: every slice's label, amount, and
  percentage appear in the table, and the legend pairs swatch with label.
- Mandatory states, specified now because they are where hand-rolled charts
  break: zero revenue, all-categories-zero, exactly one non-zero category
  (full ring, not a degenerate arc), slices under ~1% (rendered, not dropped),
  and rounding such that percentages display consistently with ADR-0005's totals.

## Alternative considered: a charting library (Chart.js, Recharts, visx, ECharts)

The conventional choice, and it would be right for a product with several chart
types or interactive analytics. Rejected here because the app needs exactly one
static chart:

- **Chart.js** renders to canvas, which is accessibility-hostile — it forces the
  parallel accessible table anyway, so the table gets built regardless and the
  library only adds the canvas.
- **Recharts / visx** pull React charting stacks (and for Recharts, D3 modules)
  into a bundle that loads inside an Admin iframe, for one donut. They also bring
  a version-upgrade and CVE surface we then own for the life of the app.
- Any library brings styling that must be fought into Polaris visual alignment —
  typically as much work as drawing the arcs.

The cost of rejecting it is real and should be stated: **we own the geometry and
the edge cases.** Arc maths, label placement, responsive sizing, and the
degenerate states above are our bugs. That is roughly a day of work and a handful
of snapshot tests — versus a dependency, a bundle, and a styling fight. At one
chart, hand-rolled wins; at four charts it would not.

**Revisit trigger:** if V2 adds a second or third chart type (trend lines,
comparisons), re-open this ADR rather than accreting a bespoke chart library.

## Consequences

- **No new runtime dependency.** Keeps the external-dependency count at three
  (architecture packet §2) and keeps the CSP story simple — no additional script
  origin beyond the Shopify CDN.
- Small, predictable bundle; no hydration-heavy chart component in the iframe.
- Accessibility is satisfied by construction rather than retrofitted, which is a
  G2 and G-Review risk retired early (R6).
- The table-first framing is also a **design input for G2** — the mockup cycle
  (OQ-8) should treat the table as primary and the donut as supporting, not the
  reverse. Flag this to the design path; a mockup that makes the donut the hero
  contradicts the accessibility decision.
- Estimate effect: lands at the lower end of the M3 range rather than adding to it.

## Enforcement

| Mechanism | What it catches |
|---|---|
| **FT-12b** custom dependency check: no charting library in `package.json` (deny-list: `chart.js`, `recharts`, `d3*`, `echarts`, `victory`, `nivo`), and no Polaris React (`@shopify/polaris`) | The decision being quietly reversed by an `npm install` |
| **FT-19** vitest: chart and table render identical numbers from the same fixture; the five edge states render without throwing | Divergence between the two representations; degenerate-state crashes |
| **FT-19a** accessibility assertion in the component test (axe or equivalent) over the results view | Regression of the a11y property the whole decision rests on |
| Gated at **G5** (M3) | |

**Verify-at-build:** exact Polaris web-component tags/attributes used around the
chart (layout, card, legend) against shopify.dev for 2026-07.
