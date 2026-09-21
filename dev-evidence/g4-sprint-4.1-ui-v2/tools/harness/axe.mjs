// axe-core (from the jsdelivr CDN, pinned 4.10.2) against every page, direct-loaded in the hydrated harness.
// usage: PORT=5199 node axe.mjs <out.json>
import fs from "node:fs";
import { launch, fresh, reset, seedCalc } from "./lib.mjs";
import { mkD } from "./mkd.mjs";
const AXE = "https://cdn.jsdelivr.net/npm/axe-core@4.10.2/axe.min.js";
const browser = await launch();
await reset();
const saved = await seedCalc("50000", "USD");
const id = /history\/([0-9a-f-]{36})/.exec(saved)?.[1];
await seedCalc("12000.50", "CAD");
const d = mkD({ revenue: 5000000, items: [{ k: "cost_of_goods", rt: "p", rbp: 3250, amt: 1625000 }, { k: "shipping", rt: "f", fam: 45000, amt: 45000 }] });
const pages = { calculator: "/app/calculator", rules: "/app/rules", results: "/app/results?d=" + d, history: "/app/history", "history-detail": "/app/history/" + id, "results-invalid-link": "/app/results?d=garbage" };
const out = { axe: "4.10.2", pages: {} };
for (const [name, url] of Object.entries(pages)) {
  const { ctx, page } = await fresh(browser, url, 1000, { wait: 2500 });
  await page.addScriptTag({ url: AXE });
  const res = await page.evaluate(async () => {
    const r = await window.axe.run(document, { resultTypes: ["violations", "incomplete"] });
    const pick = (v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, sample: v.nodes.slice(0, 3).map((n) => ({ target: n.target.join(" >> ").slice(0, 140), html: n.html.slice(0, 160), why: (n.any[0]?.message ?? n.all[0]?.message ?? n.none[0]?.message ?? "").slice(0, 160) })) });
    return { violations: r.violations.map(pick), incomplete: r.incomplete.map((v) => ({ id: v.id, nodes: v.nodes.length })), passes: r.passes.length };
  });
  out.pages[name] = res;
  console.log(name, "violations:", res.violations.map((v) => `${v.id}(${v.impact},${v.nodes})`).join(", ") || "none", "| incomplete:", res.incomplete.map((v) => v.id).join(",") || "none");
  await ctx.close();
}
fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 2));
await browser.close();
