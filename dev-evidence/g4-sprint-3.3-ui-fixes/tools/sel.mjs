import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
const browser = await chromium.launch({ executablePath: process.env.HOME + "/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe" });
const page = await (await browser.newContext({ viewport: { width: 1000, height: 800 } })).newPage();
await page.goto(pathToFileURL(process.argv[2] + "/calculator-cad.html").href, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
console.log(await page.evaluate(() => { const s = document.querySelector('s-select[name="currency"]'); return JSON.stringify({ attr: s.getAttribute("value"), prop: s.value, opts: [...s.querySelectorAll("s-option")].map(o => [o.value, o.hasAttribute("selected")]) }); }));
await browser.close();
