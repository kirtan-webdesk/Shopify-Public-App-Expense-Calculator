import { launch, fresh, reset } from "./lib.mjs";
const browser = await launch();
await reset();
const info = (page) => page.evaluate(() => {
  const p = document.querySelector("s-page");
  const sr = p?.shadowRoot;
  return { heading: p?.getAttribute("heading"), headingProp: p?.heading, hasShadow: !!sr, shadowText: sr ? sr.textContent.trim().slice(0, 120) : null,
    slotted: [...(p?.children ?? [])].map((c) => c.tagName + ":" + (c.getAttribute("slot") ?? "")).slice(0, 8), rect: p ? [p.getBoundingClientRect().top, p.getBoundingClientRect().height] : null,
    qc: [...document.querySelectorAll("s-query-container")].map((q) => Math.round(q.getBoundingClientRect().width)), tilesGrid: (() => { const g = document.querySelector("s-grid"); return g ? { attr: g.getAttribute("gridtemplatecolumns"), prop: g.gridTemplateColumns, disp: getComputedStyle(g).display, cols: getComputedStyle(g).gridTemplateColumns } : null; })() };
});
const { ctx, page } = await fresh(browser, "/app/calculator");
console.log("direct calculator", JSON.stringify(await info(page)));
await page.locator('s-text-field[label="Revenue"] input').first().fill("50000");
await page.evaluate(() => [...document.querySelectorAll("s-button")].find((b) => b.textContent.trim() === "Calculate").click());
await page.waitForURL(/results/); await page.waitForTimeout(1500);
console.log("SPA results", JSON.stringify(await info(page)));
const url = page.url();
await page.goto(url, { waitUntil: "networkidle" }); await page.waitForTimeout(1500);
console.log("direct results (same url)", JSON.stringify(await info(page)));
await browser.close();
