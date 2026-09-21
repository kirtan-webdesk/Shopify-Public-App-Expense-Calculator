import http from "node:http"; import fs from "node:fs"; import path from "node:path"; import { pathToFileURL } from "node:url";
const [,, label, port, appRoot] = process.argv;
const here = path.resolve(import.meta.dirname);
const { render, post } = await import(pathToFileURL(path.join(here, "dist-ssr-" + label, "ssr.mjs")).href);
const client = fs.readFileSync(path.join(here, "dist-hyd-" + label, "entry.js"));
const css = fs.readFileSync(path.join(appRoot, "app", "styles", "app.css"));
http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/entry.js") { res.writeHead(200, { "content-type": "text/javascript" }); return res.end(client); }
  if (u.pathname === "/app.css") { res.writeHead(200, { "content-type": "text/css" }); return res.end(css); }
  if (u.pathname === "/__reset") { globalThis.__ruleStore?.clear(); if (globalThis.__calcs) globalThis.__calcs.length = 0; globalThis.__saveCount = 0; res.writeHead(200); return res.end("reset"); }
  if (u.pathname === "/__seedcalc") {
    const q = Object.fromEntries(u.searchParams);
    const D = [["cost_of_goods","percentage","32.50","0"],["marketing","percentage","8.00","0"],["platform_fees","percentage","2.90","0"],["payment_processing","percentage","2.60","0"],["shipping","fixed","0","450.00"],["apps_software","fixed","0","120.00"],["payroll","percentage","18.00","0"],["overhead","fixed","0","300.00"],["taxes","percentage","6.00","0"],["misc","percentage","1.50","0"]];
    const fields = { intent: "calculate", revenue: q.revenue || "50000", currency: q.currency || "USD" };
    for (const [k, t, p, f] of D) { fields["enabled-" + k] = "on"; fields["type-" + k] = t; fields["percent-" + k] = p; fields["fixed-" + k] = f; fields["formula-" + k] = "tiered_by_revenue_band"; }
    const calc = await post("/app/calculator", fields);
    const d = calc.split("d=")[1];
    const saved = await post("/app/results", { intent: "save", d });
    res.writeHead(200); return res.end(saved);
  }
  if (u.pathname === "/__post") {
    const q = Object.fromEntries(u.searchParams); const url = q.url; delete q.url;
    res.writeHead(200); return res.end(await post(url, q));
  }
  if (u.pathname === "/__seed") {
    const n = Number(u.searchParams.get("n") || 0);
    for (let i = 0; i < n; i++) globalThis.__calcs.push({ id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, shopId: "11111111-1111-4111-8111-111111111111", revenueMinor: String(100000 + i * 1000), currencyCode: ["USD", "CAD", "EUR", "GBP"][i % 4], totalExpensesMinor: String(60000 + i * 500), netAmountMinor: String(40000 + i * 500), engineVersion: "1.0.0", createdAt: new Date(Date.UTC(2026, 7, 1, 12, 0) + i * 3600000) });
    res.writeHead(200); return res.end("seeded " + n);
  }
  try {
    const body = await render(u.pathname + u.search);
    if (body.startsWith("REDIRECT ")) { res.writeHead(302, { Location: body.slice(9) }); return res.end(); }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><meta name="shopify-api-key" content="harness"/><script src="https://cdn.shopify.com/shopifycloud/polaris.js"></script><link rel="stylesheet" href="/app.css"/></head><body><div id="root">${body}</div><script type="module" src="/entry.js"></script></body></html>`);
  } catch (e) { res.writeHead(500); res.end(String(e && e.stack)); }
}).listen(Number(port), () => console.log("hydrate server", label, port));
