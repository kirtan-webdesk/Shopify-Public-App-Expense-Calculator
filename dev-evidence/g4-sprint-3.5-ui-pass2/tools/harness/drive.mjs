import { chromium } from "file:///C:/Users/Admin/AppData/Local/nvm/v20.18.0/node_modules/playwright/index.mjs";
import fs from "node:fs";
import path from "node:path";

const [, , label, port, outDir] = process.argv;
const base = `http://localhost:${port}`;
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.HOME + "/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe" });
const out = { label, scenarios: {} };
const log = (name, data) => { out.scenarios[name] = data; console.log(label, name, JSON.stringify(data)); };

async function fresh(url, width = 1000) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 160)));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 160)); });
  await page.goto(base + url, { waitUntil: "networkidle" });
  await page.waitForFunction(() => customElements.get("s-select") && document.querySelector("s-select") ? true : true);
  await page.waitForTimeout(1200);
  return { ctx, page, errors };
}
const shot = async (page, name, widths = [1000, 600]) => {
  for (const w of widths) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(outDir, `${name}-${w}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1000, height: 900 });
};
const selectState = (page, selector) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const n = el?.shadowRoot?.querySelector("select");
    return { prop: el?.value, native: n?.value, idx: n?.selectedIndex, shown: n && n.selectedIndex >= 0 ? n.options[n.selectedIndex].text : null, error: el?.getAttribute("error") };
  }, selector);
const CUR = 's-select[label="Currency"]';
const REV = 's-number-field[label="Revenue amount"]';
const fieldError = (page, sel) => page.evaluate((s) => document.querySelector(s)?.getAttribute("error") ?? null, sel);
const typeInto = async (page, hostSel, text) => {
  const input = page.locator(`${hostSel} input`).first();
  await input.click({ clickCount: 3 });
  await input.fill(text);
  await page.waitForTimeout(250);
};
const calcState = (page) => page.evaluate(() => { const b = [...document.querySelectorAll("s-button")].find((x) => x.textContent.trim() === "Calculate"); return { disabled: b?.hasAttribute("disabled") || b?.disabled === true, loading: b?.hasAttribute("loading") || b?.loading === true }; });
const donutState = (page) =>
  page.evaluate(() => {
    const svg = document.querySelector(".chart-panel svg");
    const circles = [...(svg?.querySelectorAll("circle[stroke-dasharray]") ?? [])].map((c) => c.getAttribute("stroke-dasharray"));
    return { aria: svg?.getAttribute("aria-label"), noData: /No data/.test(svg?.textContent ?? ""), dasharrays: circles, caption: document.querySelector(".chart-panel .help-text")?.textContent ?? null, legend: [...document.querySelectorAll(".donut-legend li")].map((l) => l.textContent) };
  });

async function calcThenResults(revenue, page) {
  await typeInto(page, REV, revenue);
  await page.evaluate(() => { const b = [...document.querySelectorAll("s-button")].find((x) => x.textContent.trim() === "Calculate"); b.click(); });
  await page.waitForURL(/\/app\/results/, { timeout: 8000 });
  await page.waitForTimeout(1000);
}

try {
// ---- S1: currency select on a client-side render ----------------------------------------------
{
  const { ctx, page, errors } = await fresh("/app/calculator");
  log("S1_calculator_default_currency", { select: await selectState(page, CUR), errors: errors.filter((e) => !/App Bridge/.test(e)) });
  await shot(page, "calculator-default");
  await ctx.close();
}
for (const cur of ["cad", "eur", "gbp"]) {
  // direct load + SPA navigation to ?from= (the live-Admin path is client-side navigation)
  const { ctx, page } = await fresh("/app/calculator");
  await page.evaluate((c) => window.__router.navigate(`/app/calculator?from=${c}`), cur);
  await page.waitForTimeout(800);
  const spa = await selectState(page, CUR);
  const affixes = await page.evaluate(() => ({ revenue: [document.querySelector('s-number-field[label="Revenue amount"]')?.getAttribute("prefix"), document.querySelector('s-number-field[label="Revenue amount"]')?.getAttribute("suffix")] }));
  await shot(page, `calculator-from-${cur}`);
  await ctx.close();
  const direct = await fresh(`/app/calculator?from=${cur}`);
  log(`S2_from_${cur}`, { spa, affixes, direct: await selectState(direct.page, CUR) });
  await direct.ctx.close();
}


} catch (e) { console.log(label, "SCENARIO FAILED:", String(e).slice(0, 300).split(String.fromCharCode(10)).join(" ")); }
try {
// ---- S3: negative / bad revenue ------------------------------------------------------------------
{
  const { ctx, page } = await fresh("/app/calculator");
  const res = {};
  for (const text of ["-5", "", "10.555", ".5", "1e5", "5.", "1234.50", "0"]) {
    // "1,5" and "abc" cannot be typed into the inner <input type=number> (the browser refuses them); the server path for those is covered by the unit tests.
    await typeInto(page, REV, text);
    res[JSON.stringify(text)] = { error: await fieldError(page, REV), calc: await calcState(page) };
    if (text === "-5") await shot(page, "calculator-negative-revenue");
  }
  log("S3_revenue_validation_live", res);
  await ctx.close();
}


} catch (e) { console.log(label, "SCENARIO FAILED:", String(e).slice(0, 300).split(String.fromCharCode(10)).join(" ")); }
try {
// ---- S4: donut at revenue 0, expenses > revenue, normal ------------------------------------------
for (const [name, revenue] of [["revenue-0", "0"], ["expenses-exceed-revenue", "1000"], ["normal-revenue", "50000"]]) {
  const { ctx, page, errors } = await fresh("/app/calculator");
  try {
    await calcThenResults(revenue, page);
    log(`S4_donut_${name}`, { donut: await donutState(page), errors: errors.filter((e) => !/App Bridge/.test(e)) });
    await shot(page, `results-${name}`);
  } catch (e) {
    log(`S4_donut_${name}`, { failed: String(e).slice(0, 200), url: page.url(), body: (await page.evaluate(() => document.body.innerText)).slice(0, 300) });
    await shot(page, `results-${name}-FAILED`, [1000]);
  }
  await ctx.close();
}


} catch (e) { console.log(label, "SCENARIO FAILED:", String(e).slice(0, 300).split(String.fromCharCode(10)).join(" ")); }
try {
// ---- S5/S7: Save with a category cleared AND unticked; error clears when fixed ----------------------
{
  const { ctx, page, errors } = await fresh("/app/calculator");
  // Shipping is the 5th category; open it via summary, clear the fixed amount, untick.
  await page.evaluate(() => { document.querySelectorAll("details").forEach((d) => (d.open = true)); });
  await page.waitForTimeout(300);
  const detailsHandle = page.locator("details.rule-row").nth(4); // sortOrder 4 = shipping
  const title = await detailsHandle.locator(".rule-row__title").innerText();
  await typeInto(page, "details.rule-row:nth-of-type(5) s-number-field", "");
  await detailsHandle.locator('input[type="checkbox"]').uncheck();
  await page.waitForTimeout(300);
  const beforeSave = await page.evaluate(() => ({ summary: document.querySelectorAll(".rule-row__at-a-glance")[4]?.textContent, fieldError: document.querySelector("details.rule-row:nth-of-type(5) s-number-field")?.getAttribute("error") }));
  await page.evaluate(() => document.querySelector("form").requestSubmit());
  await page.waitForTimeout(1200);
  const afterSave = await page.evaluate(() => ({
    routeError: document.querySelector("#route-error")?.textContent ?? null,
    bannerHeading: document.querySelector('s-banner[tone="critical"]')?.getAttribute("heading") ?? null,
    summaryTexts: [...document.querySelectorAll(".rule-row__at-a-glance")].map((e) => e.textContent),
    fieldError: document.querySelector("details.rule-row:nth-of-type(5) s-number-field")?.getAttribute("error") ?? null,
    saveCount: globalThis.__saveCount ?? 0,
    formStillThere: !!document.querySelector("form"),
  }));
  await shot(page, "calculator-save-disabled-blank");
  let fixed = null;
  if (afterSave.formStillThere) {
    // fix: type a value -> the server error must not outlive the edit
    await typeInto(page, "details.rule-row:nth-of-type(5) s-number-field", "450.00");
    fixed = await page.evaluate(() => ({ bannerHeading: document.querySelector('s-banner[tone="critical"]')?.getAttribute("heading") ?? null, summary: document.querySelectorAll(".rule-row__at-a-glance")[4]?.textContent, fieldError: document.querySelector("details.rule-row:nth-of-type(5) s-number-field")?.getAttribute("error") ?? null }));
    await page.evaluate(() => document.querySelector("form").requestSubmit());
    await page.waitForTimeout(1200);
    fixed.afterResave = await page.evaluate(() => ({ toasts: window.__toasts, saveCount: globalThis.__saveCount ?? 0, criticalBanner: !!document.querySelector('s-banner[tone="critical"]'), stored: JSON.stringify(globalThis.__ruleStore?.get?.("shipping") ?? null) }));
  }
  log("S5_S7_save_disabled_blank", { title, beforeSave, afterSave, fixed, errors: errors.filter((e) => !/App Bridge/.test(e)).slice(0, 3) });
  await ctx.close();
}


} catch (e) { console.log(label, "SCENARIO FAILED:", String(e).slice(0, 300).split(String.fromCharCode(10)).join(" ")); }
try {
// ---- S6: Discard resets currency + values + clears server error --------------------------------------
{
  const { ctx, page } = await fresh("/app/calculator");
  await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
  // change currency via the native select in the shadow root
  await page.evaluate(() => { const n = document.querySelector('s-select[label="Currency"]').shadowRoot.querySelector("select"); n.value = "EUR"; n.dispatchEvent(new Event("change", { bubbles: true, composed: true })); n.dispatchEvent(new Event("input", { bubbles: true, composed: true })); });
  await page.waitForTimeout(300);
  await typeInto(page, REV, "12345");
  const dirty = { select: await selectState(page, CUR), rev: await page.evaluate((s) => document.querySelector(s).value, REV), fixedPrefix: await page.evaluate(() => [...document.querySelectorAll('s-number-field[label="Fixed amount"]')][0]?.getAttribute("prefix")) };
  await page.evaluate(() => document.querySelector("form").reset());
  await page.waitForTimeout(500);
  const after = { select: await selectState(page, CUR), rev: await page.evaluate((s) => document.querySelector(s).value, REV), hiddenCurrency: await page.evaluate(() => document.querySelector('input[name="currency"]')?.value), fixedPrefix: await page.evaluate(() => [...document.querySelectorAll('s-number-field[label="Fixed amount"]')][0]?.getAttribute("suffix")) };
  log("S6_discard_resets_currency", { dirty, after });
  await ctx.close();
}


} catch (e) { console.log(label, "SCENARIO FAILED:", String(e).slice(0, 300).split(String.fromCharCode(10)).join(" ")); }
try {
// ---- S8: toast once, not replayed -------------------------------------------------------------------
{
  const { ctx, page } = await fresh("/app/calculator");
  await page.evaluate(() => document.querySelector("form").requestSubmit());
  await page.waitForTimeout(1000);
  const first = await page.evaluate(() => window.__toasts.slice());
  await typeInto(page, REV, "500"); // re-render with the same action response
  await page.waitForTimeout(400);
  const afterRerender = await page.evaluate(() => window.__toasts.slice());
  await page.evaluate(() => window.__router.navigate("/app/history"));
  await page.waitForTimeout(600);
  await page.evaluate(() => window.__router.navigate("/app/calculator"));
  await page.waitForTimeout(800);
  const afterLeaveAndReturn = await page.evaluate(() => window.__toasts.slice());
  log("S8_toast", { first, afterRerender, afterLeaveAndReturn });
  await ctx.close();
}


} catch (e) { console.log(label, "SCENARIO FAILED:", String(e).slice(0, 300).split(String.fromCharCode(10)).join(" ")); }
try {
// ---- S9: pending state on Calculate ------------------------------------------------------------------
{
  const { ctx, page } = await fresh("/app/calculator");
  await page.evaluate(() => { globalThis.__delay = 1500; });
  const idle = await calcState(page);
  await page.evaluate(() => { [...document.querySelectorAll("s-button")].find((x) => x.textContent.trim() === "Calculate").click(); });
  await page.waitForTimeout(400);
  const pending = await calcState(page);
  await page.waitForURL(/\/app\/results/, { timeout: 8000 });
  log("S9_pending_calculate", { idle, pending });
  await ctx.close();
}


} catch (e) { console.log(label, "SCENARIO FAILED:", String(e).slice(0, 300).split(String.fromCharCode(10)).join(" ")); }
try {
// ---- S10: ?from= re-init on the mounted route --------------------------------------------------------
{
  const { ctx, page } = await fresh("/app/calculator?from=cad");
  const s0 = { sel: await selectState(page, CUR), rev: await page.evaluate((s) => document.querySelector(s).value, REV) };
  await typeInto(page, REV, "77");
  await page.evaluate(() => window.__router.navigate("/app/calculator?from=eur"));
  await page.waitForTimeout(800);
  const s1 = { sel: await selectState(page, CUR), rev: await page.evaluate((s) => document.querySelector(s).value, REV), banner: await page.evaluate(() => !!document.querySelector("s-banner")) };
  await page.evaluate(() => window.__router.navigate("/app/calculator"));
  await page.waitForTimeout(800);
  const s2 = { sel: await selectState(page, CUR), rev: await page.evaluate((s) => document.querySelector(s).value, REV) };
  log("S10_from_change_reinit", { s0, s1, s2 });
  await ctx.close();
}


} catch (e) { console.log(label, "SCENARIO FAILED:", String(e).slice(0, 300).split(String.fromCharCode(10)).join(" ")); }
try {
// ---- S11: empty History, S12: a11y checkbox/summary, S13: overflow ---------------------------------------
{
  const { ctx, page } = await fresh("/app/history");
  await shot(page, "history-empty");
  log("S11_history_empty", { text: (await page.evaluate(() => document.body.innerText)).slice(0, 200) });
  await ctx.close();
}
{
  const { ctx, page } = await fresh("/app/calculator");
  const row = page.locator("details.rule-row").nth(1);
  const wasOpen = await row.evaluate((d) => d.open);
  await row.locator('input[type="checkbox"]').click();
  const afterClick = await row.evaluate((d) => d.open);
  await row.locator('input[type="checkbox"]').focus();
  await page.keyboard.press("Space");
  const afterSpace = await row.evaluate((d) => d.open);
  const name = await row.locator('input[type="checkbox"]').evaluate((i) => ({ aria: i.getAttribute("aria-label"), labels: i.labels?.length ?? 0 }));
  const summaryLabels = await row.locator("summary label").count();
  log("S12_checkbox_a11y", { wasOpen, afterClick, afterSpace, name, summaryLabels });
  await ctx.close();
}
{
  const { ctx, page } = await fresh("/app/calculator");
  await calcThenResults("50000", page);
  await page.setViewportSize({ width: 380, height: 900 });
  await page.waitForTimeout(400);
  const m = await page.evaluate(() => ({ docScroll: document.documentElement.scrollWidth, docClient: document.documentElement.clientWidth, tableWrapper: (() => { const w = document.querySelector(".table-scroll"); return w ? { scroll: w.scrollWidth, client: w.clientWidth, overflowX: getComputedStyle(w).overflowX } : null; })() }));
  await page.screenshot({ path: path.join(outDir, "results-narrow-380.png"), fullPage: true });
  log("S13_narrow_overflow", m);
  await ctx.close();
}


} catch (e) { console.log(label, "SCENARIO FAILED:", String(e).slice(0, 300).split(String.fromCharCode(10)).join(" ")); }
fs.writeFileSync(path.join(outDir, "..", `results-${label}.json`), JSON.stringify(out, null, 2));
await browser.close();
