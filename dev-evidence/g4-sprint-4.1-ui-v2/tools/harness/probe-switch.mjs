import { launch, reset, base } from "./lib.mjs";
const browser = await launch(); await reset();
const page = await (await browser.newContext({ viewport: { width: 1000, height: 900 } })).newPage();
await page.goto(base + "/app/rules", { waitUntil: "load" }); await page.waitForTimeout(2500);
await page.evaluate(() => { const sw = document.querySelector('s-switch[label="Marketing"]'); window.__log = []; for (const t of ["click", "input", "change"]) sw.addEventListener(t, (e) => window.__log.push(t + ":checked=" + sw.checked)); });
const box = await page.locator('s-switch[label="Marketing"] input').first().boundingBox();
console.log("inner box", JSON.stringify(box));
await page.locator('s-switch[label="Marketing"] input').first().click(); await page.waitForTimeout(500);
console.log(JSON.stringify(await page.evaluate(() => ({ log: window.__log, hidden: !!document.querySelector('input[name="enabled-marketing"]'), checked: document.querySelector('s-switch[label="Marketing"]').checked, off: [...document.querySelectorAll("s-badge")].length }))));
// label text click (what a user does)
await page.getByText("Platform Fees", { exact: true }).click(); await page.waitForTimeout(500);
console.log("after label click Platform Fees:", JSON.stringify(await page.evaluate(() => ({ hidden: !!document.querySelector('input[name="enabled-platform_fees"]'), checked: document.querySelector('s-switch[label="Platform Fees"]').checked, off: [...document.querySelectorAll("s-badge")].length }))));
await browser.close();
