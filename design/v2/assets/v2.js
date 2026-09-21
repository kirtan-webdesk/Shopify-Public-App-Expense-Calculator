/*
  expense-calculator — G2-revision (v2) mockup interaction layer
  ----------------------------------------------------------------------------
  Static-mockup JS. It fills the <template> markup that lives in each HTML file
  from one shared data set, and demonstrates interaction states. It does not call
  a server. The developer keeps the HTML/Polaris markup and replaces this file
  with React Router loaders/actions (the <template> bodies become the JSX that
  maps EXPENSE_CATEGORIES / line items).

  What is REAL logic ported from app/ (so the mockup shows true behaviour):
    - revenue text validation messages   (app/domain/expense-rule-validation.ts)
    - donut basis + empty/degenerate     (app/domain/donut-chart.ts, incl. the
      handling: slices keyed on AMOUNT      B2 / B2b fixes from the QA trace)
    - rule validation applied to EVERY row, enabled or not (NEW_P2 fix)

  What is PREVIEW ONLY (delete at build):
    - review-aid bar (screen + state switcher, driven by ?state=)
    - the fallback save bar / toast used when the page is opened outside Shopify
      admin (inside admin, form[data-save-bar] and shopify.toast are used)

  VERIFY AT BUILD (Shopify moves these):
    - form[data-save-bar] behaviour with Polaris field elements
    - shopify.toast.show(message, { action, onAction }) signature
    - s-modal command="--show" / "--hide" wiring
    - every Polaris tag/attribute in the HTML via Dev MCP validate_component_codeblocks
*/
(() => {
  'use strict';

  const params = new URLSearchParams(location.search);
  const page = document.body.dataset.page || 'index';
  const state = params.get('state') || (params.get('saved') === '1' ? 'saved' : 'default');
  const isEmbedded = params.has('host'); // inside Shopify admin the real App Bridge UI is used

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clone = (o) => JSON.parse(JSON.stringify(o));

  /* ------------------------------------------------------------------ data */

  // Palette proposal: every colour is >= 3:1 against white (WCAG 1.4.11), unlike the
  // v1 palette (QA finding p4). Slices still never rely on colour alone: label + % in
  // table and legend.
  const CATEGORIES = [
    { key: 'cost_of_goods', label: 'Cost of Goods', color: '#1D4ED8' },
    { key: 'marketing', label: 'Marketing', color: '#C2410C' },
    { key: 'platform_fees', label: 'Platform Fees', color: '#7C3AED' },
    { key: 'payment_processing', label: 'Payment Processing', color: '#15803D' },
    { key: 'shipping', label: 'Shipping', color: '#0E7490' },
    { key: 'apps_software', label: 'Apps/Software', color: '#A16207' },
    { key: 'payroll', label: 'Payroll', color: '#BE185D' },
    { key: 'overhead', label: 'Overhead', color: '#475569' },
    { key: 'taxes', label: 'Taxes', color: '#B91C1C' },
    { key: 'misc', label: 'Misc', color: '#4D7C0F' },
  ];

  // Currency-neutral notes (no "$"): QA p3 "formula help text hardcodes $".
  const FORMULAS = {
    tiered_by_revenue_band: {
      label: 'Tiered by revenue band',
      note:
        'Placeholder pattern: one rate chosen by which illustrative revenue band your revenue falls into ' +
        '(5% up to 10,000; 3.5% up to 50,000; 2% up to 250,000; 1% above that), in the currency you calculate in. ' +
        'Bands and rates are illustrative, not real business figures.',
    },
    base_fee_plus_marginal_percent: {
      label: 'Base fee + marginal percentage above a threshold',
      note:
        'Placeholder pattern: a flat base fee (25.00) plus 1% of revenue above an illustrative 20,000 threshold, ' +
        'in the currency you calculate in. Base fee, threshold and rate are illustrative, not real business figures.',
    },
  };

  const TAX_NOTE =
    'Estimate only. This is a rough figure based on your own assumption, not tax or legal advice.';

  const R = (type, v, enabled = true) => ({
    enabled,
    type,
    percent: type === 'percentage' ? v : '0',
    fixed: type === 'fixed' ? v : '0.00',
    formula: type === 'formula' ? v : 'tiered_by_revenue_band',
  });

  // Same illustrative placeholder defaults as app/domain/expense-rule-defaults.ts.
  const defaultRules = () => ({
    cost_of_goods: R('percentage', '32.5'),
    marketing: R('percentage', '8'),
    platform_fees: R('percentage', '2.9'),
    payment_processing: R('percentage', '2.6'),
    shipping: R('fixed', '450.00'),
    apps_software: R('fixed', '120.00'),
    payroll: R('percentage', '18'),
    overhead: R('fixed', '300.00'),
    taxes: R('percentage', '6'),
    misc: R('percentage', '1.5'),
  });

  // Design-review variant: shows a formula rule and a switched-off rule.
  const variantRules = () => {
    const r = defaultRules();
    r.marketing.enabled = false;
    r.payroll = R('formula', 'tiered_by_revenue_band');
    return r;
  };

  const allOff = () => {
    const r = defaultRules();
    Object.values(r).forEach((x) => (x.enabled = false));
    return r;
  };

  /* ------------------------------------------------------------ formatting */

  function fmtMoney(cents, cur = 'USD') {
    const s = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: cur,
      currencyDisplay: 'narrowSymbol',
    }).format(cents / 100);
    return s.replace('-', '−'); // true minus sign
  }
  // USD and CAD both render "$", so the currency CODE is always shown next to totals
  // and in column headers (QA p3).
  const fmtPct = (v) => `${v.toFixed(v < 1 ? 2 : 1)}%`;

  /* ------------------------------------------- revenue text validation --- */
  // Port of parseDecimalString / describeDecimalProblem / validateRevenueText.

  const MAX_REVENUE_MINOR = 999999999999;

  function parseCents(text) {
    const plain = /^\d+(\.\d{1,2})?$/;
    const grouped = /^\d{1,3}(,\d{3})+(\.\d{1,2})?$/;
    if (!plain.test(text) && !grouped.test(text)) return null;
    const [whole, frac = ''] = text.replace(/,/g, '').split('.');
    const n = parseInt(whole + frac.padEnd(2, '0'), 10);
    return Number.isSafeInteger(n) ? n : null;
  }

  function describeDecimalProblem(text) {
    if (/^[\d.,]*\d[eE][+-]?\d+$/.test(text)) {
      return 'Enter a plain number without an exponent, for example 100000 instead of 1e5.';
    }
    const m = /^([\d,]*)(?:\.(\d*))?$/.exec(text);
    if (!m) return 'Enter a number using digits only, for example 1234.50.';
    const whole = m[1] ?? '';
    const frac = m[2];
    if (frac !== undefined) {
      if (whole === '') return 'Enter a digit before the decimal point, for example 0.50.';
      if (frac === '') return 'Remove the trailing decimal point or add digits after it.';
      if (frac.length > 2) return 'Use at most 2 decimal places.';
    }
    if (whole.includes(',') && !/^\d{1,3}(,\d{3})+$/.test(whole)) {
      return 'Commas can only separate thousands, for example 1,234.50.';
    }
    if (whole === '') return 'Enter a number using digits only, for example 1234.50.';
    return null;
  }

  function validateRevenueText(raw) {
    const text = String(raw ?? '').trim();
    if (text === '') return { valid: false, error: 'Enter a revenue amount.' };
    if (text.startsWith('-')) return { valid: false, error: 'Revenue amount must be zero or greater.' };
    const problem = describeDecimalProblem(text);
    if (problem) return { valid: false, error: problem };
    const cents = parseCents(text);
    if (cents === null || cents > MAX_REVENUE_MINOR) {
      return { valid: false, error: 'Revenue is larger than this calculator supports — check for a typo.' };
    }
    return { valid: true, cents };
  }

  /* ---------------------------------------------------------------- engine */
  // Display-only approximation of app/domain/expense-engine.ts, good enough for fixtures
  // (the real engine is integer/BigInt with largest-remainder reconciliation).

  const centsFromText = (t) => {
    const n = Number(String(t ?? '').replace(/,/g, ''));
    return Number.isFinite(n) && String(t ?? '').trim() !== '' ? Math.round(n * 100) : null;
  };

  function formulaAmount(key, revenue) {
    if (key === 'tiered_by_revenue_band') {
      const rate = revenue <= 1000000 ? 5 : revenue <= 5000000 ? 3.5 : revenue <= 25000000 ? 2 : 1;
      return Math.round((revenue * rate) / 100);
    }
    return 2500 + Math.round(Math.max(0, revenue - 2000000) * 0.01);
  }

  function ruleText(rule, cur) {
    if (!rule.enabled) return 'Off';
    if (rule.type === 'percentage') return `${Number(rule.percent)}% of revenue`;
    if (rule.type === 'fixed') return `${fmtMoney(centsFromText(rule.fixed) ?? 0, cur)} fixed`;
    return FORMULAS[rule.formula]?.label ?? 'Formula';
  }

  function amountFor(rule, revenue) {
    if (rule.type === 'percentage') return Math.round((revenue * Number(rule.percent)) / 100);
    if (rule.type === 'fixed') return centsFromText(rule.fixed) ?? 0;
    return formulaAmount(rule.formula, revenue);
  }

  // Only switched-on categories appear (a disabled category is excluded from table, chart, legend).
  function computeLines(revenue, rules, cur) {
    return CATEGORIES.filter((c) => rules[c.key].enabled)
      .map((c) => ({
        ...c,
        ruleText: ruleText(rules[c.key], cur),
        amount: amountFor(rules[c.key], revenue),
      }))
      .sort((a, b) => b.amount - a.amount);
  }

  /* ----------------------------------------------------------------- donut */
  // Port of buildDonutChartData (G4-sprint-3.5). Slice = expense AMOUNT > 0 (never % of revenue),
  // so a $450 shipping fee still plots at revenue 0. Ring basis = share of revenue when there is
  // revenue and the expenses fit inside it, else share of total expenses (ring always closes at 100).

  const MIN_VISIBLE_DASH = 0.6;

  function donutData(lines, revenue) {
    const present = lines
      .filter((l) => l.amount > 0)
      .map((l) => ({ ...l, pctRev: revenue > 0 ? (l.amount / revenue) * 100 : 0 }));
    if (present.length === 0) {
      return { isEmpty: true, ariaLabel: 'No expenses to display yet.', basis: 'expenses', segments: [] };
    }
    const total = present.reduce((s, l) => s + l.amount, 0);
    const hasRevenue = present.every((l) => l.pctRev > 0);
    const pctSum = present.reduce((s, l) => s + l.pctRev, 0);
    const basis = hasRevenue && pctSum <= 100 + 1e-9 ? 'revenue' : 'expenses';
    const shareOf = (l) => (basis === 'revenue' ? l.pctRev : (l.amount / total) * 100);
    const basisText = basis === 'revenue' ? 'share of revenue' : 'share of total expenses';
    let cursor = 0;
    const segments = present.map((l) => {
      const share = shareOf(l);
      const dash = Math.min(100, Math.max(share, MIN_VISIBLE_DASH));
      const seg = {
        label: l.label,
        color: l.color,
        share,
        dash,
        gap: 100 - dash,
        dashOffset: Math.min(100, Math.max(0, 100 - cursor)),
      };
      cursor += share; // advance by the TRUE share, not the floored dash
      return seg;
    });
    return {
      isEmpty: false,
      basis,
      segments,
      ariaLabel:
        `Expense breakdown donut chart, shown as a ${basisText}. ` +
        segments.map((s) => `${s.label} ${fmtPct(s.share)}`).join(', ') +
        '. Full figures are in the table.',
    };
  }

  function donutSvg(d) {
    const size = 220;
    const stroke = 38;
    const r = (size - stroke) / 2;
    const c = size / 2;
    const ring = (color, extra = '') =>
      `<circle aria-hidden="true" cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" ${extra}/>`;
    if (d.isEmpty) {
      return (
        `<svg class="donut" role="img" aria-label="${d.ariaLabel}" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">` +
        ring('#e3e3e3') +
        `<text aria-hidden="true" x="${c}" y="${c}" text-anchor="middle" dominant-baseline="middle" font-size="14" fill="#616161">No data</text></svg>`
      );
    }
    const track = d.basis === 'revenue' ? ring('#e3e3e3') : '';
    const segs = d.segments
      .map((s) =>
        ring(
          s.color,
          `pathLength="100" stroke-dasharray="${s.dash.toFixed(3)} ${s.gap.toFixed(3)}" stroke-dashoffset="${s.dashOffset.toFixed(3)}"`,
        ),
      )
      .join('');
    return (
      `<svg class="donut" role="img" aria-label="${d.ariaLabel}" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">` +
      `<g transform="rotate(-90 ${c} ${c})">${track}${segs}</g></svg>`
    );
  }

  /* ----------------------------------------------------------- DOM helpers */

  function setText(sel, text) {
    const el = $(sel);
    if (el) el.textContent = text;
  }
  function setValue(el, v) {
    if (!el) return;
    el.value = v;
    el.setAttribute('value', v);
  }
  function setError(el, msg) {
    if (!el) return;
    if (msg) {
      el.error = msg;
      el.setAttribute('error', msg);
    } else {
      el.error = '';
      el.removeAttribute('error');
    }
  }
  function setLoading(btn, on) {
    if (!btn) return;
    btn.loading = on;
    btn.toggleAttribute('loading', on);
  }
  function fill(node, map) {
    Object.entries(map).forEach(([name, value]) => {
      const t = $(`[data-bind="${name}"]`, node);
      if (!t) return;
      if (name === 'swatch') t.style.background = value;
      else t.textContent = value;
    });
    return node;
  }
  function stamp(templateSel) {
    return document.importNode($(templateSel).content, true).firstElementChild;
  }

  /* -------------------------------------------- preview-only save bar/toast */

  function toast(message, action) {
    if (isEmbedded && window.shopify && window.shopify.toast) {
      window.shopify.toast.show(message, action ? { action: action.label, onAction: () => (location.href = action.href) } : undefined);
      return;
    }
    let el = $('#preview-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'preview-toast';
      el.className = 'preview-toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = message;
    if (action) {
      const a = document.createElement('a');
      a.href = action.href;
      a.textContent = action.label;
      el.appendChild(a);
    }
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (el.hidden = true), 5000);
  }

  const previewSaveBar = {
    el: null,
    set(dirty, onSave, onDiscard) {
      if (isEmbedded) return; // real App Bridge save bar (form[data-save-bar]) handles this
      if (!this.el) {
        const el = document.createElement('div');
        el.className = 'preview-save-bar';
        el.setAttribute('role', 'region');
        el.setAttribute('aria-label', 'Unsaved changes (preview of the App Bridge contextual save bar)');
        el.innerHTML =
          '<span class="preview-save-bar__msg">Unsaved changes</span>' +
          '<s-button data-act="discard">Discard</s-button>' +
          '<s-button variant="primary" data-act="save">Save</s-button>';
        document.body.appendChild(el);
        el.addEventListener('click', (e) => {
          const b = e.target.closest('[data-act]');
          if (!b) return;
          if (b.dataset.act === 'save') this.onSave();
          else this.onDiscard();
        });
        this.el = el;
      }
      this.onSave = onSave;
      this.onDiscard = onDiscard;
      this.el.hidden = !dirty;
    },
  };

  /* ------------------------------------------------------------ breakdown */
  // Shared by results.html and history-detail.html (same table + donut + legend, ADR-0004:
  // table first and always rendered, donut supplementary, both from the same line-item array).

  function renderBreakdown({ revenue, currency, lines }) {
    const total = lines.reduce((s, l) => s + l.amount, 0);
    const net = revenue - total;

    setText('#m-revenue', fmtMoney(revenue, currency));
    setText('#m-revenue-sub', currency);
    setText('#m-total', fmtMoney(total, currency));
    setText('#m-total-sub', revenue > 0 ? `${fmtPct((total / revenue) * 100)} of revenue` : currency);
    setText('#m-net', fmtMoney(net, currency));
    setText('#m-net-sub', currency);
    const negBadge = $('#m-net-badge');
    if (negBadge) negBadge.hidden = net >= 0;

    setText('#col-amount', `Amount (${currency})`);

    const body = $('#breakdown-body');
    if (body) {
      body.replaceChildren();
      lines.forEach((l) => {
        body.appendChild(
          fill(stamp('#breakdown-row-template'), {
            swatch: l.color,
            label: l.label,
            rule: l.ruleText,
            amount: fmtMoney(l.amount, currency),
            pct: revenue > 0 ? fmtPct((l.amount / revenue) * 100) : '—',
          }),
        );
      });
      body.appendChild(
        fill(stamp('#breakdown-total-template'), {
          amount: fmtMoney(total, currency),
          pct: revenue > 0 ? fmtPct((total / revenue) * 100) : '—',
        }),
      );
    }

    const d = donutData(lines, revenue);
    const mount = $('#donut-mount');
    if (mount) mount.innerHTML = donutSvg(d);

    const leftOver = 100 - d.segments.reduce((s, x) => s + x.share, 0);
    const legend = $('#legend');
    if (legend) {
      legend.innerHTML =
        d.segments
          .map(
            (s) =>
              `<li><span class="swatch" style="background:${s.color}" aria-hidden="true"></span>` +
              `<span class="legend__label">${s.label}</span><span class="legend__value">${fmtPct(s.share)}</span></li>`,
          )
          .join('') +
        (d.basis === 'revenue' && !d.isEmpty && leftOver > 0.005
          ? `<li><span class="swatch swatch--track" aria-hidden="true"></span>` +
            `<span class="legend__label">Left over (net)</span><span class="legend__value">${fmtPct(leftOver)}</span></li>`
          : '');
    }

    let title = 'Share of revenue';
    let basisNote =
      'Each slice is a category’s share of your revenue. The grey part of the ring is what is left over (net).';
    if (d.isEmpty) {
      title = 'Chart';
      basisNote = 'Nothing to plot: no category has an expense amount above 0.';
    } else if (d.basis === 'expenses' && revenue === 0) {
      title = 'Share of total expenses';
      basisNote =
        'Each slice is a category’s share of total expenses. There is no revenue to compare against, so the ring always closes at 100%.';
    } else if (d.basis === 'expenses') {
      title = 'Share of total expenses';
      basisNote =
        'Each slice is a category’s share of total expenses, because expenses are higher than revenue and a ring cannot show more than 100% of revenue.';
    }
    setText('#donut-title', title);
    setText('#donut-basis', basisNote);

    return { total, net, revenue };
  }

  /* --------------------------------------------------- state visibility --- */

  function applyStateVisibility() {
    $$('[data-only]').forEach((el) => {
      el.hidden = !el.dataset.only.split(/\s+/).includes(state);
    });
    $$('[data-hide-in]').forEach((el) => {
      el.hidden = el.dataset.hideIn.split(/\s+/).includes(state);
    });
  }

  /* -------------------------------------------------- PREVIEW-ONLY review bar */

  const SCREENS = [
    ['index.html', 'Index', 'index'],
    ['calculator.html', 'Calculator', 'calculator'],
    ['rules.html', 'Rules', 'rules'],
    ['results.html', 'Results', 'results'],
    ['history.html', 'History', 'history'],
    ['history-detail.html', 'History detail', 'history-detail'],
  ];
  const STATES = {
    calculator: ['default', 'prefilled', 'variants', 'error-empty', 'error-negative', 'error-decimals', 'error-comma'],
    rules: ['default', 'variants', 'dirty', 'errors', 'saved'],
    results: ['default', 'zero-revenue', 'expenses-exceed', 'single-category', 'small-slices', 'all-off', 'invalid-link', 'no-calculation'],
    history: ['default', 'empty', 'loading', 'paged'],
    'history-detail': ['default', 'saved', 'not-found'],
  };

  function reviewAid() {
    const bar = document.createElement('nav');
    bar.className = 'review-aid';
    bar.setAttribute('aria-label', 'Mockup review navigation (not part of the product)');
    const screens = SCREENS.map(
      ([href, label, id]) => `<a href="./${href}"${id === page ? ' aria-current="true"' : ''}>${label}</a>`,
    ).join('');
    const sts = (STATES[page] || [])
      .map((s) => {
        const href =
          s === 'default' ? `./${location.pathname.split('/').pop()}` : s === 'prefilled' ? '?from=5' : `?state=${s}`;
        const current = s === 'prefilled' ? params.has('from') : s === state && !params.has('from');
        return `<a href="${href}"${current ? ' aria-current="true"' : ''}>${s}</a>`;
      })
      .join('');
    bar.innerHTML =
      `<strong>Review aid, not product UI</strong>` +
      `<span class="review-aid__group"><span>Screens:</span>${screens}</span>` +
      (sts ? `<span class="review-aid__group"><span>States:</span>${sts}</span>` : '');
    document.body.appendChild(bar);
  }

  /* =============================================================== CALCULATOR */

  function initCalculator() {
    const revenueEl = $('#revenue');
    const currencyEl = $('#currency');
    const btn = $('#calculate-btn');
    const useVariants = state === 'variants' || params.get('rules') === 'variants';
    const rules = useVariants ? variantRules() : defaultRules();

    const STATE_VALUES = { 'error-empty': '', 'error-negative': '-5', 'error-decimals': '10.555', 'error-comma': '1,5' };
    let initial = params.get('revenue') ?? (params.get('from') ? '10000.00' : '');
    if (state in STATE_VALUES) initial = STATE_VALUES[state];
    setValue(revenueEl, initial);

    const cur0 = params.get('currency');
    if (cur0) {
      $$('s-option', currencyEl).forEach((o) => o.toggleAttribute('selected', o.getAttribute('value') === cur0));
      currencyEl.value = cur0;
    }
    const currentCurrency = () => currencyEl.value || cur0 || 'USD';

    function renderSummary() {
      const cur = currentCurrency();
      revenueEl.prefix = cur;
      revenueEl.setAttribute('prefix', cur);
      const body = $('#summary-body');
      body.replaceChildren();
      CATEGORIES.forEach((c) => {
        const r = rules[c.key];
        const row = stamp('#summary-row-template');
        fill(row, { label: c.label, rule: r.enabled ? ruleText(r, cur) : '' });
        $('[data-bind="off"]', row).hidden = r.enabled;
        $('[data-bind="rule"]', row).hidden = !r.enabled;
        body.appendChild(row);
      });
      const on = Object.values(rules).filter((r) => r.enabled).length;
      setText('#rules-count', `${on} of ${CATEGORIES.length} categories on`);
      $('#none-on').hidden = on !== 0;
    }

    function validate() {
      const r = validateRevenueText(revenueEl.value);
      setError(revenueEl, r.valid ? '' : r.error);
      return r;
    }

    // Live re-validation only while an error is showing, so a stale message clears as the
    // merchant fixes it (QA p3 "stale server errors persist after user fixes field").
    revenueEl.addEventListener('input', () => {
      if (revenueEl.error) validate();
    });
    revenueEl.addEventListener('focusout', () => {
      if (String(revenueEl.value ?? '').trim() !== '') validate();
    });
    revenueEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        calculate();
      }
    });
    currencyEl.addEventListener('change', renderSummary);

    function calculate() {
      const r = validate();
      if (!r.valid) {
        revenueEl.focus && revenueEl.focus();
        return;
      }
      setLoading(btn, true);
      const q = new URLSearchParams({ revenue: (r.cents / 100).toFixed(2), currency: currentCurrency() });
      if (useVariants) q.set('rules', 'variants');
      setTimeout(() => (location.href = `./results.html?${q}`), 350);
    }
    btn.addEventListener('click', calculate);

    $('#prefill-banner').hidden = !params.has('from');
    renderSummary();
    if (state in STATE_VALUES) validate();
  }

  /* ================================================================== RULES */

  function initRules() {
    const list = $('#rules-list');
    const form = $('#rules-form');
    const errBanner = $('#rules-error-banner');
    const errList = $('#rules-error-list');

    let initial = state === 'variants' ? variantRules() : defaultRules();
    let current = clone(initial);
    if (state === 'dirty') current.shipping.fixed = '500.00';
    if (state === 'errors') {
      current.marketing.enabled = false; // an OFF row with an empty value still has to be valid (NEW_P2)
      current.marketing.percent = '';
      current.shipping.fixed = '-20';
      current.cost_of_goods.percent = '1200';
    }
    let errorsShown = false;

    function render(rules) {
      list.replaceChildren();
      CATEGORIES.forEach((c) => {
        const rule = rules[c.key];
        const node = stamp('#rule-row-template');
        node.dataset.cat = c.key;
        node.setAttribute('aria-label', `${c.label} rule`);

        const sw = $('[data-f="enabled"]', node);
        sw.setAttribute('label', c.label);
        sw.setAttribute('name', `${c.key}.enabled`);
        sw.toggleAttribute('checked', rule.enabled);

        const type = $('[data-f="type"]', node);
        type.setAttribute('name', `${c.key}.type`);
        // B1 fix: mark the selected <s-option>; never set `value` on <s-select> before options exist.
        $$('s-option', type).forEach((o) => o.toggleAttribute('selected', o.getAttribute('value') === rule.type));

        const percent = $('[data-f="percent"]', node);
        percent.id = `${c.key}-percent`;
        percent.setAttribute('name', `${c.key}.percent`);
        percent.setAttribute('value', rule.percent);

        const fixed = $('[data-f="fixed"]', node);
        fixed.id = `${c.key}-fixed`;
        fixed.setAttribute('name', `${c.key}.fixed`);
        fixed.setAttribute('value', rule.fixed);

        const formula = $('[data-f="formula"]', node);
        formula.id = `${c.key}-formula`;
        formula.setAttribute('name', `${c.key}.formula`);
        $$('s-option', formula).forEach((o) => o.toggleAttribute('selected', o.getAttribute('value') === rule.formula));

        sync(node, rule);
        list.appendChild(node);
      });
      const dividers = $$('[data-f="divider"]', list);
      if (dividers.length) dividers[dividers.length - 1].remove();
    }

    function sync(node, rule) {
      $('[data-f="percent"]', node).hidden = rule.type !== 'percentage';
      $('[data-f="fixed"]', node).hidden = rule.type !== 'fixed';
      $('[data-f="formula"]', node).hidden = rule.type !== 'formula';
      $('[data-f="off"]', node).hidden = rule.enabled;
      const note = $('[data-f="note"]', node);
      let text = '';
      if (rule.type === 'formula') text = FORMULAS[rule.formula]?.note ?? '';
      else if (node.dataset.cat === 'taxes') text = TAX_NOTE;
      if (node.dataset.cat === 'taxes' && rule.type === 'formula') text = `${text} ${TAX_NOTE}`;
      note.textContent = text;
      note.hidden = text === '';
    }

    function read(node) {
      return {
        enabled: !!$('[data-f="enabled"]', node).checked,
        type: $('[data-f="type"]', node).value || 'percentage',
        percent: $('[data-f="percent"]', node).value ?? '',
        fixed: $('[data-f="fixed"]', node).value ?? '',
        formula: $('[data-f="formula"]', node).value || 'tiered_by_revenue_band',
      };
    }

    // NEW_P2 fix: every row is validated as if it were enabled, so an OFF row can never persist a
    // value the database would reject. The row explains this in its own error note.
    function validateRule(rule) {
      if (rule.type === 'percentage') {
        const t = String(rule.percent ?? '').trim();
        const n = t === '' ? NaN : Number(t);
        if (!(n >= 0)) return { f: 'percent', m: 'Enter a percentage of 0 or greater.' };
        if (n > 1000) return { f: 'percent', m: 'That percentage looks too large — check for a typo.' };
      } else if (rule.type === 'fixed') {
        const t = String(rule.fixed ?? '').trim();
        const n = t === '' ? NaN : Number(t);
        if (!(n >= 0)) return { f: 'fixed', m: 'Enter an amount of 0 or greater.' };
        if (n > 9999999.99) return { f: 'fixed', m: 'That amount looks too large — check for a typo.' };
      } else if (!FORMULAS[rule.formula]) {
        return { f: 'formula', m: 'Choose a formula.' };
      }
      return null;
    }

    function validateAll() {
      const problems = [];
      CATEGORIES.forEach((c) => {
        const node = $(`[data-cat="${c.key}"]`, list);
        const rule = current[c.key];
        const p = validateRule(rule);
        ['percent', 'fixed', 'formula'].forEach((f) => setError($(`[data-f="${f}"]`, node), p && p.f === f ? p.m : ''));
        if (p) problems.push({ c, p, off: !rule.enabled });
      });
      errList.replaceChildren();
      problems.forEach(({ c, p, off }) => {
        const li = document.createElement('li');
        const a = document.createElement('s-link');
        a.setAttribute('href', `#${c.key}-${p.f}`);
        a.textContent = `${c.label}: ${p.m}`;
        a.addEventListener('click', (e) => {
          e.preventDefault();
          const f = document.getElementById(`${c.key}-${p.f}`);
          f && f.focus && f.focus();
        });
        li.appendChild(a);
        if (off) li.appendChild(document.createTextNode(' (this rule is off, but its value must still be valid so it can be switched on later)'));
        errList.appendChild(li);
      });
      errBanner.setAttribute('heading', `${problems.length} ${problems.length === 1 ? 'rule needs' : 'rules need'} attention`);
      errBanner.hidden = problems.length === 0;
      errorsShown = problems.length > 0;
      return problems;
    }

    function refreshDirty() {
      const dirty = JSON.stringify(current) !== JSON.stringify(initial);
      previewSaveBar.set(dirty, save, discard);
    }

    function save() {
      const problems = validateAll();
      if (problems.length) {
        const f = document.getElementById(`${problems[0].c.key}-${problems[0].p.f}`);
        f && f.focus && f.focus();
        return;
      }
      initial = clone(current);
      refreshDirty();
      toast('Rules saved', { label: 'Calculate', href: './calculator.html' });
    }

    function discard() {
      current = clone(initial);
      render(current);
      errBanner.hidden = true;
      errorsShown = false;
      refreshDirty();
      toast('Changes discarded');
    }

    ['input', 'change'].forEach((evt) =>
      list.addEventListener(evt, (e) => {
        const node = e.target.closest && e.target.closest('[data-cat]');
        if (!node) return;
        current[node.dataset.cat] = read(node);
        sync(node, current[node.dataset.cat]);
        if (errorsShown) validateAll(); // clear stale errors as the merchant fixes them
        refreshDirty();
      }),
    );

    // Embedded: App Bridge drives these through form[data-save-bar]. Preview: the shim calls save()/discard().
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      save();
    });
    form.addEventListener('reset', (e) => {
      e.preventDefault();
      discard();
    });

    // Optional feature: fill the form with placeholder defaults; nothing is saved until Save.
    $('#reset-confirm').addEventListener('click', () => {
      current = defaultRules();
      render(current);
      errBanner.hidden = true;
      errorsShown = false;
      refreshDirty();
      toast('Placeholder defaults loaded. Select Save to keep them.');
    });

    render(current);
    if (state === 'errors') validateAll();
    refreshDirty();
    if (state === 'saved') toast('Rules saved', { label: 'Calculate', href: './calculator.html' });
  }

  /* ================================================================ RESULTS */

  function initResults() {
    if (state === 'invalid-link' || state === 'no-calculation') return;

    let revenue = 5000000;
    const currency = params.get('currency') || 'USD';
    let rules = params.get('rules') === 'variants' ? variantRules() : defaultRules();
    if (params.has('revenue')) {
      const r = validateRevenueText(params.get('revenue'));
      if (r.valid) revenue = r.cents;
    }
    switch (state) {
      case 'zero-revenue':
        revenue = 0;
        break;
      case 'expenses-exceed':
        revenue = 100000; // $1,000.00: 71.5% + $870 fixed = 158.5% of revenue
        break;
      case 'single-category':
        rules = allOff();
        rules.cost_of_goods = R('percentage', '100');
        revenue = 1000000;
        break;
      case 'small-slices':
        rules = allOff();
        rules.cost_of_goods = R('percentage', '96');
        rules.apps_software = R('fixed', '400.00');
        rules.overhead = R('fixed', '350.00');
        rules.misc = R('fixed', '250.00');
        rules.taxes = R('fixed', '300.00');
        rules.payment_processing = R('fixed', '180.00');
        revenue = 10000000;
        break;
      case 'all-off':
        rules = allOff();
        break;
      default:
    }

    const lines = computeLines(revenue, rules, currency);
    const { total } = renderBreakdown({ revenue, currency, lines });

    // Banners are data-driven (what production does), not state-driven.
    $('#b-zero-revenue').hidden = revenue !== 0;
    $('#b-exceed').hidden = !(revenue > 0 && total > revenue);
    $('#b-none-on').hidden = lines.length !== 0;

    const edit = $('#edit-inputs');
    edit.setAttribute('href', `./calculator.html?revenue=${(revenue / 100).toFixed(2)}&currency=${currency}${params.get('rules') ? '&rules=' + params.get('rules') : ''}`);

    const confirm = $('#confirm-save');
    confirm.addEventListener('click', () => {
      setLoading(confirm, true);
      toast('Calculation saved');
      setTimeout(() => (location.href = './history-detail.html?saved=1'), 400);
    });
  }

  /* ================================================================ HISTORY */

  function initHistory() {
    const table = $('#history-table');
    if (state === 'loading') {
      table.setAttribute('loading', '');
      return;
    }
    if (state === 'empty') return;
    if (state === 'paged') {
      table.setAttribute('hasNextPage', '');
      table.setAttribute('hasPreviousPage', '');
    }
    const rows = [
      { id: 5, at: 'Sep 21, 2026, 6:55 AM UTC', revenue: 1000000, cur: 'USD' },
      { id: 4, at: 'Sep 21, 2026, 6:34 AM UTC', revenue: 15000000, cur: 'USD' },
      { id: 3, at: 'Sep 18, 2026, 2:10 PM UTC', revenue: 4250000, cur: 'USD' },
      { id: 2, at: 'Aug 30, 2026, 12:10 PM UTC', revenue: 2500000, cur: 'CAD' },
      { id: 1, at: 'Aug 12, 2026, 9:02 AM UTC', revenue: 800000, cur: 'EUR' },
    ];
    const body = $('#history-body');
    rows.forEach((r) => {
      const total = computeLines(r.revenue, defaultRules(), r.cur).reduce((s, l) => s + l.amount, 0);
      const row = stamp('#history-row-template');
      row.setAttribute('clickDelegate', `view-${r.id}`);
      const link = $('[data-bind="link"]', row);
      link.id = `view-${r.id}`;
      link.setAttribute('href', './history-detail.html');
      fill(row, {
        link: r.at,
        revenue: fmtMoney(r.revenue, r.cur),
        total: fmtMoney(total, r.cur),
        net: fmtMoney(r.revenue - total, r.cur),
        currency: r.cur,
      });
      body.appendChild(row);
    });
  }

  /* ========================================================== HISTORY DETAIL */

  function initHistoryDetail() {
    if (state === 'not-found') return;
    const revenue = 1000000; // $10,000.00 (matches the live saved row: $8,020.00 expenses, $1,980.00 net)
    const currency = 'USD';
    renderBreakdown({ revenue, currency, lines: computeLines(revenue, defaultRules(), currency) });
  }

  /* ================================================================== BOOT */

  document.addEventListener('DOMContentLoaded', () => {
    applyStateVisibility();
    const inits = {
      calculator: initCalculator,
      rules: initRules,
      results: initResults,
      history: initHistory,
      'history-detail': initHistoryDetail,
    };
    if (inits[page]) inits[page]();
    reviewAid();
  });
})();
