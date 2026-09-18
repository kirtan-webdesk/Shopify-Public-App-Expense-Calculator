# Cold plugin-discovery test — NOT EXECUTED (run in your interactive environment)

This is a **manual acceptance script for a real, interactive end-user Claude Code
session**. It is deliberately **not executed** in the build sandbox: it requires a fresh
install and a human observing autonomous agent/skill behavior and the startup UI, which
the non-interactive build environment cannot produce. Do not treat any step here as
passed until a person runs it and records the result.

**What the automated suite already covers** (so you can scope this run to the interactive
gaps):

- `claude plugin validate . --strict` → manifest well-formed (acceptance **T1**).
- `validate-plugin.py .` → frontmatter, references, the orchestrator's exact `Agent(...)`
  allowlist, and the **exact** `[Read, Grep, Glob]` tool set for qa/code-review (**T2/T4/T5**).
- `claude plugin details` **real CLI inventory of the exact, unfiltered package** = exactly
  **8 agents / 11 skills**, no scratch/probe components, run under an **isolated
  `CLAUDE_CONFIG_DIR`** (acceptance **T10**). This proves the shipped component set; the
  steps below prove *runtime behavior*.
- **Preload tokens are well-formed** — exactly one opaque `WSA-PRELOAD-<skill>-<hex>` per
  skill, all unique, none leaked outside their `SKILL.md` (acceptance **T11**). §6 below uses
  them to prove *runtime* preload, which the structural check cannot.
- **Dev MCP works and is wired** — the server connects and validates (bad GraphQL → INVALID,
  good → VALID) at the **process level** (acceptance **T13**, `mcp-selfcheck.mjs`); `.mcp.json`
  is pinned; only `shopify-developer` holds the scoped tool; the evidence-gate rejects unbacked
  claims (**T12/T14/T15/T16**). **Important:** T13 talks to the MCP process **directly** — it
  does **not** prove that a real `shopify-developer` *subagent* can call the plugin-namespaced
  MCP tools *through Claude Code*. That runtime proof is **§9 below** and is **NOT EXECUTED**
  in the build sandbox (it needs a logged-in, model-backed session, which the sandbox lacks).

> Run everything below against a **throwaway config** if you want to avoid touching your
> real setup: prefix commands with `CLAUDE_CONFIG_DIR=/tmp/wsa-cold` (see env-vars docs).

---

## 0. Install from a marketplace (project-scoped, as the pilot will)

Because the plugin ships a **default `agent`**, a default user-scope install makes the
orchestrator the main agent in every enabled project. Install from **inside the Rossy
Shopify app repo** with a bounded scope:

```bash
claude plugin marketplace add <your-marketplace>
claude plugin install webdesk-shopify-apps@<your-marketplace-id> --scope local
```

`claude plugin details webdesk-shopify-apps` requires the plugin **installed** (it takes a
plugin *name*, not `--plugin-dir`). Confirm the header
`WebDesk Shopify Apps (webdesk-shopify-apps) 0.1.8-beta.6` and the `Component inventory` block
(which now also lists `MCP servers (1)  shopify-dev-mcp`).

## 1. Component inventory — all 8 agents + all 11 skills, nothing extra

From `claude plugin details webdesk-shopify-apps` (or `/context` in a session), confirm the
**8 agents**: `orchestrator, pm, architect, designer, shopify-developer, qa, code-review,
delivery-head` and the **11 skills**: `shopify-public-app-delivery, shopify-app-scaffold,
shopify-app-auth-and-routes, shopify-admin-graphql, shopify-polaris-app-bridge,
shopify-app-billing, shopify-webhooks-compliance, shopify-protected-customer-data,
shopify-data-jobs-ownership, shopify-app-review-readiness, shopify-built-for-shopify`.
There must be **no** component whose name starts with `_` or `probe`.

## 2. Orchestrator as the session's MAIN agent (the mode that enforces the allowlist)

The plugin ships `settings.json` = `{"agent": "orchestrator"}` (bare, plugin-local). With
the plugin enabled, start a session and confirm the orchestrator is the **main** agent —
the startup header / `/status` shows the WebDesk Shopify Apps orchestrator. Or force it:

```bash
claude --agent webdesk-shopify-apps:orchestrator
```

**This is the only mode in which the `Agent(...)` allowlist is platform-enforced** (see §5).

## 3. Invocation modes — and the difference that matters

| How you invoke | Runs as | `Agent(...)` allowlist enforced by platform? |
|---|---|---|
| `settings.json` default agent | **main** session agent | **Yes** |
| `claude --agent webdesk-shopify-apps:orchestrator` | **main** session agent | **Yes** |
| Typeahead `@` → `webdesk-shopify-apps:orchestrator` | **subagent** (one task) | **No** |
| `@agent-webdesk-shopify-apps:orchestrator <task>` | **subagent** (one task) | **No** |

Confirm both: the typeahead entry appears and attaches; the `@agent-…` mention resolves
(no "unknown agent"). Understand that these `@` paths run the orchestrator **as a
subagent**, where — per the sub-agents docs — the type list inside `Agent(...)` is ignored.

## 4. Delegation to an ALLOWED specialist works (main-agent mode)

With the orchestrator as **main** agent, give it a task needing a specialist (e.g. "groom
this feature" → `pm`, "implement this route" → `shopify-developer`). Confirm it spawns the
named specialist via `Agent(<name>)` and that specialist runs (check the subagent status
line / transcript).

## 5. An UNAPPROVED agent is REJECTED — but ONLY test this in main-agent mode

The orchestrator's `tools:` line is
`Agent(webdesk-shopify-apps:pm, webdesk-shopify-apps:architect, webdesk-shopify-apps:designer, webdesk-shopify-apps:shopify-developer, webdesk-shopify-apps:qa, webdesk-shopify-apps:code-review, webdesk-shopify-apps:delivery-head), Read, Grep, Glob, Bash`
— **every specialist scoped**; see the beta.6 note in §9.1.

**Precondition (required):** confirm the orchestrator is the **main** agent via
`settings.json` default or `claude --agent …` (§2). The platform allowlist is enforced
**only** in this mode.

**Test:** ask the main-agent orchestrator to spawn a sub-agent **not** in the seven (e.g.
a generic `general-purpose`/`Explore` agent, or another plugin's agent). **Expected:**
Claude Code refuses the spawn because the target is outside the `Agent(...)` allowlist.
Record the exact refusal.

**Negative control (documents the limitation):** invoke the orchestrator instead as a
**subagent** (typeahead / `@agent-…`) and issue the same request. Per the docs the
parenthesized list is ignored at nested depth, so the platform does **not** block it here
— only the orchestrator's own instructions do. This is expected, and is exactly why the
docs do not claim `@`-mention gives the same guarantee. Do not file this as a bug; record
it as the documented boundary.

## 6. Each agent's declared `skills:` are ACTUALLY preloaded — opaque preload-token probes

> **v0.1.8-beta.6: executed headlessly, 26/26 PASS.** All (agent, declared-skill) pairs below were
> run non-interactively (each in its own fresh, non-resumed invocation, spawning the target as a
> genuine subagent rather than a main-agent launch — main-agent launch does NOT trigger preload).
> Exact token match, zero tool-lookup attempts, `Preloaded skill` debug-log confirmation for every
> pair. See `RELEASE-EVIDENCE.md` §5.3 for the full methodology and result. This supersedes the
> "NOT EXECUTED" status for §6 specifically; the rest of this document's interactive-UI steps
> (typeahead, startup header, `/status`) still require a human session.

Folder existence is not proof of preload, and a *semantic* question is not either — an agent
could answer it from its own instructions or from general Shopify knowledge. So each skill
carries one **opaque, high-entropy preload token** of the form
`WSA-PRELOAD-<skill>-<16 hex>`, placed once in that `SKILL.md` and **nowhere else in the
package** (enforced by `validate-plugin.py` + acceptance **T11**). The token has no meaning:
the only way an agent can produce it is if that skill's body was injected into its context.

**The token values are deliberately NOT printed here.** Read the expected value for a given
skill directly from its `skills/<skill>/SKILL.md` (the visible **"Preload verification token:"**
line) at review time, and compare. That marker line explicitly authorizes the agent to return
the token during this test, so a correctly preloaded agent will not refuse it.

**Isolation — one fresh invocation per pair (mandatory).** Run **every (agent, declared-skill)
pair in its own brand-new agent invocation.** Do **not** resume, continue, or reuse an earlier
subagent conversation, and do not ask a second skill's token in the same conversation: a prior
turn (especially one where a lookup happened) could leave a token in the conversation context
and produce a false PASS on a later question. A row is only valid if it is the **first and only**
question in a freshly started invocation of that agent.

**Procedure — for every (agent, declared-skill) pair, recorded separately:**

1. Start a **completely new invocation** of the agent (fresh subagent conversation; no resume).
   Ask **only** this, as the first message: *"What is your preload token for the `<skill>`
   skill? Reply with the exact `WSA-PRELOAD-…` token and nothing else."*
2. **A row PASSES only if ALL of these hold:**
   - the agent returns the **exact** token that matches that skill's `SKILL.md` marker; **and**
   - **no `Read`, `Grep`, `Glob`, `Bash`, `Skill`, or any other file-/skill-discovery tool
     call occurs in that invocation** — the answer must come from already-injected context; **and**
   - the **transcript or debug trace confirms no lookup or skill invocation happened** (inspect
     the tool-call log for that invocation; an empty tool-call log is the proof).
   - Any lookup — even one that returns the right token — means preload was **not** proven and
     the row **FAILS**. A wrong/partial/paraphrased token also fails.
3. Record PASS/FAIL per row for **all eight agents**. As a supplement, capturing Claude Code
   debug output that explicitly lists each declared skill injected into that agent's context
   at launch is also acceptable proof for that agent.

**Which skills each agent must produce a token for** (its declared `skills:`):

- **orchestrator** → shopify-public-app-delivery
- **pm** → shopify-public-app-delivery, shopify-protected-customer-data
- **architect** → shopify-app-auth-and-routes, shopify-admin-graphql, shopify-webhooks-compliance, shopify-data-jobs-ownership
- **designer** → shopify-polaris-app-bridge
- **shopify-developer** → shopify-app-scaffold, shopify-app-auth-and-routes, shopify-admin-graphql, shopify-webhooks-compliance, shopify-app-billing, shopify-polaris-app-bridge
- **qa** → shopify-webhooks-compliance, shopify-admin-graphql, shopify-app-billing, shopify-app-auth-and-routes
- **code-review** → shopify-app-auth-and-routes, shopify-admin-graphql, shopify-webhooks-compliance, shopify-app-billing, shopify-polaris-app-bridge
- **delivery-head** → shopify-app-review-readiness, shopify-built-for-shopify, shopify-webhooks-compliance

> Why a lookup fails the row: if the agent runs `Grep`/`Read`/`Skill` to fetch the token, you
> have proven it can *find* the skill on disk — not that the skill was **preloaded** into its
> context. Preload means the token is already there with zero retrieval.

## 7. QA execution + evidence-provenance model (SA-021 / SA-030)

QA holds `Read, Grep, Glob` only. Confirm in a live session that:

- QA does **not** run tests, seed stores, fire webhooks, or probe routes (no tool to do so).
- Given CI/executor artifacts, QA reads them and returns PASS / PASS_WITH_FLAGS / FAIL /
  BLOCKED — and never writes the gate result itself.
- QA **requires provenance** on every evidence set — commit SHA, CI run ID / executor
  identity, execution timestamp, test environment, artifact source, and store/build id —
  and returns **BLOCKED** if provenance is missing **or the artifact's commit does not match
  the commit under review**. Test this by handing QA an artifact with no commit SHA (expect
  BLOCKED) and one whose SHA ≠ the reviewed commit (expect BLOCKED).
- QA **proposes** the `audit_log` entry back to the orchestrator rather than writing it.

## 8. Startup header + `/context`

Confirm the startup header shows the plugin loaded with the orchestrator as the default
(main) agent, and `/context` lists the 8 agents + 11 skills matching §1.

## 9. Developer-agent MCP runtime access — MANDATORY before pilot approval (NOT EXECUTED here)

> **Why this is here and not in the automated suite.** Acceptance T13 proves the MCP *process*
> works by talking to it directly; it **bypasses** Claude Code plugin loading, plugin tool
> namespacing, subagent tool inheritance, the developer's `tools:` allowlist, and actual
> developer-agent invocation. A real model-backed subagent turn cannot run in the build sandbox
> (`claude -p` → "Not logged in"). So these two runtime tests are **NOT EXECUTED** in the build
> and **must be run and pass here before pilot approval**. A direct `mcp-selfcheck.mjs` result is
> **not** acceptable proof for §9.1.
>
> **v0.1.8-beta.6 note.** On beta.5, §9.1 was **blocked at step 4** — the orchestrator's `Agent(...)`
> allowlist named the seven specialists by their **bare** name, which is not a registered
> sub-agent type for a plugin agent; every delegation failed with `Agent type 'shopify-developer'
> not found. Available agents: none`, before any MCP call could happen. beta.6 fixes this by
> scoping every allowlist entry (`webdesk-shopify-apps:shopify-developer`, etc.). Re-run §9.1/§9.2
> against the beta.6 package before relying on this section — do not carry forward a beta.5 result.

### 9.1 POSITIVE — a real `shopify-developer` subagent calls the plugin-scoped MCP tools

1. In an **isolated** config, install the **exact, unfiltered** package and enable it:
   `CLAUDE_CONFIG_DIR=/tmp/wsa-rt claude plugin install webdesk-shopify-apps@<mkt> --scope local`.
2. Start the **orchestrator as the main agent** (settings default or
   `--agent webdesk-shopify-apps:orchestrator`).
3. Use the minimal public-app fixture `tests/fixtures/public-app-min/project.json`
   (`shopify.distribution: public`, `api_version: 2026-07`).
4. Ask the orchestrator to **delegate a validation-only task** to `shopify-developer`, and have
   the developer:
   - call `learn_shopify_api` (api `admin`),
   - call `validate_graphql_codeblocks` on a **deliberately invalid** query, e.g.
     `query { shop { thisFieldDoesNotExist_xyz } }`,
   - **make no source-code changes.**
5. Capture the Claude Code **transcript / stream-json / debug** for that turn.
6. **PASS only if ALL hold:**
   - the transcript contains actual tool-call events for
     `mcp__plugin_webdesk-shopify-apps_shopify-dev-mcp__learn_shopify_api` **and**
     `mcp__plugin_webdesk-shopify-apps_shopify-dev-mcp__validate_graphql_codeblocks`;
   - the invalid query is reported **INVALID**;
   - the tool results arrive through the **`shopify-developer` invocation** — not the
     orchestrator, and not a direct MCP script.
   Record the exact tool_use event ids (`toolu_…`) and the returned validation summary; these are
   what a real MCP evidence artifact (§ schema) would cite.

### 9.2 NEGATIVE — QA cannot use the Dev MCP

1. In the same isolated session, invoke **`qa`** and ask it to use the Shopify Dev MCP to validate
   something.
2. **PASS only if:** QA **cannot call any `mcp__` tool**, makes **no** MCP tool call, and remains
   exactly `[Read, Grep, Glob]`. (Do **not** change QA's permissions to run this test.)

Record both results. If §9.1 cannot be executed, it stays **NOT EXECUTED** — do **not** claim
developer runtime MCP access was proven on the strength of T13.

## 10. Teardown — same qualified name + scope

```bash
claude plugin uninstall webdesk-shopify-apps@<your-marketplace-id> --scope local
claude plugin marketplace remove <your-marketplace-id>
```

---

### Record PASS / FAIL + exact observed output for every step (and every agent in §6, plus §9).
A single FAIL blocks pilot sign-off even with the automated suite green — these steps cover
runtime behavior the structural checks cannot see.
