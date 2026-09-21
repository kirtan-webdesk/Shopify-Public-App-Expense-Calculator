import http from "node:http"; import fs from "node:fs"; import path from "node:path"; import { pathToFileURL } from "node:url";
const [,, label, port, appRoot] = process.argv;
const here = path.resolve(import.meta.dirname);
const { render } = await import(pathToFileURL(path.join(here, "dist-ssr-" + label, "ssr.mjs")).href);
const client = fs.readFileSync(path.join(here, "dist-hyd-" + label, "entry.js"));
const css = fs.readFileSync(path.join(appRoot, "app", "styles", "app.css"));
http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/entry.js") { res.writeHead(200, { "content-type": "text/javascript" }); return res.end(client); }
  if (u.pathname === "/app.css") { res.writeHead(200, { "content-type": "text/css" }); return res.end(css); }
  try {
    const body = await render(u.pathname + u.search);
    if (body.startsWith("REDIRECT ")) { res.writeHead(302, { Location: body.slice(9) }); return res.end(); }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><script src="https://cdn.shopify.com/shopifycloud/polaris.js"></script><link rel="stylesheet" href="/app.css"/></head><body><div id="root">${body}</div><script type="module" src="/entry.js"></script></body></html>`);
  } catch (e) { res.writeHead(500); res.end(String(e && e.stack)); }
}).listen(Number(port), () => console.log("hydrate server", label, port));
