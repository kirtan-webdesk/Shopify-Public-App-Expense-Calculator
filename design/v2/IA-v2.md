# Information architecture v2

Status: PROPOSED for the G2-revision (Human design gate). Not self-approved.

## 1. Diagram

```
Shopify Admin sidebar                     App routes (React Router 7, under /app layout)
---------------------                     ----------------------------------------------
Expense Calculator   (app name)  ------>  /app  -> redirect -> /app/calculator   (rel="home")
  |- Expense rules   (child)     ------>  /app/rules                              NEW
  '- History         (child)     ------>  /app/history
                                              '- /app/history/:id                 (sub-page, reached from History)

  (not in the sidebar)
  /app/calculator  --Calculate-->  /app/results?d=...   (sub-page, reached from Calculator; breadcrumb "Calculator")
  /app/results     --Save------->  /app/history/:id?saved=1
  /app/history/:id --Duplicate-->  /app/calculator?from=:id   (revenue + currency only)
  /app/calculator  --"Edit rules" link-->  /app/rules
  /app/rules       --toast action "Calculate"-->  /app/calculator
```

`app.tsx` nav (production markup):

```html
<s-app-nav>
  <s-link href="/app/calculator" rel="home">Calculator</s-link>   <!-- hidden from the child list; the app name links here -->
  <s-link href="/app/rules">Expense rules</s-link>
  <s-link href="/app/history">History</s-link>
</s-app-nav>
```

Change from today: the "Calculator" child disappears (already done in code via `rel="home"`); **Expense rules** is added.
The sidebar shows exactly two children. Results and History detail stay off the sidebar because each has one natural parent
and a breadcrumb back to it.

## 2. What each page owns

| Page | Owns | Does not own |
|---|---|---|
| **Calculator** (home) | Revenue, currency, a compact **read-only** table of the 10 saved rules (with a "Placeholder rates" badge and an "Edit rules" link), the **Calculate** action | Editing rules, save bar |
| **Expense rules** | The 10 category rules (on/off, type, value), placeholder-rate banner, App Bridge contextual save bar, optional "Reset to placeholder defaults" | Revenue, currency, results |
| **Results** | Estimate-only banner, Revenue / Total / Net figures, breakdown **table (primary)**, donut + legend (supplementary), "Save calculation" (modal), "Change revenue" | Saving rules, history |
| **History** | Paginated list, newest first; the date is the row link; empty and loading states | Editing anything |
| **History detail** | Frozen snapshot (banner + Snapshot badge + plain-text values + engine version), table + donut from the stored snapshot, "Duplicate as new calculation" | Any Save or edit affordance |

## 3. Decisions and why

1. **Calculator = revenue + currency + read-only rule summary + Calculate.** Merchants come back to this page every time; it
   should be short enough to use without scrolling past 10 rule cards. The summary answers "what will this use?" without
   inviting edits, and "Edit rules" is one click away. Results appear on a separate `/app/results` page (unchanged from v1):
   it keeps the calculator light, gives the estimate its own URL and breadcrumb, and keeps the "estimate, not saved yet"
   state distinct from the saved-calculation state.
2. **Calculate now uses the SAVED rules (this changes a G2-v1 decision).** v1 said "Calculate runs on unsaved form state".
   After the split, unsaved rule edits live only on the Rules page and cannot be carried to Calculator, so there is no
   unsaved state to calculate on.
   - Trade-off: the merchant loses "try a rate without saving it". Cost of the workaround: edit, Save (one click in the save bar),
     Calculate. Benefit: a single source of truth (every result and every snapshot is reproducible from saved rules), no
     transporting rule payloads in the URL, and no "which values did this use?" ambiguity.
   - UX for unsaved changes: the Rules page uses the App Bridge contextual save bar (`form[data-save-bar]`). While there are unsaved
     edits, App Bridge shows Save / Discard, and navigating away (including the Admin sidebar) triggers Shopify's "Leave page?"
     prompt, so a merchant cannot silently reach Calculator with edits pending. After Save, a toast confirms and offers a
     **Calculate** action. The Calculator and Results pages both state "uses your saved rules".
3. **"Reset to placeholder defaults" on Rules: proposed, OPTIONAL (default: include).** It fills the form only; nothing is written
   until Save and Discard undoes it, so it is non-destructive and needs no scary confirmation beyond a light modal. It is
   removable without touching anything else (one secondary action + one modal).
4. **Duplicate as new calculation** copies revenue and currency only. Rules are always the saved rules; the banner says so and links to
   the snapshot's rules. (v1 also copied the snapshot's rule values into the form; that no longer fits once rules live on their own page.)
5. **Approved product rules kept:** merchant-entered revenue (stated under the field, always visible); placeholder-rate labelling on
   Calculator (badge + sentence), Rules (banner) and Results (banner); ADR-0004 (table first and always rendered, hand-rolled SVG donut
   supplementary, no chart library); frozen-snapshot signals on History detail; zero-revenue and degenerate chart states, with
   the donut plotted by **expense amount** and its basis (share of revenue vs share of total expenses) stated on screen.

## 4. Deep-link and state rules

- `/app` redirects to `/app/calculator` preserving the query string (already implemented; needed for the first embedded load).
- Only one `rel="home"` link. Never list Calculator as a child.
- `/app/results` without a valid `d` shows a message, not a crash (see `results.html?state=invalid-link` and `?state=no-calculation`).
- `/app/history/:id` for an unknown or other-shop id shows "not found" without revealing whether the id exists elsewhere.
