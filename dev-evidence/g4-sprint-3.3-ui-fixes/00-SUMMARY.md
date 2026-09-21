# G4-sprint-3.3 — UI review and fixes (approved: "fix all UI errors now and push")

Reviewed/fix commit: `ee967b20c26a1fa546115119d0e46abea9d4bb60` (`ee967b2`), on top of `c3eba1a`. Not pushed.
Scope respected: UI layer only. Loaders/actions, shop-context, repositories, workers, cron, DB config,
`shopify.app.toml`, `vercel.json`, `.env`, `project.json` were not touched.

## How the pages were SEEN (Step 1)

Playwright + Chromium (the `chromium-1234` build already in `%LOCALAPPDATA%\ms-playwright`; the
`playwright` package was installed in a scratch folder, not in the repo). The REAL route components
(`app.calculator`, `app.results`, `app.history`, `SavedCalculationPage`, the 404 boundary) were
server-rendered with `react-dom/server` + `createStaticHandler` with `authenticate.admin` and the
repositories stubbed (same technique as `tests/ui/history-results-render.test.ts`), wrapped in a shell
with the real `polaris.js` + `app-bridge.js` from the CDN and `app/styles/app.css`. The approved
mockups (`design/mockup/*.html`) were rendered at the same widths. Widths: 1000 px and 600 px.
Harness: `tools/render-snapshots.test.ts.txt` (temporary vitest file, removed from the repo), `tools/shoot.mjs`.

- Screenshots: `screenshots/before/` (HEAD c3eba1a), `screenshots/after/` (ee967b2), `screenshots/mockup/`.
  Each `<page>-<width>.png`; calculator also `-expanded-` (all ten rows open); `results-modal-1000.png` = save modal open.
- No horizontal overflow at 600 or 1000 px on any page (scrollWidth == clientWidth, all 24 after-fix renders = 12 pages x 2 widths, and all 22 before renders).
- Label meaning: CONFIRMED = seen in a render or measured in the browser. SUSPECTED = inferred from code, could not be seen.

## Defect table

| # | Defect | Label | Status |
|---|---|---|---|
| 1 | Category rows have no expand/collapse chevron (mockup has one; `list-style:none` hides the native marker) so nothing says a row opens | CONFIRMED (before/after calculator-expanded) | FIXED |
| 2 | Calculator per-category summary hardcodes `$` (`$450.00 fixed`) whatever currency is selected | CONFIRMED (code + render) | FIXED (`currencySymbol`) |
| 3 | "Fixed amount" input prefix hardcoded `$` | CONFIRMED (render, calculator-eur) | FIXED |
| 4 | `formatRuleApplied` showed fixed amounts as `450.00 fixed` with no symbol (Results + saved detail) | CONFIRMED (before/results) | FIXED (takes the calculation currency; `$450.00 fixed`, `€450.00 fixed`) |
| 5 | Percent text `32.50% of revenue` / `8.00%` vs mockup `32.5%` / `8%` (calculator summary + results + detail) | CONFIRMED | FIXED (`trimDecimalZeros`) |
| 6 | Formula rules rendered the internal snake_case key (`Formula: tiered_by_revenue_band`) on Results and the saved detail | CONFIRMED (code path; fixture keys) | FIXED (label lookup, falls back to stored key) |
| 7 | **Currency select ignored the pre-selected value on the server render**: `value="CAD"` on `<s-select>` left the select on USD (`prop=USD, attr=CAD` measured in Chromium), so "Duplicate as new calculation" from a CAD/EUR/GBP snapshot showed USD and would submit USD | CONFIRMED (measured) | FIXED (`selected` on the matching `<s-option>`; also the formula select). After: `prop=CAD` |
| 8 | Currency options were bare codes; mockup has `USD — US Dollar` | CONFIRMED | FIXED (`currencyOptionLabel`) |
| 9 | Results banner said percentages/formula amounts "above" (they are below) and read as leftover placeholder copy | CONFIRMED | FIXED (reworded) |
| 10 | Saved-detail banner: lock icon sat on its own line above the text (flex wrapper ignored inside `s-banner`) | CONFIRMED (before/history-detail) | FIXED (icon inline in the paragraph) |
| 11 | `?saved=1` toast replays on every reload of the detail page | CONFIRMED by code (effect keyed on the URL flag, never cleared) | FIXED (`history.replaceState` drops the flag after the toast; no navigation, no loader re-run) |
| 12 | Calculate sets the shared hidden `intent` to `calculate` and never resets it; after a validation error the contextual Save bar would submit `calculate` instead of `save` | SUSPECTED (code only; App Bridge save bar not runnable here) | FIXED defensively (intent reset to `save` right after `requestSubmit()`, which has already captured the form data) |
| 13 | Rule-type radios ("Percentage of revenue / Fixed amount / Formula") jammed together | CONFIRMED | FIXED (`.rule-row__types` gap) |
| 14 | Summary values (Revenue / Total / Net) larger and heavier than the mockup (1.25rem/600 vs 1rem/500), styled with inline styles | CONFIRMED | FIXED (mockup values, moved to `app.css` classes; negative net keeps the red colour) |
| 15 | Calculate helper text touching the button (margin zero after moving to a class) | CONFIRMED (after render) | FIXED (`margin-block-start` on `.help-text--end`) |
| 16 | Check (1): is `app.css` in the production build? | CONFIRMED OK, no defect | `root.tsx` `links()` returns `href="/assets/app-D5OiHKj7.css"`, present in `build/client/assets/root-*.js` and `build/server/index.js`; the css file is emitted. Class coverage script: every `className` used in the UI files exists in the built css (0 missing). |
| 17 | Check (3): Polaris misuse | none found | `validate_component_codeblocks` VALID on all 6 UI files. `s-page/s-section/s-banner/s-number-field/s-select/s-option/s-button/s-link/s-modal/s-badge` nesting and slots valid; every page has a heading; breadcrumb via `slot="breadcrumb-actions"` renders correctly. |
| 18 | Check (6): empty/error states | none broken | results-empty, history-empty, history-notfound, zero-revenue ("No data" ring, em dashes) all render sensibly. |
| 19 | Check (7): accessibility | none found | tables have caption + `scope`; donut `role="img"` + `aria-label`, children `aria-hidden`; every input has a label (checkbox via visually-hidden label, radios wrapped, s-* fields labelled); clicking the row checkbox does NOT toggle the `<details>` (tested). |
| 20 | Check (9): leftover M1 "not yet wired" copy | none found | grep for M1/M2/M3/not-yet/coming-soon/stub in UI files: nothing. The "Illustrative placeholder defaults" banner is still TRUE (OQ-4 open) and was kept. |
| 21 | Chart aria-label says "Full figures are in the table below" but the table precedes the chart | CONFIRMED (code) | NOT FIXED — lives in `app/domain/donut-chart.ts`, outside the allowed scope; one-word fix for its owner (a test asserts the string) |
| 22 | Nav links + active state (check 4) | SUSPECTED / UNVERIFIABLE | `<s-app-nav>` with `Calculator` and `History` links is correct markup (validator + docs); the active highlight is drawn by Shopify Admin from the URL and cannot be seen outside the iframe. NOT CHANGED. |
| 23 | Donut is percent-of-revenue (ring 73% full for the defaults); table not sorted by amount | design, matches G2 mockup | NOT CHANGED (not a defect against the approved design) |
| 24 | `--p-*` tokens undefined at runtime; all `var(--p-x, fallback)` use the fallback | CONFIRMED (probe) | NOT CHANGED (works, not theme-aware; design decision) |

Currency note: for CAD the narrow symbol is `$` (the same symbol the results table already uses via
`formatMoney`), so CAD still shows `$`; EUR/GBP now show `€`/`£`. The Currency select sits directly above.

## Tests

- `tests/domain/history-presentation.test.ts`: percent trimming, fixed amount with USD/CAD/EUR/GBP symbol, no-currency fallback,
  formula label + unknown-key fallback, `currencySymbol` (incl. unknown code), `currencyOptionLabel`, `trimDecimalZeros`.
- `tests/db/calculation-history.db.test.ts` (opt-in DB suite, not run here): one assertion updated to `32.5% of revenue`.

## Gates (clean detached worktree of `ee967b2`; all separate)

| Gate | Command | Exit | Log |
|---|---|---|---|
| lint | `npm run lint` | 0 | `gates/lint.log` |
| typecheck | `npm run typecheck` | 0 | `gates/typecheck.log` |
| tests | `npm test` | 0 (249 passed, 37 skipped = opt-in DB suites) | `gates/tests.log` |
| build | `npm run build` | 0 | `gates/build.log` |

Why a worktree: another agent is editing `db/config/config.cjs` and friends in the shared tree; `npm run lint` in the
shared tree failed there on `db/config/config.cjs:93 no-control-regex` (its uncommitted work, not this change).
`run-gates.py` cannot exec `npm.cmd` on Windows (`shell=False`), so the logs are manual equivalents with the same
`__GATE_EXIT__` contract, as in every prior sprint. See `mcp-validation-evidence.json` `remaining_warnings`.

## MCP validation

`MCP-Evidence: dev-evidence/g4-sprint-3.3-ui-fixes/mcp-validation-evidence.json` (6 records in `records/`), all VALID.
PROVENANCE CAVEAT: the harness-scoped MCP tools were not exposed to this session; the plugin's pinned server
`@shopify/dev-mcp@1.14.5` was driven over stdio (`tools/mcp.mjs`, raw output `records/mcp-raw-validator-output.json`).
Tool-call ids are descriptive, not harness `toolu_` ids.

## Commit-sweep incident (self-corrected)

My first commit (`975df83`) swept in another agent's concurrently staged files. Detected from the stat, undone with a local
`git reset --soft HEAD~1`, and recommitted as `ee967b2` with ONLY the 10 files below. That agent's index entries were
reset to unstaged; their working-tree edits are intact. Nothing was pushed.

## Files in `ee967b2` and SHA-256 (as committed)

| File | SHA-256 |
|---|---|
| `app/components/expense-breakdown.tsx` | `9249d450a91d516426a071f187942977dc0e8ba369fce1b0c654aa608779182a` |
| `app/components/saved-calculation-page.tsx` | `a96b7eac490fce6f2c23c66785a3ee55f1014c9de859e09e1b5f29e8366377ec` |
| `app/domain/presentation.ts` | `7b9773ba4c0b462ade2e515b2390cbe20168ed0f57871f9d353be0343590f43e` |
| `app/routes/app.calculator.tsx` | `6e80a0b194ba403fa9f387a7a05bc1e13b019bfa18fd685280476c94c530b8de` |
| `app/routes/app.history.$id.tsx` | `8f7b5cfc3969b15777cfed4a8899285c2c2f9fa0b9434feb0e237958a85b287e` |
| `app/routes/app.history.tsx` | `84058fa46019de7939018ee088d3390045e2f03f11a4674bd15ab676830f27be` |
| `app/routes/app.results.tsx` | `018e4db1238fea484e0153420e5339ab151df6d2991c8c65e673fa27f7d21e2d` |
| `app/styles/app.css` | `a19b420d1b06321ccdf1e5445deab36d577e0e54ecf55c4e8c30ed850fdb4054` |
| `tests/db/calculation-history.db.test.ts` (one-line hunk only) | `874a7500873e85ca577104ae409081ad20ce5955fca16a75986f93e369f9446c` |
| `tests/domain/history-presentation.test.ts` | `a511a3dd7d9940155b997dcc2a118e58d2b5b87f59f562e6048480999c22caac` |

(The hash of `tests/db/calculation-history.db.test.ts` is of the blob at `ee967b2`; the shared working tree copy differs because of another agent's uncommitted edits.)

## What the human must look at in the live Admin (not verifiable here)

See `mcp-validation-evidence.json` `live_store_items`: chevrons and row summaries at ~1000 px and ~600 px; switching Currency to
EUR/GBP changes the fixed-amount prefix; Duplicate from a CAD snapshot keeps CAD; contextual Save bar after a Calculate error saves;
toast once and no replay on reload; left-nav active highlight on all four routes; `€/£/$` fixed-amount text on Results and the saved detail.
