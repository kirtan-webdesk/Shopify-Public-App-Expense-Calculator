/*
  expense-calculator — G2 mockup interaction layer
  ------------------------------------------------------------------
  Static-mockup JS: demonstrates the interaction states G2 asks for
  (contextual save-bar dirty state, validation, modal confirm, toast,
  the ADR-0004 chart/table pairing) using plain DOM + the App Bridge
  primitives. It does not call a server — the developer wires real
  loaders/actions in the React Router 7 app; this shows the target
  behaviour and is meant to translate closely, not to be thrown away.

  VERIFY AT BUILD:
    - Exact App Bridge save-bar element/API (`ui-save-bar` + .show()/
      .hide()) and toast API (`shopify.toast.show(...)`) against the
      resolved app-bridge.js version.
    - Exact <s-modal> attribute/slot names against the resolved
      polaris.js version.
*/

/* ---------------------------------------------------------------
   Money + percentage formatting helpers (display-only; mirrors the
   "convert to a display string exactly once, at the render
   boundary" rule from ADR-0005 — the mockup never does money math,
   it only formats numbers that are already correct in the fixture
   data).
------------------------------------------------------------------ */
function formatMoney(amount, currencyCode) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode || "USD",
    currencyDisplay: "narrowSymbol",
  }).format(amount);
}

function formatPercent(value) {
  return `${value.toFixed(value < 1 ? 2 : 1)}%`;
}

/* ---------------------------------------------------------------
   Donut chart — hand-rolled inline SVG per ADR-0004. No canvas, no
   charting library. Built as stacked stroke-dasharray circles
   (pathLength=100 normalizes the math to percentages directly),
   which is a well-understood, dependency-free technique and keeps
   every "mandatory state" from ADR-0004 tractable:
     - zero revenue / all-categories-zero -> a neutral empty ring
     - exactly one non-zero category -> a full 100 dash, no seams
     - slices under ~1% -> floored to a minimum visible dash length
       so they render as a sliver instead of disappearing
   The <svg> carries role="img" + a summarising aria-label; every
   element inside it is aria-hidden, because the accessible source
   of truth is the data table rendered alongside it, not the chart.
------------------------------------------------------------------ */
function buildDonutSvg(lineItems, opts) {
  const size = (opts && opts.size) || 220;
  const stroke = (opts && opts.stroke) || 28;
  const radius = size / 2 - stroke / 2;
  const cx = size / 2;
  const cy = size / 2;
  const MIN_VISIBLE_DASH = 0.6; // percentage points; keeps <1% slices visible

  const nonZero = lineItems.filter((li) => li.percentage > 0);

  if (nonZero.length === 0) {
    // Zero-revenue / all-categories-zero state: a neutral empty ring,
    // not a broken chart and not a hidden one.
    return `
      <svg role="img" aria-label="No expenses to display yet" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
        <circle aria-hidden="true" cx="${cx}" cy="${cy}" r="${radius}"
          fill="none" stroke="var(--p-color-border, #e3e3e3)" stroke-width="${stroke}" />
        <text aria-hidden="true" x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle"
          font-size="13" fill="var(--p-color-text-secondary, #616161)">No data</text>
      </svg>`;
  }

  const ariaLabel =
    "Expense breakdown donut chart. " +
    nonZero.map((li) => `${li.label} ${formatPercent(li.percentage)}`).join(", ") +
    ". Full figures are in the table below.";

  let cursor = 0; // running offset, in "percent of circumference" units
  const segments = nonZero
    .map((li) => {
      const dash = Math.max(li.percentage, MIN_VISIBLE_DASH);
      const gap = 100 - dash;
      // stroke-dashoffset counts from the top (12 o'clock) clockwise;
      // SVG circles start at 3 o'clock, so we rotate -90deg on the group.
      const offset = 100 - cursor;
      cursor += li.percentage; // advance by the TRUE percentage, not the floored dash,
      // so downstream slices still land at the correct angle even
      // when this slice was visually floored up from <1%.
      return `<circle aria-hidden="true" cx="${cx}" cy="${cy}" r="${radius}" fill="none"
        stroke="${li.color}" stroke-width="${stroke}" pathLength="100"
        stroke-dasharray="${dash} ${gap}" stroke-dashoffset="${offset}" />`;
    })
    .join("\n        ");

  return `
    <svg role="img" aria-label="${ariaLabel}" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
      <g transform="rotate(-90 ${cx} ${cy})">
        ${segments}
      </g>
    </svg>`;
}

/* ---------------------------------------------------------------
   calculator.html: rule-row summaries + dirty-state save bar
------------------------------------------------------------------ */
function initCalculatorPage() {
  const ruleList = document.querySelector(".rule-list");
  if (!ruleList) return;

  const saveBar = document.getElementById("rule-changes-save-bar");
  let dirty = false;

  function markDirty() {
    if (dirty) return;
    dirty = true;
    if (saveBar && typeof saveBar.show === "function") {
      saveBar.show();
    } else if (saveBar) {
      saveBar.setAttribute("open", "");
    }
  }

  function markClean() {
    dirty = false;
    if (saveBar && typeof saveBar.hide === "function") {
      saveBar.hide();
    } else if (saveBar) {
      saveBar.removeAttribute("open");
    }
  }

  ruleList.querySelectorAll(".rule-row").forEach((row) => {
    const summaryText = row.querySelector(".rule-row__at-a-glance");
    const typeInputs = row.querySelectorAll('input[type="radio"][data-role="rule-type"]');
    const percentInput = row.querySelector('input[data-role="percent-value"]');
    const fixedInput = row.querySelector('input[data-role="fixed-value"]');
    const formulaSelect = row.querySelector('select[data-role="formula-value"]');
    const enabledToggle = row.querySelector('input[data-role="enabled-toggle"]');
    const percentGroup = row.querySelector('[data-group="percentage"]');
    const fixedGroup = row.querySelector('[data-group="fixed"]');
    const formulaGroup = row.querySelector('[data-group="formula"]');

    function currentType() {
      const checked = Array.from(typeInputs).find((i) => i.checked);
      return checked ? checked.value : "percentage";
    }

    function syncVisibleValueGroup() {
      const type = currentType();
      if (percentGroup) percentGroup.hidden = type !== "percentage";
      if (fixedGroup) fixedGroup.hidden = type !== "fixed";
      if (formulaGroup) formulaGroup.hidden = type !== "formula";
    }

    function refreshSummary() {
      if (!summaryText) return;
      const enabled = enabledToggle ? enabledToggle.checked : true;
      if (!enabled) {
        summaryText.textContent = "Disabled";
        return;
      }
      const type = currentType();
      if (type === "percentage" && percentInput) {
        summaryText.textContent = `${percentInput.value || "0"}% of revenue`;
      } else if (type === "fixed" && fixedInput) {
        summaryText.textContent = `${formatMoney(Number(fixedInput.value || 0), "USD")} fixed`;
      } else if (type === "formula" && formulaSelect) {
        summaryText.textContent =
          formulaSelect.options[formulaSelect.selectedIndex]?.text || "Formula";
      }
    }

    function validatePercent() {
      if (!percentInput) return;
      const errorEl = row.querySelector('[data-error-for="percent-value"]');
      const value = Number(percentInput.value);
      const invalid =
        percentInput.value !== "" && (Number.isNaN(value) || value < 0);
      percentInput.setAttribute("aria-invalid", invalid ? "true" : "false");
      if (errorEl) {
        errorEl.textContent = invalid
          ? "Enter a percentage of 0 or greater (decimals allowed)."
          : "";
      }
    }

    function validateFixed() {
      if (!fixedInput) return;
      const errorEl = row.querySelector('[data-error-for="fixed-value"]');
      const value = Number(fixedInput.value);
      const invalid = fixedInput.value !== "" && (Number.isNaN(value) || value < 0);
      fixedInput.setAttribute("aria-invalid", invalid ? "true" : "false");
      if (errorEl) {
        errorEl.textContent = invalid
          ? "Enter an amount of 0 or greater."
          : "";
      }
    }

    typeInputs.forEach((input) => {
      input.addEventListener("change", () => {
        syncVisibleValueGroup();
        refreshSummary();
        markDirty();
      });
    });
    [percentInput, fixedInput, formulaSelect, enabledToggle].forEach((el) => {
      if (!el) return;
      el.addEventListener("input", () => {
        refreshSummary();
        markDirty();
      });
      el.addEventListener("change", () => {
        refreshSummary();
        markDirty();
      });
    });
    if (percentInput) percentInput.addEventListener("blur", validatePercent);
    if (fixedInput) fixedInput.addEventListener("blur", validateFixed);

    syncVisibleValueGroup();
    refreshSummary();
  });

  const discardBtn = document.getElementById("discard-rule-changes");
  const saveBtn = document.getElementById("save-rule-changes");
  if (discardBtn) {
    discardBtn.addEventListener("click", () => {
      markClean();
      window.shopify?.toast?.show("Changes discarded");
    });
  }
  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      markClean();
      window.shopify?.toast?.show("Rule changes saved");
    });
  }
}

/* ---------------------------------------------------------------
   results.html: render table + donut from a fixture dataset, wire
   the design-review preview switcher and the save-calculation modal
------------------------------------------------------------------ */
const RESULTS_FIXTURES = {
  typical: {
    label: "Typical calculation",
    revenue: 50000,
    currency: "USD",
    lineItems: [
      { key: "cost_of_goods", label: "Cost of Goods", ruleSummary: "32.5% of revenue", amount: 16250, color: "#5C6AC4" },
      { key: "payroll", label: "Payroll", ruleSummary: "18% of revenue", amount: 9000, color: "#47C1BF" },
      { key: "marketing", label: "Marketing", ruleSummary: "8% of revenue", amount: 4000, color: "#EEC200" },
      { key: "taxes", label: "Taxes", ruleSummary: "6% of revenue", amount: 3000, color: "#F49342" },
      { key: "platform_fees", label: "Platform Fees", ruleSummary: "2.9% of revenue", amount: 1450, color: "#9C6ADE" },
      { key: "payment_processing", label: "Payment Processing", ruleSummary: "2.6% of revenue", amount: 1300, color: "#50B83C" },
      { key: "misc", label: "Misc", ruleSummary: "1.5% of revenue", amount: 750, color: "#DE3618" },
      { key: "shipping", label: "Shipping", ruleSummary: "$450.00 fixed", amount: 450, color: "#006FBB" },
      { key: "overhead", label: "Overhead", ruleSummary: "$300.00 fixed", amount: 300, color: "#8A8A8A" },
      { key: "apps_software", label: "Apps/Software", ruleSummary: "$120.00 fixed", amount: 120, color: "#B98900" },
    ],
  },
  "zero-revenue": {
    label: "ADR-0004 state: zero revenue",
    revenue: 0,
    currency: "USD",
    lineItems: [
      { key: "cost_of_goods", label: "Cost of Goods", ruleSummary: "32.5% of revenue", amount: 0, color: "#5C6AC4" },
      { key: "payroll", label: "Payroll", ruleSummary: "18% of revenue", amount: 0, color: "#47C1BF" },
      { key: "marketing", label: "Marketing", ruleSummary: "8% of revenue", amount: 0, color: "#EEC200" },
    ],
  },
  "all-zero": {
    label: "ADR-0004 state: revenue entered, all categories disabled/zero",
    revenue: 50000,
    currency: "USD",
    lineItems: [
      { key: "cost_of_goods", label: "Cost of Goods", ruleSummary: "Disabled", amount: 0, color: "#5C6AC4" },
      { key: "payroll", label: "Payroll", ruleSummary: "Disabled", amount: 0, color: "#47C1BF" },
    ],
  },
  "single-category": {
    label: "ADR-0004 state: exactly one non-zero category",
    revenue: 10000,
    currency: "USD",
    lineItems: [
      { key: "cost_of_goods", label: "Cost of Goods", ruleSummary: "100% of revenue", amount: 10000, color: "#5C6AC4" },
      { key: "payroll", label: "Payroll", ruleSummary: "0% of revenue", amount: 0, color: "#47C1BF" },
    ],
  },
  "small-slices": {
    label: "ADR-0004 state: several slices under ~1%",
    revenue: 100000,
    currency: "USD",
    lineItems: [
      { key: "cost_of_goods", label: "Cost of Goods", ruleSummary: "96% of revenue", amount: 96000, color: "#5C6AC4" },
      { key: "apps_software", label: "Apps/Software", ruleSummary: "$400.00 fixed", amount: 400, color: "#B98900" },
      { key: "overhead", label: "Overhead", ruleSummary: "$350.00 fixed", amount: 350, color: "#8A8A8A" },
      { key: "misc", label: "Misc", ruleSummary: "$250.00 fixed", amount: 250, color: "#DE3618" },
      { key: "taxes", label: "Taxes", ruleSummary: "$300.00 fixed", amount: 300, color: "#F49342" },
      { key: "payment_processing", label: "Payment Processing", ruleSummary: "$180.00 fixed", amount: 180, color: "#50B83C" },
    ],
  },
};

function renderResults(fixtureKey) {
  const fixture = RESULTS_FIXTURES[fixtureKey];
  if (!fixture) return;

  const revenue = fixture.revenue;
  const totalExpenses = fixture.lineItems.reduce((sum, li) => sum + li.amount, 0);
  const net = revenue - totalExpenses;

  const lineItemsWithPct = fixture.lineItems.map((li) => ({
    ...li,
    percentage: revenue > 0 ? (li.amount / revenue) * 100 : 0,
  }));

  document.getElementById("summary-revenue").textContent = formatMoney(revenue, fixture.currency);
  document.getElementById("summary-total-expenses").textContent = formatMoney(totalExpenses, fixture.currency);
  const netEl = document.getElementById("summary-net");
  netEl.textContent = formatMoney(net, fixture.currency);
  netEl.classList.toggle("net-negative", net < 0);

  const tbody = document.getElementById("results-table-body");
  tbody.innerHTML = lineItemsWithPct
    .map(
      (li) => `
      <tr>
        <th scope="row"><span class="data-table__swatch" style="background:${li.color}" aria-hidden="true"></span>${li.label}</th>
        <td>${li.ruleSummary}</td>
        <td class="numeric">${formatMoney(li.amount, fixture.currency)}</td>
        <td class="numeric">${revenue > 0 ? formatPercent(li.percentage) : "—"}</td>
      </tr>`
    )
    .join("");

  document.getElementById("results-table-total-amount").textContent = formatMoney(totalExpenses, fixture.currency);
  document.getElementById("results-table-total-pct").textContent =
    revenue > 0 ? formatPercent((totalExpenses / revenue) * 100) : "—";

  const chartMount = document.getElementById("donut-chart-mount");
  chartMount.innerHTML = buildDonutSvg(lineItemsWithPct);

  const legend = document.getElementById("donut-legend");
  legend.innerHTML = lineItemsWithPct
    .filter((li) => li.amount > 0)
    .map(
      (li) => `
      <li>
        <span class="donut-legend__swatch" style="background:${li.color}" aria-hidden="true"></span>
        <span class="donut-legend__label">${li.label}</span>
        <span class="donut-legend__value">${revenue > 0 ? formatPercent(li.percentage) : formatMoney(li.amount, fixture.currency)}</span>
      </li>`
    )
    .join("");
}

function initResultsPage() {
  const switcher = document.getElementById("preview-state-switcher");
  if (!switcher) return;
  switcher.addEventListener("change", (e) => renderResults(e.target.value));
  renderResults(switcher.value);

  const saveBtn = document.getElementById("save-calculation-btn");
  const modal = document.getElementById("save-calculation-modal");
  const confirmBtn = document.getElementById("confirm-save-calculation");
  const cancelBtn = document.getElementById("cancel-save-calculation");

  if (saveBtn && modal) {
    saveBtn.addEventListener("click", () => {
      if (typeof modal.show === "function") modal.show();
      else modal.setAttribute("open", "");
    });
  }
  if (cancelBtn && modal) {
    cancelBtn.addEventListener("click", () => {
      if (typeof modal.hide === "function") modal.hide();
      else modal.removeAttribute("open");
    });
  }
  if (confirmBtn && modal) {
    confirmBtn.addEventListener("click", () => {
      if (typeof modal.hide === "function") modal.hide();
      else modal.removeAttribute("open");
      window.shopify?.toast?.show("Calculation saved");
      window.setTimeout(() => {
        window.location.href = "./history-detail.html";
      }, 400);
    });
  }
}

/* ---------------------------------------------------------------
   history.html / history-detail.html: static rendering only, plus
   the empty-state design-review toggle on the list page.
------------------------------------------------------------------ */
function initHistoryPage() {
  const toggle = document.getElementById("history-empty-state-toggle");
  const populated = document.getElementById("history-populated");
  const empty = document.getElementById("history-empty");
  if (!toggle || !populated || !empty) return;
  toggle.addEventListener("change", () => {
    const showEmpty = toggle.checked;
    populated.hidden = showEmpty;
    empty.hidden = !showEmpty;
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initCalculatorPage();
  initResultsPage();
  initHistoryPage();
});
