import { chromium } from "playwright";
import { readdirSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
const [,, srcDir, outDir, ...rest] = process.argv;
const files = rest.length ? rest : readdirSync(srcDir).filter(f => f.endsWith(".html")).map(f => f.replace(/\.html$/, ""));
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.HOME + "/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe" });
for (const w of [1000, 600]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 800 } });
  for (const name of files) {
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", e => errs.push("pageerror: " + e.message));
    page.on("console", m => { if (m.type() === "error") errs.push("console: " + m.text().slice(0, 200)); });
    await page.goto(pathToFileURL(`${srcDir}/${name}.html`).href, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${outDir}/${name}-${w}.png`, fullPage: true });
    if (name.startsWith("calculator")) {
      await page.evaluate(() => document.querySelectorAll("details").forEach(d => d.open = true));
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${outDir}/${name}-expanded-${w}.png`, fullPage: true });
    }
    const overflow = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    console.log(name, w, JSON.stringify(overflow), errs.slice(0,3).join(" | "));
    await page.close();
  }
  await ctx.close();
}
await browser.close();
