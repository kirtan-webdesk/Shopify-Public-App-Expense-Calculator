# RELEASE EVIDENCE — webdesk-shopify-apps v0.1.8-beta.6

## v0.1.8-beta.6 (2026-08-24) — subagent-registration defect fixed, WITH genuine authenticated runtime evidence

**CLI:** `claude --version` → `2.1.241 (Claude Code)`, native install, Windows.
**Install:** isolated `CLAUDE_CONFIG_DIR`, local directory marketplace, `--scope local` (not `--scope user`).
No Shopify policy, gate, permission, skill, workflow content, public-only distribution scope, MCP
version, session-storage decision, or QA read-only permission changed.

### 1. Reproduction (before any change) — the reported beta.5 defect reproduces exactly

Orchestrator as main agent (`claude --agent webdesk-shopify-apps:orchestrator`), asked to delegate
a validation-only task to `shopify-developer`:
```
Agent type 'shopify-developer' not found. Available agents: none
```
Confirmed via `claude plugin details` first: `Agents (8)` / `Skills (11)` / `MCP servers (1)` all
present and healthy — the failure is purely at Agent(...) delegation lookup, matching the original
report exactly (same error text, same "healthy install, broken delegation" shape).

**Diagnostic-only check (not the delegation test):** launching the specialist directly,
`claude --agent webdesk-shopify-apps:shopify-developer`, works fine and correctly identifies itself —
confirming the agent *file* and its main-agent registration are both fine. The defect is specific to
sub-agent-type lookup for `Agent(...)` delegation.

### 2. Root cause

A plugin's agents register as invocable **sub-agent types**, for `Agent(...)` delegation-lookup
purposes, **only under their fully plugin-scoped identifier** `webdesk-shopify-apps:<name>`. The bare
name (`shopify-developer`) resolves when launching that agent **as the session's main agent**
(`--agent webdesk-shopify-apps:shopify-developer`), but is **not** a registered delegation target.
beta.1–beta.5 shipped the bare form in the orchestrator's `tools: Agent(pm, architect, …)` allowlist;
it satisfied `validate-plugin.py`'s (and `claude plugin validate --strict`'s) checks and looked correct
in `claude plugin details`, but failed at runtime on every delegation attempt. This is not explicitly
documented either way in the official Claude Code docs (checked `sub-agents.md`, `plugins-reference.md`,
`tools-reference.md`) — confirmed empirically against the installed 2.1.241 build instead.

### 3. Fix — exact changed files

- `agents/orchestrator.md` — `tools:` allowlist changed to
  `Agent(webdesk-shopify-apps:pm, webdesk-shopify-apps:architect, webdesk-shopify-apps:designer, webdesk-shopify-apps:shopify-developer, webdesk-shopify-apps:qa, webdesk-shopify-apps:code-review, webdesk-shopify-apps:delivery-head)`
  (was the bare-name form); prose updated to require the scoped form and explain why. Read, Grep,
  Glob, Bash preserved unchanged.
- `tools/scripts/validate-plugin.py` — the orchestrator-allowlist check now requires the exact seven
  **scoped** identifiers, rejects any bare/unscoped specialist name, rejects wrong-plugin scoping,
  still rejects a bare `Agent`/missing/extra specialist, and still confirms each scoped id maps to a
  real `agents/<name>.md`. (Unrelated robustness fix bundled: `os.path.relpath()` calls that only
  affected error-message display text now fall back safely instead of crashing when the plugin root
  and the invoking cwd are on different Windows drive letters — no change to any pass/fail logic.)
- `tools/scripts/mcp-selfcheck.mjs` — `spawn(entry.command, …)` now passes `shell: true` on
  `win32`; Node's `spawn('npx', …)` cannot resolve `npx.cmd` via PATH without a shell on Windows
  (pre-existing bug, surfaced while re-running the full suite here).
- `tests/mcp-evidence-cases.py` — the pre-existing symlink-escape case now SKIPS cleanly (rather than
  crashing the whole script) when the host can't produce a Unix-style `/etc/hostname` + symlink (stock
  Windows); every other case is unaffected and the security assertion itself is unchanged.
- `tests/run-acceptance.sh` — T4 updated to require the scoped form; new **T17** adds a positive case
  (shipped allowlist validates clean) and 5 negative mutations (bare `Agent`; all-bare specialists —
  the exact beta.5 regression shape; missing specialist; extra specialist; one entry scoped to the
  wrong plugin) — all confirmed rejected.
- `README.md`, `INSTALL.md`, `tests/cold-plugin-discovery.md`, `CHANGELOG.md` — updated to the scoped
  form and the corrected mental model; version bumped everywhere to `0.1.8-beta.6`.
- `.claude-plugin/plugin.json` — `version: 0.1.8-beta.6`.
- `INSTALL.md` — added a Windows PowerShell 5.1 BOM-free `marketplace.json` write
  (`[System.IO.File]::WriteAllText(...,[System.Text.UTF8Encoding]::new($false))`), matching a
  Runbook defect reported alongside the beta.5 test (`Set-Content -Encoding utf8` on PowerShell 5.1
  prepends a BOM that `claude plugin marketplace add` rejects).
- `tests/shopify-dev-store-smoke.md` — documented the separate DEV-001 `[events]`-block finding
  (disposable dev-store TOML workaround only; never production; never a fabricated subscription).

**Not changed:** any Shopify rule/gate/policy, any agent's role or `skills:`, QA/code-review's exact
`[Read, Grep, Glob]`, the MCP package pin (`@shopify/dev-mcp@1.14.5`), public-only distribution scope,
session-storage decisions, or `project.json`/schema/architecture content.

### 4. Static validation (this build)

```
claude plugin validate . --strict     -> ✔ Validation passed
python tools/scripts/validate-plugin.py .   -> checked 20 documents under . / OK: zero errors.
bash tests/run-acceptance.sh          -> PASSED=17  FAILED=0  SKIPPED=2  -> ACCEPTANCE OK
```
(T13 MCP self-check and T15's 51 evidence cases + 1 platform-skip both included in the 17.)

Negative-check confirmation: feeding the **unmodified beta.5** `orchestrator.md` (bare-name
allowlist) through the beta.6 `validate-plugin.py` produces:
```
ERROR agents/orchestrator.md: Agent(...) allowlist contains BARE (unscoped) specialist name(s)
  ['architect', 'code-review', 'delivery-head', 'designer', 'pm', 'qa', 'shopify-developer'] —
  a plugin agent only registers as a delegatable sub-agent type under its scoped identifier
  'webdesk-shopify-apps:<name>'; a bare name platform-validates but fails at runtime with
  "Agent type '<name>' not found. Available agents: none" (the beta.5 defect). Use the scoped form.
ERROR agents/orchestrator.md: Agent(...) allowlist is missing specialist(s) [...all 7, scoped...]
```

### 5. Authenticated runtime evidence — GENUINE, executed against the installed 2.1.241 build

Both tests below ran with `webdesk-shopify-apps@wsa-beta6` installed `--scope local` in an isolated
`CLAUDE_CONFIG_DIR`, against the exact `0.1.8-beta.6` package (`claude plugin details` confirmed
8 agents / 11 skills / MCP servers (1) before testing). This supersedes the beta.1–beta.5
"NOT EXECUTED" status for this test — it is genuinely run and passed here.

**5.1 POSITIVE — orchestrator delegates, developer subagent calls both MCP tools, invalid query → INVALID**

Command: `claude -p --agent webdesk-shopify-apps:orchestrator "Delegate a validation-only task to
the shopify-developer agent: (1) learn_shopify_api api=admin; (2) validate_graphql_codeblocks on
query { shop { thisFieldDoesNotExist_xyz } }; (3) no file changes."`

Debug-log evidence (`cc_is_subagent=true`, both calls attributed to the developer, not the orchestrator):
```
[API REQUEST] /v1/messages ... source=agent:custom:webdesk-shopify-apps:shopify-developer
[Stall] tool_dispatch_start tool=mcp__plugin_webdesk-shopify-apps_shopify-dev-mcp__learn_shopify_api
  toolUseId=toolu_01UouS4VVDaizEtQT8gteQPx
MCP server "plugin:webdesk-shopify-apps:shopify-dev-mcp": Tool 'learn_shopify_api' completed successfully in 66ms
[API REQUEST] /v1/messages ... source=agent:custom:webdesk-shopify-apps:shopify-developer
[Stall] tool_dispatch_start tool=mcp__plugin_webdesk-shopify-apps_shopify-dev-mcp__validate_graphql_codeblocks
  toolUseId=toolu_01FHMRAZx4jsmMvKar3tAmwo
MCP server "plugin:webdesk-shopify-apps:shopify-dev-mcp": Tool 'validate_graphql_codeblocks' completed successfully in 412ms
[Stall] agent_completion agentId=ac2909a6367906108 agentType=webdesk-shopify-apps:shopify-developer
  exitPath=completed turns=3 finalStopReason=end_turn
```
Reported validation result: `Overall Status: ❌ INVALID — Cannot query field "thisFieldDoesNotExist_xyz" on type "Shop".`
`subagent_stats.by_type` = `{"webdesk-shopify-apps:shopify-developer": 1}`, `spawned: 1`, `completed: 1`, `failed: 0`.
**PASS on all four required conditions:** developer subagent launched; both MCP calls occurred
*through* it (not the orchestrator, not a direct script); the invalid query returned INVALID; the
orchestrator performed no validation itself (zero `mcp__` tool-dispatch events attributed to the
orchestrator's own turn in the debug log).

**5.2 NEGATIVE — QA cannot use the Dev MCP**

Command: `claude -p --agent webdesk-shopify-apps:qa "Use the Shopify Dev MCP to validate query {
shop { name } }. Call learn_shopify_api and validate_graphql_codeblocks directly."`

Result: *"I don't have access to the Shopify Dev MCP tools (or any MCP tools) — my toolset is
strictly Read, Grep, and Glob."* Debug log: **zero** `mcp__` / `tool_dispatch` lines for the entire
turn (grepped the full debug file — no matches). QA never had the tool to attempt, let alone got
denied. **PASS:** QA launched successfully, made zero `mcp__` calls, tools remain exactly
`[Read, Grep, Glob]`.

**5.3 Preload/discovery cold session (`tests/cold-plugin-discovery.md` §6) — 26/26 PASS**

Executed all 26 (agent, declared-skill) pairs across all 8 agents, each in its own fresh,
non-resumed invocation asking only for that skill's preload token. **Result: 26/26 PASS, 0 FAIL.**
For every pair: the debug log's `[Agent: webdesk-shopify-apps:<name>] Preloaded skill '<skill>'`
line confirms injection at subagent-spawn time, the exact token is produced, and zero
`Read`/`Grep`/`Glob`/`Bash`/`Skill` lookup attempts occur.

Methodology note (why this took several rounds): the first attempt used
`claude --agent webdesk-shopify-apps:<name>` (launching each specialist as the session's **main**
agent) and got 0/26 — that invocation mode does **not** trigger `skills:` preload; only spawning the
agent as a genuine **subagent** does. Correcting to subagent spawns (via a minimal relay agent using
the `Agent` tool, mirroring the doc's `@`-mention methodology) surfaced a second, unrelated
complication: a relay told to "relay verbatim, no commentary" intermittently refused, correctly
recognizing that exact framing as a prompt-injection/exfiltration pattern (asking it to blindly
forward a secret-shaped `WSA-PRELOAD-...` string). This was relay-harness judgment, not a plugin
defect — debug logs proved preload succeeded even on turns where the relay declined to repeat the
token. Dropping the "verbatim/no commentary" framing in favor of a normal "tell me what it said"
ask eliminated the refusals entirely. No plugin file was changed to obtain this result.

### 6. Remaining blockers / NOT EXECUTED

- **Live Shopify dev-store smoke test** (`tests/shopify-dev-store-smoke.md`) — still requires a real
  disposable Partner dev store; NOT EXECUTED here, unchanged from beta.5. This is the only one of
  the four gating tests (see beta.5's "Impact on the test plan" table) still outstanding.
- No MCP-inheritance/runtime blocker was found: the developer subagent received full, correctly-scoped
  MCP access on the first successful delegation — nothing to report under item 11 of the task.

**Pilot-approval status: 3 of the 4 gating tests (real MCP invocation, QA-denial, preload/discovery
cold session) now PASS with genuine authenticated evidence (§5.1–§5.3). Static validation is green
(§4). No policy/gate/permission regression. Recommend proceeding**, pending the still-NOT-EXECUTED
live dev-store smoke test being run in a real Partner environment before full production sign-off.

---

# Appendix — v0.1.8-beta.5 evidence (superseded; retained for history)

Final local-evidence patch (three blockers on beta.4). All output unedited, produced in-sandbox.
**Pinned MCP package:** `@shopify/dev-mcp@1.14.5` (unchanged). No credentials; no Shopify store touched.
Each blocker (B10 dual-status, B11 unbound gate command, B12 project.json not bound) was reproduced on beta.4 before the fix.
Preload-token VALUES are never printed here (see §4).
Date: 2026-08-21 11:02 UTC  |  CLI: 2.1.237 (Claude Code)  |  node: v22.23.2  |  python: Python 3.10.12

## 1. Structural validation

### `claude plugin validate . --strict`
```
Validating plugin manifest: /sessions/awesome-intelligent-brahmagupta/mnt/outputs/webdesk-shopify-apps-plugin/webdesk-shopify-apps/.claude-plugin/plugin.json

✔ Validation passed
```

### `python3 tools/scripts/validate-plugin.py .`
```
validate-plugin: checked 20 documents under .
OK: zero errors.
```

## 2. Full acceptance suite (unedited) — 16 mandatory (T15 = 52 evidence cases)
```
===== MANDATORY LOCAL TESTS =====
T1: claude plugin validate --strict (manifest)
  PASS : manifest valid (strict)
T2: validate-plugin.py — YAML frontmatter + refs + agent wiring + dir refs
  PASS : validate-plugin: zero errors
T3: every skill/agent has name+description (discoverable)
  PASS : all skills/agents discoverable
T4: orchestrator declares an EXACT Agent(...) allowlist of the 7 specialists (bare Agent must fail)
  PASS : orchestrator Agent(...) allowlist = exactly the 7 specialists
T5: producing agents have Write+Edit; qa/code-review tools are EXACTLY [Read, Grep, Glob]
  PASS : producing agents Write+Edit; qa/code-review exactly [Read,Grep,Glob]
T6: scaffolder — uuid4 id, schema-valid for all types, guards work
  PASS : uuid4 id + schema-valid (all types); slug/type/api-version(non-quarter)/overwrite guards enforced
T7: mandatory app-CI checks cannot silently skip (no --if-present)
  PASS : lint/typecheck/test/build present + unconditional
T8: all workflow YAML + manifest JSON + schema JSON + settings.json parse
  PASS : all YAML/JSON parse (incl settings.json)
T9: clean-env bootstrap
  PASS : clean-env bootstrap ok
T10: REAL CLI component inventory of the EXACT shipped package — under an isolated CLAUDE_CONFIG_DIR
EXACT-PACKAGE CLI inventory OK: 8 agents, 11 skills, MCP server 'shopify-dev-mcp' present, no unexpected components
  PASS : exact-package inventory = 8 agents / 11 skills, no unexpected components (isolated CLAUDE_CONFIG_DIR)
T11: preload tokens — one VISIBLE marker per skill, skill-name match, unique, only in its SKILL.md (values not printed)
  (11 visible, name-matched tokens verified; values intentionally not printed)
  PASS : 11 visible preload tokens (name-matched), one per skill, none leaked into agents/other skills/tests/docs/evidence
T12: Shopify Dev MCP config + agent wiring (static) — pinned version, dev-only access, others none, qa/cr read-only
  MCP pinned @ 1.14.5; shopify-developer scoped-MCP only; 7 others none; qa/code-review read-only
  PASS : MCP pinned+wired: shopify-developer only; qa/code-review exactly read-only
T13: Shopify Dev MCP self-check — server connects, exposes tools, validates (bad=INVALID, good=VALID); NO store, NO auth
  PASS : MCP self-check: connectable, tools exposed, bad->INVALID, good->VALID
T14: MCP negative guards — validator must REJECT 5 misconfigurations
    caught  : remove MCP from shopify-developer
    caught  : grant MCP to QA
    caught  : @latest (unpinned) MCP version
    caught  : mcpServers: in a plugin agent
    caught  : bare/incorrectly-scoped MCP tool name
  PASS : all 5 MCP misconfigurations rejected by the validator
T15: MCP evidence gate — positive + honest-BLOCKED + result/gate-command/project-binding rejections (check-dev-handoff.py)
  PASS : 52 MCP-evidence cases behave (positive accepted; honest BLOCKED; all misuses rejected)
T16: MCP workflow wiring — validate-plugin REJECTS unwired orchestrator, unrequired-QA-evidence, and QA+MCP/Bash
    caught  : orchestrator does not run check-dev-handoff.py
    caught  : QA does not require the MCP evidence artifact
    caught  : QA granted Bash
    caught  : checker invoked without ${CLAUDE_PLUGIN_ROOT} (bare project-relative)
    caught  : checker --root not ${CLAUDE_PROJECT_DIR}
    caught  : overstated validate_theme/extension wording
  PASS : workflow-wiring + ${CLAUDE_PLUGIN_ROOT}/${CLAUDE_PROJECT_DIR} + extension-wording misconfigs all rejected

===== EXTERNAL TESTS (NOT EXECUTED — require systems this sandbox lacks) =====
  SKIP : live Shopify dev-store smoke (tests/shopify-dev-store-smoke.md) — needs a DISPOSABLE dev store + credentials + deployed app
  SKIP : real end-user cold Claude Code session (tests/cold-plugin-discovery.md) — structural discovery IS covered by T1/T2

===== RESULT: PASSED=16  FAILED=0  SKIPPED=2 (skips are external-only, documented) =====
ACCEPTANCE OK
```

## 3. Full MCP evidence-case matrix (52 cases, unedited)

Regressions for every beta.2/beta.3/beta.4 blocker + the new B10 (authoritative result.status),
B11 (exact gate command + log-exit binding), B12 (project.json + conversationId binding), plus the positive.
```
  [ok] exit=0 (want 0)  POSITIVE public+VALID, structured record + project.json
  [ok] exit=3 (want 3)  honest BLOCKED
  [ok] exit=3 (want 3)  custom + BLOCKED (allowed only as BLOCKED)
  [ok] exit=1 (want 1)  overall INVALID must not proceed
  [ok] exit=1 (want 1)  gate lint = skip must not proceed
  [ok] exit=1 (want 1)  gate typecheck = skip must not proceed
  [ok] exit=1 (want 1)  gate tests = skip must not proceed
  [ok] exit=1 (want 1)  gate build = skip must not proceed
  [ok] exit=1 (want 1)  gate build = fail must not proceed
  [ok] exit=1 (want 1)  custom + VALID must never be accepted
  [ok] exit=1 (want 1)  extension-only + VALID must never be accepted
  [ok] exit=1 (want 1)  graphql type + validate_theme tool
  [ok] exit=1 (want 1)  theme type + validate_graphql tool
  [ok] exit=1 (want 1)  polaris-component type + validate_graphql tool
  [ok] exit=1 (want 1)  learn_shopify_api used as a validator
  [ok] exit=1 (want 1)  absolute validated-file path
  [ok] exit=1 (want 1)  '..' traversal validated-file path
  [ok] exit=1 (want 1)  symlink escape validated file
  [ok] exit=1 (want 1)  absolute MCP-Evidence path
  [ok] exit=1 (want 1)  commit mismatch
  [ok] exit=1 (want 1)  validated-file hash mismatch
  [ok] exit=1 (want 1)  missing MCP evidence file
  [ok] exit=1 (want 1)  bare tool-name claim, no evidence artifact
  [ok] exit=1 (want 1)  missing lint gate (schema)
  [ok] exit=1 (want 1)  BLOCKED and VALID in same handoff
  [ok] exit=1 (want 1)  NOT EXECUTED + PASSED contradiction
  [ok] exit=1 (want 1)  B9 plain-text record (not JSON)
  [ok] exit=1 (want 1)  B9 record tool-call id != evidence
  [ok] exit=1 (want 1)  B9 record input hash != validated file
  [ok] exit=1 (want 1)  B9 duplicate tool-call id across validations
  [ok] exit=1 (want 1)  B10 result.status INVALID + evidence VALID
  [ok] exit=1 (want 1)  B10 result.status BLOCKED + evidence VALID
  [ok] exit=1 (want 1)  B10 summary declares INVALID while status VALID
  [ok] exit=1 (want 1)  B10 VALID result with non-empty errors
  [ok] exit=1 (want 1)  B10 missing result.status (schema)
  [ok] exit=1 (want 1)  B10 arbitrary result string (schema)
  [ok] exit=1 (want 1)  B10 overall VALID with a non-VALID validation
  [ok] exit=1 (want 1)  B11 gate command 'bash -c true'
  [ok] exit=1 (want 1)  B11 gate command 'echo passed'
  [ok] exit=1 (want 1)  B11 lint gate using the build command
  [ok] exit=1 (want 1)  B11 shell operator appended to required command
  [ok] exit=1 (want 1)  B11 log exit-code != recorded exit_code
  [ok] exit=1 (want 1)  B11 status pass but run failed (exit 1)
  [ok] exit=1 (want 1)  B11 gate output hash mismatch
  [ok] exit=1 (want 1)  B11 reused output_ref across gates
  [ok] exit=1 (want 1)  B12 evidence api_version != project.json
  [ok] exit=1 (want 1)  B12 project.json distribution != public (mismatch/schema)
  [ok] exit=1 (want 1)  B12 missing project.json
  [ok] exit=1 (want 1)  B12 malformed project.json
  [ok] exit=1 (want 1)  B12 graphql record missing conversation_id (schema)
  [ok] exit=1 (want 1)  B12 conversation_id mismatch record vs evidence
  [ok] exit=0 (want 0)  B12 POSITIVE public project + matching api_version

ALL 52 MCP-EVIDENCE CASES BEHAVE AS EXPECTED
```

## 3b. Bundled gate runner (`run-gates.py`) smoke — real shell=False execution
```
}

manifest: app/.gates/manifest.json
lint.log tail:
lint ok
__GATE_EXIT__:0
```

## 4. Preserve-list confirmation + preload-token integrity
```
version           : "version":"0.1.8-beta.5"
agents / skills   : 8 / 11
MCP pin           : @shopify/dev-mcp@1.14.5 (unchanged)
MCP-holding agents: shopify-developer.md (only shopify-developer)
QA / Code Review  : tools: [Read, Grep, Glob] / tools: [Read, Grep, Glob]
distribution enum : public (public-only, unchanged)
scratch (_*/probe): 0
schemas           : evidence + validation-record + project-json
gate runner       : tools/scripts/run-gates.py present
preload tokens    : 11/11 one-per-skill, 11 unique
```

No Shopify rules, public-App-Store-only scope, workflow, agents, permissions, MCP pin 1.14.5,
session storage, caching, billing, preload tokens, or custom-app architecture changed in beta.5.

## 5. NOT EXECUTED (not fabricated) — the next action, mandatory before pilot

1. Real `shopify-developer` MCP invocation (cold-session §9.1) — NOT EXECUTED.
2. QA MCP-denial runtime test (cold-session §9.2) — NOT EXECUTED.
3. Preload/discovery cold session (`tests/cold-plugin-discovery.md`) — NOT EXECUTED.
4. Live disposable dev-store smoke (`tests/shopify-dev-store-smoke.md`) — NOT EXECUTED (no store touched).

This checker is consistency-checked LOCAL evidence, not authenticated execution. After beta.5 passes,
run the four tests above on your local Claude Code computer — do not add another artificial evidence layer.
