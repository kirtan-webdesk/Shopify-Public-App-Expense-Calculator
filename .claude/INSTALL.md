# Install & start — webdesk-shopify-apps

## Prerequisites
- Claude Code CLI, Node.js 22+, python3 with `jsonschema` + `pyyaml` (`pip install jsonschema pyyaml`), git. Optional: Shopify CLI for app dev.
- Verify: `bash tools/scripts/check-env.sh`

## 1. Validate the plugin (tested in this build)
```bash
claude plugin validate ./webdesk-shopify-apps --strict
python3 ./webdesk-shopify-apps/tools/scripts/validate-plugin.py ./webdesk-shopify-apps
bash ./webdesk-shopify-apps/tests/run-acceptance.sh
```
Expected: `✔ Validation passed`, `OK: zero errors`, and `PASSED=17  FAILED=0  SKIPPED=2` → `ACCEPTANCE OK`.

> **Shopify Dev MCP.** The plugin ships `.mcp.json` bundling
> `@shopify/dev-mcp` (pinned exact version). When the plugin is enabled, Claude Code starts the
> server automatically and exposes it **only** to the `shopify-developer` agent. It runs locally
> via `npx`, needs **no Shopify credentials, and never connects to a store**. `node` 18+ must be
> on PATH so `npx` can launch it. `claude plugin details webdesk-shopify-apps` shows it under
> `MCP servers (1)  shopify-dev-mcp`. Acceptance test **T13** runs a live self-check
> (`node tools/scripts/mcp-selfcheck.mjs`) that connects, lists tools, and validates a bad
> GraphQL query (→ INVALID) and a good one (→ VALID) — no store involved.

## 2. Load locally (development)
```bash
claude --plugin-dir /absolute/path/to/webdesk-shopify-apps
# in the session, confirm agents + shopify-* skills are listed:
/context
```

## 3. Marketplace install — scope matters (this plugin ships a default `agent`)
```bash
# marketplace.json plugin `source` must be RELATIVE to the marketplace root, and the
# marketplace.json requires an `owner` object.
claude plugin marketplace add <your-marketplace>
```

> **Windows PowerShell 5.1 — write `marketplace.json` WITHOUT a UTF-8 BOM.** Windows
> PowerShell 5.1's `Set-Content -Encoding utf8` (and `Out-File -Encoding utf8`) prepend a
> byte-order mark. `claude plugin marketplace add` then rejects the file:
> `Invalid JSON in marketplace.json: JSON Parse error: Unrecognized token '\ufeff'`.
> (`pwsh` 7+ defaults to BOM-free UTF-8, so this only bites the default Windows shell.)
> Use a BOM-free write instead:
> ```powershell
> $json = @'
> { "name": "wsa-local", "owner": { "name": "WebDesk Solution" },
>   "plugins": [ { "name": "webdesk-shopify-apps", "source": "./plugins/webdesk-shopify-apps", "description": "local install" } ] }
> '@
> $path = "C:\path\to\market\.claude-plugin\marketplace.json"
> New-Item -ItemType Directory -Force (Split-Path $path) | Out-Null
> [System.IO.File]::WriteAllText($path, $json, [System.Text.UTF8Encoding]::new($false))
> ```
> Do **not** use `Set-Content -Encoding utf8` for this file on PowerShell 5.1.

`claude plugin install` defaults to **`--scope user`**, which enables this plugin — and
its default Shopify orchestrator agent — in **every** project where the plugin is enabled.
For a bounded pilot, install from **inside the Rossy Shopify app repository** with a
project-scoped install instead:
```bash
# not shared with the team (local machine only):
claude plugin install webdesk-shopify-apps@<your-marketplace-id> --scope local
#   or, recorded for everyone who clones the repo (writes enabledPlugins to .claude/settings.json):
claude plugin install webdesk-shopify-apps@<your-marketplace-id> --scope project

# component inventory (needs the plugin installed; takes a NAME, not --plugin-dir):
claude plugin details webdesk-shopify-apps      # → Skills (11), Agents (8)
```
Only choose the default user scope if you explicitly want the orchestrator active in
every enabled project. **Tear down with the same qualified name + scope:**
```bash
claude plugin uninstall webdesk-shopify-apps@<your-marketplace-id> --scope local
```

> Isolated dry run: prefix any of the above with `CLAUDE_CONFIG_DIR=/tmp/wsa-try` to
> exercise install/details/uninstall against a throwaway config without touching your
> real `~/.claude` (this is exactly what acceptance T10 does).

## 4. Start a Shopify app project
```bash
bash tools/scripts/init-project.sh \
  --client rossy-ai --type app-build --api-version 2026-07 \
  --data-ownership shared-saas --hosting long-running --protected-scopes
```
**Activation has two modes and they are not equivalent.** The plugin ships `settings.json`
= `{"agent": "orchestrator"}`, so once enabled the orchestrator is the **main** agent.
Run real work this way (or `claude --agent webdesk-shopify-apps:orchestrator`) — **only
as the main agent does Claude Code platform-enforce the orchestrator's sub-agent
allowlist.** The `@`-mention / typeahead form (`@agent-webdesk-shopify-apps:orchestrator`)
invokes the orchestrator as a **subagent** for a single task; at that nested depth the
`Agent(...)` type list is ignored, so the seven-specialist restriction is not
platform-enforced. Then follow the gate flow.

> **v0.1.8-beta.6:** delegation to the seven specialists only works when the
> orchestrator's `Agent(...)` allowlist names them by their fully **scoped** identifier
> (`webdesk-shopify-apps:pm`, `webdesk-shopify-apps:shopify-developer`, …). A bare name
> (`shopify-developer`) is not a registered sub-agent type for a plugin agent and fails
> at runtime with `Agent type 'shopify-developer' not found. Available agents: none` —
> this was the beta.5 defect. If you forked this plugin's `orchestrator.md` before
> beta.6, re-apply the scoped allowlist.
