// Generic driver for @shopify/dev-mcp (pinned 1.14.5) over stdio JSON-RPC.
// usage: node mcp-call.mjs <calls.json> <out.json>
// calls.json: [{ name, arguments }]  ("<CID>" in a string argument is replaced by the learn_shopify_api conversationId;
// "@file:<repo-relative path>" as a string is replaced with that file's bytes)
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
const calls = JSON.parse(readFileSync(process.argv[2], "utf8"));
const out = process.argv[3];
const root = "D:/Projects/Shopify Public App — Expense Calculator";
const srv = spawn("npx", ["-y", "@shopify/dev-mcp@1.14.5"], { stdio: ["pipe", "pipe", "pipe"], shell: true });
let buf = ""; const waiters = {};
const send = (o) => srv.stdin.write(JSON.stringify(o) + "\n");
srv.stderr.on("data", () => {});
srv.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (!l.trim()) continue; try { const m = JSON.parse(l); waiters[m.id]?.(m); } catch {} } });
const rpc = (id, method, params) => new Promise((res) => { waiters[id] = res; send({ jsonrpc: "2.0", id, method, params }); });
const txt = (m) => (m.result?.content || []).map((c) => c.text || "").join("\n");
const init = await rpc(1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "dev-agent-stdio", version: "1" } });
send({ jsonrpc: "2.0", method: "notifications/initialized" });
const learn = await rpc(3, "tools/call", { name: "learn_shopify_api", arguments: { api: "polaris-app-home" } });
const cid = (txt(learn).match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i) || [])[1];
const walk = (v) => typeof v === "string" ? (v === "<CID>" ? cid : v.startsWith("@file:") ? readFileSync(`${root}/${v.slice(6)}`, "utf8") : v) : Array.isArray(v) ? v.map(walk) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])) : v;
const results = []; let n = 10;
for (const c of calls) {
  const r = await rpc(n++, "tools/call", { name: c.name, arguments: walk(c.arguments) });
  results.push({ call: c, text: txt(r), isError: r.result?.isError ?? false });
}
writeFileSync(out, JSON.stringify({ server: init.result.serverInfo, conversationId: cid, learn: txt(learn).slice(0, 400), results }, null, 2));
srv.kill(); process.exit(0);
