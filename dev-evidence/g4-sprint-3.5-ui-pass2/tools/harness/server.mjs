import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const [,, label, port, appRoot] = process.argv;
const here = path.resolve(import.meta.dirname);
const dist = path.join(here, "dist-" + label);
const types = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html" };
http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  let file = null;
  if (u.pathname === "/entry.js") file = path.join(dist, "entry.js");
  else if (u.pathname === "/app.css") file = path.join(appRoot, "app", "styles", "app.css");
  if (file && fs.existsSync(file)) { res.writeHead(200, { "content-type": types[path.extname(file)] }); return res.end(fs.readFileSync(file)); }
  res.writeHead(200, { "content-type": "text/html" }); res.end(fs.readFileSync(path.join(here, "index.html")));
}).listen(Number(port), () => console.log("listening", port));
