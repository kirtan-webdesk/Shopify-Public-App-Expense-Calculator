import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
const files = JSON.parse(process.argv[2]);          // array of repo-relative paths
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
const tl = await rpc(2, "tools/list", {});
const tools = tl.result.tools;
const vt = tools.find((t) => t.name === "validate_component_codeblocks");
console.error("server:", JSON.stringify(init.result.serverInfo), "tools:", tools.map(t => t.name).join(","));
console.error("validate schema:", JSON.stringify(vt.inputSchema.properties));
const learn = await rpc(3, "tools/call", { name: "learn_shopify_api", arguments: { api: "polaris-app-home" } });
const t = txt(learn); const cid = (t.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i) || [])[1]; if (!cid) console.error(t.slice(0, 600));
console.error("conversationId:", cid);
const results = [];
let n = 10;
for (const f of files) {
  const code = readFileSync(`${root}/${f}`, "utf8");
  const r = await rpc(n++, "tools/call", { name: "validate_component_codeblocks", arguments: { code: [{ content: code, language: "tsx", artifactId: f, revision: 1 }], api: "polaris-app-home", conversationId: cid } });
  results.push({ file: f, text: txt(r), isError: r.result?.isError ?? false });
}
writeFileSync(out, JSON.stringify({ server: init.result.serverInfo, conversationId: cid, results }, null, 2));
srv.kill();
process.exit(0);
