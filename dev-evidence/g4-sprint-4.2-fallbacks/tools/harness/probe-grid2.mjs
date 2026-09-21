import { launch, fresh, reset } from "./lib.mjs";
import { mkD } from "./mkd.mjs";
const browser = await launch();
await reset();
const d = mkD({ revenue: 5000000, items: [{ k: "cost_of_goods", rt: "p", rbp: 3250, amt: 1625000 }] });
const cols = (page, idx = 0) => page.evaluate((i) => { const g = document.querySelectorAll("s-grid")[i]; const inner = g.shadowRoot?.querySelector(".grid"); return getComputedStyle(inner).gridTemplateColumns; }, idx);
for (let run = 0; run < 3; run++) {
  const { ctx, page } = await fresh(browser, "/app/results?d=" + d);
  const out = { run, initial: await cols(page) };
  for (const v of ["@container (inline-size > 560px) repeat(3, 1fr), 1fr", "@container (inline-size > 560px) 1fr 1fr 1fr, 1fr", "@container (inline-size > 560px) repeat(3, minmax(0, 1fr)), 1fr"]) {
    await page.evaluate((v) => { document.querySelectorAll("s-grid")[0].gridTemplateColumns = v; }, v);
    await page.waitForTimeout(400);
    out[v.slice(-32)] = await cols(page);
  }
  console.log(JSON.stringify(out));
  await ctx.close();
}
await browser.close();
