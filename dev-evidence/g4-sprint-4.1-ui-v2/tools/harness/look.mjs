import { launch, fresh, shot, reset } from "./lib.mjs";
const out = process.argv[2];
const browser = await launch();
await reset();
for (const [name, url] of [["calculator", "/app/calculator"], ["rules", "/app/rules"], ["history-empty", "/app/history"]]) {
  const { ctx, page, errors } = await fresh(browser, url);
  const files = await shot(page, out, name);
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  console.log(name, "height", h, "errors", JSON.stringify(errors.filter((e) => !/App Bridge|shopify-api-key/i.test(e))));
  await ctx.close();
}
await browser.close();
