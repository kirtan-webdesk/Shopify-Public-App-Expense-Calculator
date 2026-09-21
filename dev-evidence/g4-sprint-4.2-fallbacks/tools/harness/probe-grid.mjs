import { launch, fresh, reset } from "./lib.mjs";
import { mkD } from "./mkd.mjs";
const browser = await launch();
await reset();
const d = mkD({ revenue: 5000000, items: [{ k: "cost_of_goods", rt: "p", rbp: 3250, amt: 1625000 }] });
const probe = (page) => page.evaluate(() => {
  const grids = [...document.querySelectorAll("s-grid")];
  return grids.map((g) => { const boxes = [...g.querySelectorAll(":scope > s-box, :scope > *")].slice(0, 3).map((c) => { const r = c.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width)]; }); const inner = g.shadowRoot?.querySelector(".grid"); const cs = inner ? getComputedStyle(inner) : null; return { attr: g.getAttribute("gridtemplatecolumns")?.slice(0, 60), boxes, innerCols: cs?.gridTemplateColumns, innerDisplay: cs?.display }; });
  return grids.map((g) => { const inner = g.shadowRoot?.querySelector("*"); const kids = [...g.children].map((c) => Math.round(c.getBoundingClientRect().left)); return { attr: g.getAttribute("gridtemplatecolumns")?.slice(0, 60), childLefts: kids, shadowStyle: (g.shadowRoot?.querySelector("style")?.textContent ?? "").slice(0, 300) }; });
});
{ const { ctx, page } = await fresh(browser, "/app/results?d=" + d); console.log("DIRECT", JSON.stringify(await probe(page), null, 1)); await ctx.close(); }
{ const { ctx, page } = await fresh(browser, "/app/calculator");
  await page.evaluate((d) => window.__router.navigate("/app/results?d=" + d), d); await page.waitForTimeout(1500);
  console.log("SPA", JSON.stringify(await probe(page), null, 1)); await ctx.close(); }
await browser.close();
