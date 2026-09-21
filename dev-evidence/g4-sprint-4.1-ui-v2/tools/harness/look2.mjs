import { launch, fresh, shot, reset } from "./lib.mjs";
import { mkD } from "./mkd.mjs";
const out = process.argv[2];
const browser = await launch();
await reset();
const d = mkD({ revenue: 5000000, items: [
  { k: "cost_of_goods", rt: "p", rbp: 3250, amt: 1625000 }, { k: "marketing", rt: "p", rbp: 800, amt: 400000 },
  { k: "platform_fees", rt: "p", rbp: 290, amt: 145000 }, { k: "payment_processing", rt: "p", rbp: 260, amt: 130000 },
  { k: "shipping", rt: "f", fam: 45000, amt: 45000 }, { k: "apps_software", rt: "f", fam: 12000, amt: 12000 },
  { k: "payroll", rt: "p", rbp: 1800, amt: 900000 }, { k: "overhead", rt: "f", fam: 30000, amt: 30000 },
  { k: "taxes", rt: "p", rbp: 600, amt: 300000 }, { k: "misc", rt: "p", rbp: 150, amt: 75000 }] });
for (const [name, url] of [["results", "/app/results?d=" + d]]) {
  const { ctx, page, errors } = await fresh(browser, url);
  const files = await shot(page, out, name);
  console.log(name, "h", await page.evaluate(() => document.documentElement.scrollHeight), JSON.stringify(errors.filter((e) => !/App Bridge|shopify-api-key/i.test(e))));
  await ctx.close();
}
await browser.close();
