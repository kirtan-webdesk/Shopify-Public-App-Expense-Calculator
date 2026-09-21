import { chromium } from "file:///C:/Users/Admin/AppData/Local/nvm/v20.18.0/node_modules/playwright/index.mjs";
const [, , label, port] = process.argv;
const browser = await chromium.launch({ executablePath: process.env.HOME + "/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe" });
for (const mode of ["polaris-slow-3s (upgrade after hydration)", "client-nav-after-load"]) {
  for (const url of ["/app/calculator", "/app/calculator?from=eur"]) {
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 } });
    const page = await ctx.newPage();
    if (mode.startsWith("polaris-slow")) await page.route("**/polaris.js", async (route) => { await new Promise((r) => setTimeout(r, 3000)); await route.continue(); });
    await page.goto(`http://localhost:${port}${mode.startsWith("client") ? "/app/history" : url}`, { waitUntil: "domcontentloaded" });
    if (mode.startsWith("client")) { await page.waitForTimeout(2500); await page.evaluate((u) => window.__router.navigate(u), url); }
    await page.waitForLoadState("networkidle"); await page.waitForTimeout(4500);
    const s = await page.evaluate(() => { const el = document.querySelector('s-select[label="Currency"]'); const n = el?.shadowRoot?.querySelector("select"); return { prop: el?.value, native: n?.value, idx: n?.selectedIndex, shown: n && n.selectedIndex >= 0 ? n.options[n.selectedIndex].text : "(BLANK)" }; });
    console.log(label, mode, url, JSON.stringify(s));
    await ctx.close();
  }
}
await browser.close();
