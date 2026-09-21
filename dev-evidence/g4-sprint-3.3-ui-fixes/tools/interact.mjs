import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
const browser = await chromium.launch({ executablePath: process.env.HOME + "/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe" });
const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 } });
const page = await ctx.newPage();
await page.goto(pathToFileURL(process.argv[2] + "/calculator.html").href, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
const fd = await page.evaluate(() => { const f = document.querySelector("form"); const o = {}; for (const [k, v] of new FormData(f)) o[k] = v; return o; });
console.log("formdata keys:", Object.keys(fd).join(","), "| revenue=", fd.revenue, "| currency=", fd.currency);
// summary checkbox click toggles details?
const before = await page.evaluate(() => document.querySelectorAll("details")[1].open);
await page.click("#enabled-marketing", { force: true });
const after = await page.evaluate(() => document.querySelectorAll("details")[1].open);
console.log("details[1] open before/after clicking its checkbox:", before, after);
// click summary title
await page.click("details:nth-of-type(2) .rule-row__title");
console.log("after clicking title:", await page.evaluate(() => document.querySelectorAll("details")[1].open));
// focus outline etc
await browser.close();
