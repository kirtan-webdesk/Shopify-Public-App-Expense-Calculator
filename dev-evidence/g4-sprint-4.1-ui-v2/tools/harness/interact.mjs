// Behavioural checks in real Chromium (hydrated harness). Adds a window.shopify toast recorder via an init script
// (embedded mode - Polaris then hoists page headers out of the iframe, so no header assertions here).
// usage: PORT=5199 node interact.mjs <out.json>
import fs from "node:fs";
import { launch, reset, base, routePolaris } from "./lib.mjs";
const out = {};
const browser = await launch();
const IGNORE = /App Bridge|shopify-api-key|Failed to load resource/i;
async function open(url, width = 1000) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  await routePolaris(ctx);
  await ctx.addInitScript(() => { window.__toasts = []; window.shopify = { toast: { show: (m, o) => window.__toasts.push({ m, action: o?.action ?? null, onAction: o?.onAction ?? null }) } }; });
  const page = await ctx.newPage(); const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 200)); });
  await page.goto(base + url, { waitUntil: "load", timeout: 60000 }); await page.waitForTimeout(2500);
  return { ctx, page, errors };
}
const click = (page, text) => page.evaluate((t) => [...document.querySelectorAll("s-button")].find((x) => x.textContent.trim() === t).click(), text);
const submitRules = (page) => page.evaluate(() => document.querySelector("form[data-save-bar]").requestSubmit());
const resetForm = (page) => page.evaluate(() => document.querySelector("form[data-save-bar]").reset());
const formData = (page) => page.evaluate(() => Object.fromEntries([...new FormData(document.querySelector("form[data-save-bar]")).entries()]));
const selectState = (page, sel) => page.evaluate((s) => { const n = document.querySelector(s)?.shadowRoot?.querySelector("select"); return n && n.selectedIndex >= 0 ? n.options[n.selectedIndex].text : "(BLANK)"; }, sel);
const fieldInput = (page, id) => page.locator("#" + id + " input").first();

// ---- I1 currency select never blank (hydrated, direct load) ----
await reset();
out.I1_currency = [];
for (const url of ["/app/calculator", "/app/calculator?revenue=100&currency=CAD", "/app/calculator?revenue=100&currency=GBP"]) {
  for (let i = 0; i < 3; i++) {
    const { ctx, page } = await open(url);
    out.I1_currency.push({ url, run: i, shown: await selectState(page, 's-select[label="Currency"]'), posted: await page.evaluate(() => document.querySelector('input[name="currency"]').value) });
    await ctx.close();
  }
}
// ---- I2 revenue validation ----
{
  const { ctx, page, errors } = await open("/app/calculator");
  const err = () => page.evaluate(() => document.getElementById("revenue").getAttribute("error"));
  const type = async (t) => { const i = fieldInput(page, "revenue"); await i.click({ clickCount: 3 }); await i.fill(t); await page.waitForTimeout(250); };
  const r = { untouched: await err() };
  await type("-5"); r.negative_live = await err();
  await type("1,5"); r.comma_live = await err();
  await type("10.555"); r.decimals_live = await err();
  await type("1e5"); r.exponent_live = await err();
  await type("2500.50"); r.valid_clears = await err();
  await type(""); r.empty_before_attempt = await err();
  await click(page, "Calculate"); await page.waitForTimeout(400);
  r.empty_after_click = await err(); r.url_after_empty_click = page.url();
  r.focus_after_failed_calculate = await page.evaluate(() => { const h = document.getElementById("revenue"); return document.activeElement === h && h.shadowRoot?.activeElement != null; });
  r.calculate_still_enabled = await page.evaluate(() => { const b = [...document.querySelectorAll("s-button")].find((x) => x.textContent.trim() === "Calculate"); return !b.hasAttribute("disabled"); });
  await type("50000"); await fieldInput(page, "revenue").press("Enter"); await page.waitForURL(/\/app\/results/, { timeout: 8000 });
  r.enter_key_calculates = true;
  r.calculate_ok_url = page.url().replace(/d=.*/, "d=...");
  out.I2_revenue = r; out.I2_errors = errors.filter((e) => !IGNORE.test(e)); await ctx.close();
}
// ---- I3 Rules editor ----
await reset();
{
  const { ctx, page, errors } = await open("/app/rules");
  const r = {};
  r.initial_hidden = await formData(page).then((f) => ({ enabledCount: Object.keys(f).filter((k) => k.startsWith("enabled-")).length, shipping: [f["type-shipping"], f["fixed-shipping"]], cogs: [f["type-cost_of_goods"], f["percent-cost_of_goods"]] }));
  await page.locator('s-switch[label="Marketing"] input').first().click(); await page.waitForTimeout(400);
  const f1 = await formData(page);
  r.marketing_off = { enabledMarketingPosted: "enabled-marketing" in f1, offBadges: await page.evaluate(() => [...document.querySelectorAll("s-badge")].filter((b) => b.textContent.trim() === "Off").length) };
  const ship = fieldInput(page, "shipping-fixed"); await ship.click({ clickCount: 3 }); await ship.fill("500"); await page.waitForTimeout(300);
  await page.locator("#payroll-type select").first().selectOption("formula");
  await page.waitForTimeout(500);
  const f2 = await formData(page);
  r.edited = { shipping: f2["fixed-shipping"], payrollType: f2["type-payroll"], payrollFormulaSelectShown: await selectState(page, "#payroll-formula"), payrollPercentFieldGone: await page.evaluate(() => !document.getElementById("payroll-percent")) };
  await resetForm(page); await page.waitForTimeout(600);
  const f3 = await formData(page);
  r.after_discard = { enabledMarketing: "enabled-marketing" in f3, shipping: f3["fixed-shipping"], payrollType: f3["type-payroll"], typeSelectShown: await selectState(page, "#payroll-type") };
  await page.locator('s-switch[label="Marketing"] input').first().click();
  const mk = fieldInput(page, "shipping-fixed"); await mk.click({ clickCount: 3 }); await mk.fill("777.25");
  await page.waitForTimeout(300); await submitRules(page); await page.waitForTimeout(1800);
  r.after_save = { toasts: await page.evaluate(() => window.__toasts.map((t) => ({ m: t.m, action: t.action }))), url: page.url(), shippingField: await fieldInput(page, "shipping-fixed").inputValue(), marketingSwitchChecked: await page.evaluate(() => document.querySelector('s-switch[label="Marketing"]').checked), errorBanner: await page.evaluate(() => !!document.querySelector('s-banner[heading="Rule changes not saved"]')) };
  r.toast_onAction_navigates = await page.evaluate(() => { window.__toasts[0].onAction(); return true; }); await page.waitForTimeout(1200); r.after_toast_action_url = page.url();
  out.I3_rules = r; out.I3_errors = errors.filter((e) => !IGNORE.test(e));
// ---- I4/I5 Calculate uses the SAVED rules end to end, same page/session (the harness store lives in the browser after a client-side save) ----
  const shown = await page.evaluate(() => document.querySelector("s-table-body").textContent.replace(/\s+/g, " ").slice(0, 400));
  const i = fieldInput(page, "revenue"); await i.click({ clickCount: 3 }); await i.fill("1000");
  await click(page, "Calculate"); await page.waitForURL(/\/app\/results/); await page.waitForTimeout(1200);
  const tbl = await page.evaluate(() => [...document.querySelectorAll("s-table-row")].map((r) => r.textContent.replace(/\s+/g, " ").trim()).filter((t) => /Shipping|Marketing/.test(t)));
  out.I4_saved_rules_used = { calculatorSummaryHasSaved: /\$777\.25 fixed/.test(shown), resultsRows: tbl };
  const href = await page.evaluate(() => [...document.querySelectorAll("s-button")].find((b) => b.textContent.trim() === "Change revenue").getAttribute("href"));
  await page.goto(base + href, { waitUntil: "load", timeout: 60000 }); await page.waitForTimeout(2500);
  out.I5_change_revenue = { href, revenueField: await page.evaluate(() => document.getElementById("revenue").getAttribute("value") ?? document.getElementById("revenue").value), currency: await selectState(page, 's-select[label="Currency"]') };
  await ctx.close();
}
// ---- I6 Rules: failed save (cleared value on an OFF row) + Reset to placeholder defaults ----
await reset();
{
  const { ctx, page, errors } = await open("/app/rules");
  const r = {};
  await page.locator('s-switch[label="Marketing"] input').first().click();
  const pct = fieldInput(page, "marketing-percent"); await pct.click({ clickCount: 3 }); await pct.fill(""); await page.waitForTimeout(300);
  r.inline_error_while_editing = await page.evaluate(() => document.getElementById("marketing-percent").getAttribute("error"));
  await submitRules(page); await page.waitForTimeout(1500);
  r.after_failed_save = await page.evaluate(() => ({ banner: document.querySelector('s-banner[heading="Rule changes not saved"]')?.textContent.replace(/\s+/g, " ").trim().slice(0, 300) ?? null, toasts: window.__toasts.length }));
  r.focus_moved_to_invalid_field = await page.evaluate(() => { const h = document.getElementById("marketing-percent"); return document.activeElement === h && h.shadowRoot?.activeElement != null; });
  await pct.fill("9"); await page.waitForTimeout(400);
  r.banner_after_fix = await page.evaluate(() => !!document.querySelector('s-banner[heading="Rule changes not saved"]'));
  await click(page, "Reset to placeholder defaults"); await page.waitForTimeout(500);
  await page.evaluate(() => { const m = document.getElementById("reset-modal"); [...m.querySelectorAll("s-button")].find((b) => b.textContent.trim() === "Replace values").click(); });
  await page.waitForTimeout(800);
  const f = await formData(page);
  r.after_reset_defaults = { enabledCount: Object.keys(f).filter((k) => k.startsWith("enabled-")).length, marketing: f["percent-marketing"], toast: await page.evaluate(() => window.__toasts.at(-1)?.m), bannerGone: await page.evaluate(() => !document.querySelector('s-banner[heading="Rule changes not saved"]')) };
  await resetForm(page); await page.waitForTimeout(600);
  const g = await formData(page);
  r.after_discard_of_reset = { marketingEnabled: "enabled-marketing" in g, marketing: g["percent-marketing"] };
  out.I6_rules_errors_reset = r; out.I6_errors = errors.filter((e) => !IGNORE.test(e)); await ctx.close();
}
// ---- I7 history: link + pagination ----
await reset(45);
{
  const { ctx, page } = await open("/app/history");
  const r = {};
  r.page1 = await page.evaluate(() => ({ rows: document.querySelectorAll("s-table-row").length, next: [...document.querySelectorAll("s-button")].find((b) => b.textContent.trim() === "Next")?.getAttribute("href"), prevDisabled: [...document.querySelectorAll("s-button")].find((b) => b.textContent.trim() === "Previous")?.hasAttribute("disabled"), text: [...document.querySelectorAll("s-text")].map((t) => t.textContent.trim()).find((t) => /^Page/.test(t)) }));
  await page.goto(base + "/app/history?page=3", { waitUntil: "networkidle" }); await page.waitForTimeout(1000);
  r.page3 = await page.evaluate(() => ({ rows: document.querySelectorAll("s-table-row").length, nextDisabled: [...document.querySelectorAll("s-button")].find((b) => b.textContent.trim() === "Next")?.hasAttribute("disabled") }));
  out.I7_history = r; await ctx.close();
}
fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 2)); console.log(JSON.stringify(out, null, 1));
await browser.close();
