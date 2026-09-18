#!/usr/bin/env node
/**
 * mcp-selfcheck.mjs — proves the bundled Shopify Dev MCP server is real, connectable,
 * exposes tools, and actually validates code. It:
 *   1. reads the EXACT pinned server command from the plugin's .mcp.json (single source),
 *   2. starts the server over stdio (no credentials, no Shopify store),
 *   3. lists tools (proves exposure),
 *   4. runs the documented flow: learn_shopify_api -> validate_graphql_codeblocks on a
 *      KNOWN-BAD query (must report INVALID) and a KNOWN-GOOD query (must report VALID).
 * Exit 0 only if the server exposes the validator tools AND bad->INVALID AND good->VALID.
 * Token values are irrelevant here; this touches no store and needs no auth.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const mcp = JSON.parse(readFileSync(resolve(ROOT, ".mcp.json"), "utf8"));
const entry = mcp.mcpServers?.["shopify-dev-mcp"];
if (!entry?.command) { console.error("FAIL: .mcp.json has no shopify-dev-mcp.command"); process.exit(2); }
const pkgSpec = (entry.args || []).find(a => typeof a === "string" && a.startsWith("@shopify/dev-mcp@")) || "(unknown)";
console.log("MCP command:", entry.command, (entry.args || []).join(" "));
console.log("Pinned package:", pkgSpec);

// On Windows, `npx` resolves to `npx.cmd`; child_process.spawn() without a shell
// cannot locate a .cmd via PATH and fails with ENOENT. shell:true fixes this and
// is a no-op on other platforms.
const srv = spawn(entry.command, entry.args, { stdio: ["pipe", "pipe", "pipe"], shell: process.platform === "win32" });
let buf = "", convId = null, tools = [];
const send = o => srv.stdin.write(JSON.stringify(o) + "\n");
const text = m => (m.result?.content || []).map(c => c.text || "").join("\n");
const fail = msg => { console.error("MCP SELF-CHECK: FAIL —", msg); try { srv.kill(); } catch {} process.exit(1); };
const to = setTimeout(() => fail("timed out before completing validation (server unreachable / offline?)"), 120000);

srv.stderr.on("data", () => {}); // dev-mcp logs progress to stderr; ignore
srv.stdout.on("data", d => {
  buf += d.toString(); let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue;
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m.id === 1) { send({ jsonrpc: "2.0", method: "notifications/initialized" });
      send({ jsonrpc: "2.0", id: 2, method: "tools/list" }); }
    else if (m.id === 2) {
      tools = (m.result?.tools || []).map(t => t.name);
      console.log("Tools exposed:", JSON.stringify(tools));
      for (const req of ["learn_shopify_api", "validate_graphql_codeblocks"])
        if (!tools.includes(req)) return fail(`server does not expose ${req}`);
      send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "learn_shopify_api", arguments: { api: "admin" } } });
    }
    else if (m.id === 3) {
      const t = text(m);
      const mm = t.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
      convId = mm ? mm[1] : null;
      if (!convId) return fail("learn_shopify_api returned no conversationId");
      send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "validate_graphql_codeblocks",
        arguments: { conversationId: convId, api: "admin", codeblocks: [{ content: "query { shop { thisFieldDoesNotExist_xyz } }" }] } } });
    }
    else if (m.id === 4) {
      const t = text(m);
      if (!/INVALID/i.test(t) || /Overall Status:\s*✅/i.test(t)) return fail("known-bad GraphQL was NOT reported invalid:\n" + t.slice(0, 300));
      console.log("BAD  GraphQL -> reported INVALID  (correct)");
      send({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "validate_graphql_codeblocks",
        arguments: { conversationId: convId, api: "admin", codeblocks: [{ content: "query { shop { name } }" }] } } });
    }
    else if (m.id === 5) {
      const t = text(m);
      if (!/VALID/i.test(t) || /INVALID/i.test(t)) return fail("known-good GraphQL was NOT reported valid:\n" + t.slice(0, 300));
      console.log("GOOD GraphQL -> reported VALID    (correct)");
      clearTimeout(to);
      console.log("MCP SELF-CHECK: PASS (server connectable, tools exposed, validator rejects bad + accepts good; no store, no auth)");
      try { srv.kill(); } catch {}
      process.exit(0);
    }
  }
});
srv.on("error", e => fail("could not start MCP server: " + e.message));
send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "wsa-selfcheck", version: "0" } } });
