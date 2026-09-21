import { chromium } from "file:///C:/Users/Admin/AppData/Local/nvm/v20.18.0/node_modules/playwright/index.mjs";
import fs from "node:fs";
import path from "node:path";
export const PORT = process.env.PORT || 5199;
export const base = `http://localhost:${PORT}`;
export async function launch() {
  return chromium.launch({ executablePath: process.env.HOME + "/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe" });
}
export async function reset(seed = 0) {
  await fetch(base + "/__reset");
  if (seed) await fetch(base + "/__seed?n=" + seed);
}
export async function seedCalc(revenue = "50000", currency = "USD") {
  return (await fetch(`${base}/__seedcalc?revenue=${revenue}&currency=${currency}`)).text();
}
// The real polaris.js from cdn.shopify.com, downloaded once per run and served from disk to every page (the CDN fetch is a
// blocking <script> and repeatedly timed out after dozens of page loads). Set POLARIS_LOCAL to the downloaded file.
export async function routePolaris(ctx) {
  if (!process.env.POLARIS_LOCAL) return;
  const body = fs.readFileSync(process.env.POLARIS_LOCAL);
  await ctx.route("https://cdn.shopify.com/shopifycloud/polaris.js", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body }));
}
export async function fresh(browser, url, width = 1000, { wait = 1500 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  await routePolaris(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 200)); });
  for (let attempt = 0; ; attempt++) {
    try { await page.goto(base + url, { waitUntil: "load", timeout: 25000 }); break; }
    catch (e) { if (attempt >= 3) throw e; } // the Polaris CDN script is a blocking <script>; retry a slow fetch
  }
  await page.waitForTimeout(wait);
  return { ctx, page, errors };
}
export async function shot(page, outDir, name, widths = [1000, 600]) {
  fs.mkdirSync(outDir, { recursive: true });
  const files = [];
  for (const w of widths) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(400);
    const f = path.join(outDir, `${name}-${w}.png`);
    await page.screenshot({ path: f, fullPage: true });
    files.push(f);
  }
  await page.setViewportSize({ width: 1000, height: 900 });
  return files;
}
