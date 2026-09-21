// G4-sprint-4.2: behavioural checks of the in-body fallback buttons in real Chromium (hydrated harness).
//  - "embedded" runs define window.shopify (a toast recorder): polaris.js then HOISTS the s-page header out of the iframe
//    (no header buttons in the DOM at all), which is the closest this harness gets to the live Admin: the in-body buttons
//    are the only ones left to click.
//  - "standalone" runs leave window.shopify undefined: Polaris draws the header itself, so header + fallback coexist.
// usage: PORT=5288 POLARIS_LOCAL=<polaris.js> node fallbacks.mjs <out.json> <screenshotDir>
import fs from "node:fs";
import { launch, reset, base, routePolaris, shot } from "./lib.mjs";
const [, , outFile, shotDir] = process.argv;
const out = {};
const browser = await launch();
const IGNORE = /App Bridge|shopify-api-key|Failed to load resource/i;
async function open(url, { embedded, width = 1000 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  await routePolaris(ctx);
  if (embedded) await ctx.addInitScript(() => { window.__toasts = []; window.shopify = { toast: { show: (m, o) => window.__toasts.push({ m, action: o?.action ?? null }) } }; });
  const page = await ctx.newPage(); const errors = []; const posts = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 200)); });
  page.on("request", (r) => { if (r.method() === "POST") posts.push(new URL(r.url()).pathname); });
  await page.goto(base + url, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(2500);
  return { ctx, page, errors: () => errors.filter((e) => !IGNORE.test(e)), posts };
}
const buttons = (page) => page.evaluate(() => [...document.querySelectorAll("s-button")].map((b) => ({ text: b.textContent.trim(), slot: b.getAttribute("slot"), type: b.getAttribute("type"), variant: b.getAttribute("variant"), commandFor: b.getAttribute("commandfor") ?? b.getAttribute("commandFor"), command: b.getAttribute("command"), inModal: !!b.closest("s-modal"), disabled: b.hasAttribute("disabled"), loading: b.hasAttribute("loading") })));
const formValues = (page) => page.evaluate(() => Object.fromEntries([...new FormData(document.querySelector("form[data-save-bar]")).entries()]));
const setPercent = async (page, id, text) => { const i = page.locator(`#${id} input`).first(); await i.click({ clickCount: 3 }); await i.fill(text); await page.waitForTimeout(300); };
// The harness runs the route actions IN the browser bundle (in-memory stub repositories), so the network shows no POST; the stub
// repository counts real writes instead (window.__saveCount) and exposes the stored rows (window.__ruleStore).
const saveCount = (page) => page.evaluate(() => window.__saveCount ?? 0);
const stored = (page, key) => page.evaluate((k) => { const r = window.__ruleStore.get(k); return r ? r.rateBasisPoints : null; }, key);
const clickForm = (page, text) => page.evaluate((t) => [...document.querySelectorAll("form[data-save-bar] s-button")].find((x) => x.textContent.trim() === t).click(), text);

// ---------------------------------------------------------------- Rules
await reset();
out.rules = {};
{
  const { ctx, page, errors, posts } = await open("/app/rules", { embedded: true });
  const b = await buttons(page);
  out.rules.buttons_embedded = b;
  out.rules.header_button_visible_when_embedded = await page.evaluate(() => { const h = document.querySelector('s-button[slot="secondary-actions"]'); const r = h.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), display: getComputedStyle(h).display }; });
  out.rules.header_buttons_in_dom_when_embedded = b.filter((x) => (x.slot === "secondary-actions" || x.slot === "primary-action") && !x.inModal).length;
  out.rules.initial_percent = (await formValues(page))["percent-cost_of_goods"];

  // Discard: edit, then the in-body Discard puts the saved value back (form.reset -> onReset -> discard()).
  await setPercent(page, "cost_of_goods-percent", "12.5");
  out.rules.after_edit = (await formValues(page))["percent-cost_of_goods"];
  await clickForm(page, "Discard");
  await page.waitForTimeout(800);
  out.rules.after_discard = (await formValues(page))["percent-cost_of_goods"];
  out.rules.after_discard_field_value = await page.evaluate(() => document.getElementById("cost_of_goods-percent").value);
  out.rules.discard_writes = await saveCount(page);

  // FAILED save via the in-body Save: an empty value -> the server rejects it, the banner shows, NOTHING is written.
  await setPercent(page, "cost_of_goods-percent", "");
  await clickForm(page, "Save");
  await page.waitForTimeout(1500);
  out.rules.failed_save = {
    writes: await saveCount(page),
    banner: await page.evaluate(() => document.querySelector('s-banner[tone="critical"]')?.getAttribute("heading") ?? null),
    buttons_after: (await buttons(page)).filter((x) => !x.slot && !x.inModal).map((x) => ({ text: x.text, disabled: x.disabled, loading: x.loading })),
  };
  // RETRY after the failure without any save bar: fix the value, click the in-body Save again.
  await setPercent(page, "cost_of_goods-percent", "20");
  await clickForm(page, "Save");
  await page.waitForTimeout(1800);
  out.rules.retry_save = {
    writes: await saveCount(page),
    stored_basis_points: await stored(page, "cost_of_goods"),
    error_banner_gone: (await page.evaluate(() => document.querySelector('s-banner[tone="critical"]'))) === null,
    toasts: await page.evaluate(() => window.__toasts.map((t) => t.m)),
    value_after: (await formValues(page))["percent-cost_of_goods"],
  };

  // DOUBLE SUBMIT: two clicks in the same tick -> one write (the button disables itself while submitting).
  const before = await saveCount(page);
  await setPercent(page, "cost_of_goods-percent", "21");
  await page.evaluate(() => { const s = [...document.querySelectorAll("form[data-save-bar] s-button")].find((x) => x.textContent.trim() === "Save"); s.click(); s.click(); });
  await page.waitForTimeout(1800);
  out.rules.synthetic_same_tick_double_click_writes = (await saveCount(page)) - before;
  // a REAL mouse click (Playwright mouse, not element.click()) on the in-body Save button. The s-button host is display:contents
  // (no box), so the coordinates come from the <button> inside its shadow root.
  const before2 = await saveCount(page);
  await setPercent(page, "cost_of_goods-percent", "22");
  const box = await page.evaluate(() => { const s = [...document.querySelectorAll("form[data-save-bar] s-button")].find((x) => x.textContent.trim() === "Save"); const i = s.shadowRoot.querySelector("button"); i.scrollIntoView({ block: "center" }); const r = i.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(1800);
  out.rules.real_mouse_click_writes = (await saveCount(page)) - before2;
  out.rules.stored_after_all = await stored(page, "cost_of_goods");
  out.rules.errors = errors();
  await ctx.close();
}
// standalone: header (Polaris-drawn) + in-body buttons, screenshots
{
  const { ctx, page, errors } = await open("/app/rules", { embedded: false });
  out.rules.standalone_buttons = await buttons(page);
  out.rules.standalone_errors = errors();
  await page.addStyleTag({ content: "s-app-nav{display:none!important}" });
  await shot(page, shotDir, "after-rules-fallback");
  await ctx.close();
}

// ---------------------------------------------------------------- Calculator
await reset();
out.calculator = {};
{
  const { ctx, page, errors, posts } = await open("/app/calculator", { embedded: true });
  const b = await buttons(page);
  out.calculator.buttons_embedded = b;
  out.calculator.header_buttons_in_dom_when_embedded = b.filter((x) => x.slot).length;
  out.calculator.inbody_button_text = await page.evaluate(() => document.querySelector("s-button:not([slot])").textContent.trim());
  out.calculator.header_button_visible_when_embedded = await page.evaluate(() => { const h = document.querySelector('s-button[slot="primary-action"]'); const r = h.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), display: getComputedStyle(h).display }; });
  // invalid: empty revenue -> nothing posted, the field shows the error
  await page.evaluate(() => document.querySelector("s-button:not([slot])").click()); // the IN-BODY Calculate (the header one carries slot=primary-action)
  await page.waitForTimeout(600);
  out.calculator.empty_click = { posts: posts.length, url: new URL(page.url()).pathname, revenue_error: await page.evaluate(() => document.getElementById("revenue").getAttribute("error")) };
  // valid: type, click the in-body Calculate -> Results
  const input = page.locator("#revenue input").first();
  await input.click({ clickCount: 3 }); await input.fill("50000"); await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector("s-button:not([slot])").click()); // the IN-BODY Calculate (the header one carries slot=primary-action)
  await page.waitForURL(/\/app\/results/, { timeout: 8000 }); await page.waitForTimeout(800);
  out.calculator.valid_click = { posts: posts.slice(), url: new URL(page.url()).pathname };
  out.calculator.errors = errors();
  await ctx.close();
}
{
  const { ctx, page, errors } = await open("/app/calculator", { embedded: false });
  out.calculator.standalone_buttons = await buttons(page);
  out.calculator.standalone_errors = errors();
  await page.addStyleTag({ content: "s-app-nav{display:none!important}" });
  await shot(page, shotDir, "after-calculator-fallback");
  await ctx.close();
}

// ---------------------------------------------------------------- Results
await reset();
out.results = {};
const d = (await (await fetch(`${base}/__post?url=/app/calculator&revenue=50000&currency=USD`)).text()).split("d=")[1];
out.results.d_present = !!d;
{
  const { ctx, page, errors, posts } = await open(`/app/results?d=${d}`, { embedded: false });
  const b = await buttons(page);
  out.results.standalone_buttons = b;
  const fallback = b.find((x) => x.text === "Save calculation" && !x.inModal && x.slot === "secondary-actions" && x.command === "--show");
  const header = b.find((x) => x.text === "Save calculation" && x.slot === "primary-action" && !x.inModal);
  out.results.same_target_as_header = !!fallback && !!header && fallback.commandFor === header.commandFor && fallback.command === header.command;
  out.results.fallback_variant = fallback?.variant ?? "(none: default)";
  await page.addStyleTag({ content: "s-app-nav{display:none!important}" });
  await shot(page, shotDir, "after-results-fallback");
  const modalState = () => page.evaluate(() => { const m = document.querySelector("#save-calculation-modal"); const d = m.shadowRoot?.querySelector("dialog"); const r = d?.getBoundingClientRect(); return { dialogOpen: !!d?.open, dialogW: Math.round(r?.width ?? 0), dialogH: Math.round(r?.height ?? 0) }; });
  out.results.modal_before = await modalState();
  // open the modal with the FALLBACK button (not the header one) and confirm it is really shown
  await page.evaluate(() => document.querySelector('s-banner s-button[command="--show"]').click());
  await page.waitForTimeout(800);
  out.results.modal_after_fallback_click = await modalState();
  await shot(page, shotDir, "after-results-fallback-modal-open", [1000]);
  // confirm: the modal's primary button submits the hidden form -> server recompute -> saved
  await page.evaluate(() => document.querySelector('#save-calculation-modal s-button[slot="primary-action"]').click());
  await page.waitForURL(/\/app\/history\//, { timeout: 8000 }); await page.waitForTimeout(800);
  const u = new URL(page.url());
  out.results.saved_redirect = u.pathname.replace(/[0-9a-f-]{36}/, "<id>") + u.search;
  out.results.posts = posts.slice();
  out.results.errors = errors();
  await ctx.close();
}
{
  // embedded (header hoisted): the fallback is the only Save calculation trigger left in the iframe
  const { ctx, page } = await open(`/app/results?d=${d}`, { embedded: true });
  out.results.embedded_buttons = await buttons(page);
  await ctx.close();
}
fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
await browser.close();
console.log("done");
