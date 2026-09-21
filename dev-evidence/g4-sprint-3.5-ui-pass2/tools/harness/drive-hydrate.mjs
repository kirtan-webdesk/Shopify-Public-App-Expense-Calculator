import { chromium } from "file:///C:/Users/Admin/AppData/Local/nvm/v20.18.0/node_modules/playwright/index.mjs";
const [, , label, port] = process.argv;
const browser = await chromium.launch({ executablePath: process.env.HOME + "/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe" });
const state = (page) => page.evaluate(() => ["s-select[label=\"Currency\"]"].map((sel) => { const el = document.querySelector(sel); const n = el?.shadowRoot?.querySelector("select"); return { prop: el?.value, attrValue: el?.getAttribute("value"), native: n?.value, idx: n?.selectedIndex, shown: n && n.selectedIndex >= 0 ? n.options[n.selectedIndex].text : "(BLANK)", optCount: n?.options.length }; })[0]);
for (const url of ["/app/calculator", "/app/calculator?from=cad", "/app/calculator?from=gbp"]) {
  for (let i = 0; i < 3; i++) {
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 } });
    const page = await ctx.newPage();
    const errs = []; page.on("pageerror", (e) => errs.push(e.message.slice(0, 120))); page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 120)); });
    await page.goto(`http://localhost:${port}${url}`, { waitUntil: "domcontentloaded" });
    const early = await state(page).catch((e) => "early:" + String(e).slice(0, 60));
    await page.waitForLoadState("networkidle"); await page.waitForTimeout(1500);
    const late = await state(page);
    const form = await page.evaluate(() => Object.fromEntries([...new FormData(document.querySelector("form")).entries()].filter(([k]) => ["currency", "revenue", "intent"].includes(k))));
    console.log(label, url, "run", i, "early", JSON.stringify(early), "late", JSON.stringify(late), "form", JSON.stringify(form), "errs", errs.filter((e) => !/App Bridge|hydrat|Hydrat/.test(e)).length, errs.filter((e) => /ydrat/.test(e)).slice(0, 1).join("|"));
    await ctx.close();
  }
}
await browser.close();
