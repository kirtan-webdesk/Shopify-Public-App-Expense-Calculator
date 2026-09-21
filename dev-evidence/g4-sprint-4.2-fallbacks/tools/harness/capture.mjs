// Visual capture of every page/state at ~1000px and ~600px (hydrated: server render + client hydration,
// real Polaris web components from the CDN, real route modules, stubbed auth/repositories).
// usage: PORT=5199 node capture.mjs <label> <outDir> [seedRevenue]
import fs from "node:fs";
import path from "node:path";
import { launch, fresh, shot, reset, base, seedCalc } from "./lib.mjs";
import { mkD } from "./mkd.mjs";

const [, , label, outDir] = process.argv;
fs.mkdirSync(outDir, { recursive: true });
const browser = await launch();
const log = {};
const IGNORE = /App Bridge|shopify-api-key|Failed to load resource.*cdn/i;

// The App Bridge nav renders as plain links outside the Admin; hide it so screenshots show the page itself.
const hideNav = (page) => page.addStyleTag({ content: "s-app-nav{display:none!important}" });
const shootPage = async (page, name) => { await hideNav(page); return shot(page, outDir, `${label}-${name}`); };

const REV = label === "before" ? 's-number-field[label="Revenue amount"]' : 's-text-field[label="Revenue"]';
async function typeRevenue(page, text) {
  const input = page.locator(`${REV} input`).first();
  await input.click({ clickCount: 3 });
  await input.fill(text);
  await page.waitForTimeout(250);
}
const clickButton = (page, text) => page.evaluate((t) => { const b = [...document.querySelectorAll("s-button")].find((x) => x.textContent.trim() === t); b.click(); }, text);
async function calculate(page, revenue) {
  await typeRevenue(page, revenue);
  await clickButton(page, "Calculate");
  await page.waitForURL(/\/app\/results/, { timeout: 8000 });
  await page.waitForTimeout(1200);
}
async function saveFromResults(page) {
  const btn = label === "before" ? "Save this calculation" : "Save calculation";
  await clickButton(page, btn); // opens the modal (invoker command)
  await page.waitForTimeout(600);
  await page.evaluate(() => { const modal = document.querySelector("s-modal"); const b = modal.querySelector('s-button[slot="primary-action"]'); b.click(); });
  await page.waitForURL(/\/app\/history\//, { timeout: 8000 });
  await page.waitForTimeout(1200);
}
const record = (name, page, errors) => { log[name] = { errors: errors.filter((e) => !IGNORE.test(e)) }; };

await reset();
// --- 1. calculator default
{
  const { ctx, page, errors } = await fresh(browser, "/app/calculator");
  await shootPage(page, "calculator");
  record("calculator", page, errors);
  // --- 2. calculate -> results -> save -> detail -> duplicate
  await calculate(page, "50000");
  await shootPage(page, "results");
  record("results", page, errors);
  await saveFromResults(page);
  await shootPage(page, "history-detail");
  record("history-detail", page, errors);
  const dupHref = await page.evaluate(() => [...document.querySelectorAll("s-button")].map((b) => b.getAttribute("href")).find((h) => h && h.includes("from=")));
  await page.goto(base + dupHref, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(1200);
  await shootPage(page, "calculator-duplicate");
  record("calculator-duplicate", page, errors);
  await ctx.close();
}
await reset();
const seededA = await seedCalc("50000", "USD");
const seededB = await seedCalc("12000.50", "CAD");
console.error("seeded", seededA, seededB);
{
  const { ctx, page, errors } = await fresh(browser, "/app/history");
  await shootPage(page, "history");
  record("history", page, errors);
  await ctx.close();
}
// --- 3. results states
const items = (...a) => a;
const states = {
  "results-zero": { url: "/app/calculator", revenue: "0" },
  "results-exceed": { url: "/app/calculator", revenue: "1000" },
};
for (const [name, cfg] of Object.entries(states)) {
  const { ctx, page, errors } = await fresh(browser, cfg.url);
  await calculate(page, cfg.revenue);
  await shootPage(page, name);
  record(name, page, errors);
  await ctx.close();
}
const crafted = {
  "results-single": mkD({ revenue: 1000000, items: items({ k: "cost_of_goods", rt: "p", rbp: 10000, amt: 1000000 }) }),
  "results-small-slices": mkD({ revenue: 10000000, items: items(
    { k: "cost_of_goods", rt: "p", rbp: 9600, amt: 9600000 }, { k: "apps_software", rt: "f", fam: 40000, amt: 40000 },
    { k: "payment_processing", rt: "f", fam: 18000, amt: 18000 }, { k: "overhead", rt: "f", fam: 35000, amt: 35000 },
    { k: "taxes", rt: "f", fam: 30000, amt: 30000 }, { k: "misc", rt: "f", fam: 25000, amt: 25000 }) }),
  "results-all-off": mkD({ revenue: 5000000, items: [] }),
  "results-cad": mkD({ revenue: 2500000, currency: "CAD", items: items({ k: "cost_of_goods", rt: "p", rbp: 3250, amt: 812500 }, { k: "shipping", rt: "f", fam: 45000, amt: 45000 }) }),
};
for (const [name, d] of Object.entries(crafted)) {
  const { ctx, page, errors } = await fresh(browser, "/app/results?d=" + d);
  await shootPage(page, name);
  record(name, page, errors);
  await ctx.close();
}
for (const [name, url] of [["results-invalid-link", "/app/results?d=garbage"], ["results-no-calculation", "/app/results"], ["history-detail-404", "/app/history/00000000-0000-4000-8000-000000000099"]]) {
  const { ctx, page, errors } = await fresh(browser, url);
  await shootPage(page, name);
  record(name, page, errors);
  await ctx.close();
}
// --- 4. history: empty and paginated
await reset();
{
  const { ctx, page, errors } = await fresh(browser, "/app/history");
  await shootPage(page, "history-empty");
  record("history-empty", page, errors);
  await ctx.close();
}
await reset(45);
{
  const { ctx, page, errors } = await fresh(browser, "/app/history?page=2");
  await shootPage(page, "history-page2");
  record("history-page2", page, errors);
  await ctx.close();
}
await reset();
if (label !== "before") {
  // --- 5. Expense rules (new page)
  {
    const { ctx, page, errors } = await fresh(browser, "/app/rules");
    await shootPage(page, "rules");
    record("rules", page, errors);
    await ctx.close();
  }
  // calculator error states
  {
    const { ctx, page, errors } = await fresh(browser, "/app/calculator");
    await typeRevenue(page, "-5");
    await shootPage(page, "calculator-error-negative");
    await typeRevenue(page, "");
    await clickButton(page, "Calculate");
    await page.waitForTimeout(500);
    await shootPage(page, "calculator-error-empty");
    record("calculator-errors", page, errors);
    await ctx.close();
  }
}
fs.writeFileSync(path.join(outDir, `${label}-capture.json`), JSON.stringify(log, null, 2));
console.log(JSON.stringify(log));
await browser.close();
