# WebDesk Shopify Apps — Claude Code plugin (v0.1.8-beta.6)

A Claude Code **plugin** that runs the full delivery + development lifecycle for a
**Shopify public App Store app** — grooming → build → protected-data approval →
App Review Readiness → submission → launch → maintenance → quarterly API-version
upgrades. It bundles **8 agents** (orchestrator + 7 specialists, including the
`shopify-developer` that owns React Router/TypeScript/GraphQL/webhooks/billing code)
and **11 skills** (Shopify app knowledge + the gated delivery flow). The orchestrator
carries a **restricted sub-agent allowlist**, using each specialist's fully **plugin-scoped**
identifier — `Agent(webdesk-shopify-apps:pm, webdesk-shopify-apps:architect,
webdesk-shopify-apps:designer, webdesk-shopify-apps:shopify-developer, webdesk-shopify-apps:qa,
webdesk-shopify-apps:code-review, webdesk-shopify-apps:delivery-head)` — which Claude Code
platform-enforces **when the orchestrator runs as the session's main agent** (settings default or
`--agent`); spawns outside those seven are refused. (Invoked as a subagent via
`@`-mention, the parenthesized list is ignored at nested depth, so the restriction then
rests on the orchestrator's instructions — see "Activate the orchestrator".) QA and Code
Review are read-only with **exactly** `Read, Grep, Glob`.

> **v0.1.8-beta.6 fix — bare specialist names never worked for delegation.** A plugin
> agent registers as an invocable **sub-agent type** only under its scoped identifier
> `webdesk-shopify-apps:<name>`; the bare name (e.g. `shopify-developer`) is not a
> registered delegation target, even though it resolves fine when launching that agent
> directly as a session's main agent. beta.1–beta.5 shipped the bare form in the
> `Agent(...)` allowlist; it platform-validated but every delegation failed at runtime
> with `Agent type 'shopify-developer' not found. Available agents: none`. Confirmed
> empirically against the installed Claude Code build (the official docs do not state
> this explicitly) and fixed by switching every allowlist entry to the scoped form.

**Shopify Dev MCP.** The plugin bundles Shopify's official **Dev MCP** server
(`@shopify/dev-mcp`, pinned exact version in `.mcp.json`) and grants it **only** to
`shopify-developer` (scoped tool `mcp__plugin_webdesk-shopify-apps_shopify-dev-mcp__*`). The
developer uses it to consult current Shopify docs/schemas and validate GraphQL
(`validate_graphql_codeblocks`), Polaris web components (`validate_component_codeblocks`), and
Liquid/theme code (`validate_theme`) before handing work to QA. **The Dev MCP has no dedicated
extension-configuration validator** — extension TOML/targets/build/runtime use the Shopify
CLI/build process and disposable dev-store testing. The server runs locally, **requires no
credentials, and never touches a Shopify store**; it is *additional* to lint/typecheck/tests/
build, security review, QA, and live testing. After the developer finishes, the orchestrator
runs `${CLAUDE_PLUGIN_ROOT}/tools/scripts/check-dev-handoff.py` (the checker ships in the installed
plugin) with `--root ${CLAUDE_PROJECT_DIR}`. It loads a **structured MCP evidence artifact**
(`tools/schemas/mcp-validation-evidence.schema.json`) plus a per-validation **structured validation
record** (`tools/schemas/mcp-validation-record.schema.json`), re-checks the reviewed commit and
every validated-file/record/gate-output **SHA-256**, confirms each path stays **inside the project
root**, cross-checks the validator_type ↔ MCP tool and the record's exact ids/status/input-hash,
and **rejects an unbacked claim** — developer prose is never self-certifying; work only reaches QA
on a passing evidence gate (overall VALID + every validation VALID + all four gates pass, public
distribution only). **Honest scope:** the artifact is a *consistency-checked validation record*,
**not** an authenticated capture of a live MCP call — that a live Claude Code `shopify-developer`
subagent actually reached the MCP is proven only by the mandatory interactive cold-session test. Only the full **Shopify
AI Toolkit** plugin was avoided; just the MCP server is integrated.

> **Scope (unchanged in this patch).** This plugin delivers the **public App Store app**
> only — `project.json` pins `distribution: public`. The Dev MCP works for custom apps too,
> but the developer's preflight determines distribution type and **stops** on a custom or
> extension-only project (custom apps can't even use the Billing API) rather than misapply
> public rules. Custom-app delivery is **not** implemented here; see "Findings" in
> `RELEASE-EVIDENCE.md`.

## Stack (verified against live Shopify docs 2026-08-17)

- **Framework:** React Router 7 + `@shopify/shopify-app-react-router` (Remix template deprecated).
- **UI:** Polaris **web components** (CDN) + latest **App Bridge in `<head>`**; nav uses `<s-app-nav>`/`<s-link>` (not Polaris React, not `<NavMenu>`).
- **Auth:** token exchange + managed installation (no OAuth redirect). Route-auth is an explicit matrix (session token / HMAC / app-proxy signature+CORS / static health).
- **Admin API:** GraphQL pinned to **`ApiVersion.July26` (2026-07)** — explicit, reproducible; quarterly review for upgrades. REST prohibited.
- **DB:** PostgreSQL + Sequelize; sessions via `@shopify/shopify-app-session-storage-postgresql` (a documented, supported deviation from the template's default Prisma).
- **Billing:** Shopify **App Pricing** via the App Events API (client-credentials auth; permanent billing-event idempotency; **aggregate/`chargeId`-only** reconciliation; billing-validation failures are **dashboard-only**).
- **Compliance:** mandatory privacy webhooks that acknowledge 2xx fast, verify HMAC (401 on bad), actually delete data, and respect the 30-day / 48-hour windows.

## Quality gates

`Grooming(G0.5) → G0 → G1 → [G1.5] → G-Schema → G2 → G3 → G4×n → G5 → [G-PCD] → G5.5 → G-Review → G6(submit) → M6`

Two **external** Shopify gates (G-PCD protected-data, G6 App Store review) + one **blocking internal** gate (G-Review, mandatory App Store baseline). **Built for Shopify** is a **separate, post-launch** eligibility gate (needs ≥50 installs + ≥5 reviews — cannot be met pre-submission); its *technical* best-practices are still implemented pre-launch.

## Install & start (verified command)

**Verified in this build (offline, real CLI):**
```bash
claude plugin validate ./webdesk-shopify-apps --strict     # → ✔ Validation passed
python3 ./webdesk-shopify-apps/tools/scripts/validate-plugin.py ./webdesk-shopify-apps   # → OK: zero errors
```

**Activate the orchestrator (documented; run in your Claude Code environment).**
There are two distinct modes, and they are **not** equivalent:

- **Main session agent** — `settings.json` default (`{"agent": "orchestrator"}`, shipped) or `claude --agent webdesk-shopify-apps:orchestrator`. **Only in this mode** does Claude Code platform-enforce the orchestrator's `Agent(...)` sub-agent allowlist. Use this for real project work.
- **Subagent for a one-off task** — `@`-mention typeahead (`@` → `webdesk-shopify-apps:orchestrator`) or `@agent-webdesk-shopify-apps:orchestrator`. This runs the orchestrator *below* the main thread; per the sub-agents docs the type list inside `Agent(...)` is **ignored** at that depth, so the nested-agent restriction is **not** platform-enforced here.

The slash `/…` form is for *skills*, not agents.
```bash
# MAIN-agent activation (platform-enforced allowlist):
claude --plugin-dir /path/to/webdesk-shopify-apps --agent webdesk-shopify-apps:orchestrator
#   ...or just enable the plugin — settings.json makes it the default main agent.
# SUBAGENT invocation for a single task (allowlist NOT platform-enforced):
#   • typeahead: type "@", then pick  webdesk-shopify-apps:orchestrator
#   • manual:    @agent-webdesk-shopify-apps:orchestrator  <task>
# discover components:
/context                                     # lists loaded agents + skills
claude plugin details webdesk-shopify-apps   # component inventory (needs the plugin INSTALLED; takes a name, not --plugin-dir)
# scaffold a project workspace:
bash /path/to/webdesk-shopify-apps/tools/scripts/init-project.sh \
     --client rossy-ai --type app-build --api-version 2026-07 \
     --data-ownership shared-saas --hosting long-running --protected-scopes
```

**Pilot install scope (important — this plugin ships a default `agent`).** A default
**user-scope** install (`claude plugin install …`, no `--scope`) enables the Shopify
orchestrator as the default main agent in **every** project where the plugin is enabled
— not what you want for a scoped pilot. For the Rossy pilot, install from **inside the
Rossy Shopify app repo** with a project-bounded scope:

```bash
# from the Rossy app repository:
claude plugin install webdesk-shopify-apps@<marketplace> --scope local     # not shared with the team
#   or, to record it for everyone who clones the repo:
claude plugin install webdesk-shopify-apps@<marketplace> --scope project    # writes enabledPlugins to .claude/settings.json
```

Tear down with the **same qualified name + scope**
(`claude plugin uninstall webdesk-shopify-apps@<marketplace> --scope local`). Full steps
in `INSTALL.md`.

## Layout (Claude Code plugin structure)

```
webdesk-shopify-apps/
├── .claude-plugin/plugin.json      # manifest (validated)
├── .mcp.json                       # bundled Shopify Dev MCP (pinned @shopify/dev-mcp)
├── agents/                         # 8 sub-agents (orchestrator + 7 specialists; MCP → shopify-developer only)
├── skills/                         # 11 skills (shopify knowledge + delivery flow)
├── tools/
│   ├── scripts/                    # init-project.sh, validate-plugin.py, check-env.sh,
│   │                               #   mcp-selfcheck.mjs, check-dev-handoff.py
│   └── schemas/project-json.schema.json
├── tests/                          # run-acceptance.sh + external-env test plans
├── .github/workflows/              # plugin-validate + app CI/deploy templates
├── README.md · CHANGELOG.md · INSTALL.md · RELEASE-EVIDENCE.md
```

Full unedited validation, acceptance, and negative-test output for this release is in
`RELEASE-EVIDENCE.md`.

## Validate & test

```bash
python3 tools/scripts/validate-plugin.py .   # real YAML + refs + Agent(...) allowlist + dir refs
claude plugin validate . --strict            # manifest (Claude CLI)
bash tests/run-acceptance.sh                 # 17 mandatory checks incl. CLI inventory, preload tokens, Dev MCP, scoped-agent allowlist (+2 external, NOT run)
```

## Status

v0.1.8-beta.5 — final local-evidence patch (three blockers on beta.4; **no** Shopify rules,
public-only scope, workflow, agents, permissions, MCP pin `1.14.5`, session storage, caching,
billing, preload tokens, or custom-app architecture changed). Every beta.2/beta.3/beta.4 regression
preserved. **(B10)** the record had two status sources (`event.status` + a free `result` string) that
could disagree; the record now carries a single authoritative **`result` object `{status, summary,
errors}`** — evidence `status` must equal `result.status` exactly, a VALID result must have no
blocking errors, and a `summary` declaring a contradicting status is rejected. **(B11)** gate trust
no longer rests on a bare no-op filter: each gate must run its **exact** required script
(`npm run lint`/`typecheck`/`test`/`build` — no `bash -c`, `echo`, operators, or wrong-gate/alternative
commands), and the captured log's `__GATE_EXIT__` marker (written by the bundled **`run-gates.py`**,
which executes with `shell=False`) must match the recorded exit code; reused output files are
rejected. **(B12)** the evidence is now bound to the repo's **`project.json`**: it is schema-validated
and the evidence `distribution_type` + `api_version` must equal `project.shopify.{distribution,
api_version}`; graphql records must carry the Dev MCP conversationId + api surface, bound to the
evidence. Acceptance **T15 runs 52 evidence cases**. This remains **consistency-checked local
evidence**, never authenticated execution. **Next action is to run the real local cold-session tests**
(the four NOT-EXECUTED items), not to add another evidence layer.

<details><summary>v0.1.8-beta.4 — evidence-checker patch (three blockers on beta.3)</summary>

No Shopify rules, public-only
scope, workflow, agents, permissions, `@shopify/dev-mcp@1.14.5`, caching, session storage, billing,
preload tokens, or custom-app scope changed). All six beta.3 fixes preserved. **(B7)** the checker
parsed validation status by *substring*, so a transcript reading `Overall Status: INVALID` passed as
VALID ("VALID" ⊂ "INVALID"). Status is now an **exact enum field** in a structured record — never
inferred from a substring. **(B8)** gate `output_sha256` was never verified; `output_ref` is now
**mandatory**, must resolve inside `${CLAUDE_PROJECT_DIR}`, and its SHA-256 is recomputed and matched
(blank/no-op commands and pass-with-nonzero-exit are rejected). **(B9)** arbitrary free text with four
tokens was accepted and the checker even printed "authenticated transcripts." Free text is gone: each
validation references a **structured validation record** (`mcp-validation-record.schema.json`) whose
single `event` object is bound to the evidence by **exact** tool-call id, scoped tool, validator type
and status, with the validator input matched to the actual file content **by SHA-256** (never by a
filename in text); duplicate tool-call ids are rejected. Every "authenticated" claim is removed — this
is a **consistency-checked validation record**, and real runtime provenance remains the mandatory
cold-session test. Acceptance **T15 now runs 45 evidence cases** (regressions for every beta.2/beta.3
blocker + the new B7/B8/B9 negatives + a positive). The four NOT-EXECUTED disclosures remain mandatory
before pilot.

</details>

<details><summary>v0.1.8-beta.3 — MCP-gate enforcement patch (six blockers on beta.2)</summary>

No Shopify policies, gates,
public-only scope, cache, agents, permissions, session storage, preload tokens, billing, custom-app
architecture, or the pinned `@shopify/dev-mcp@1.14.5` changed). Each blocker was reproduced with a
failing test before the fix and is now covered by a negative test: **(B1)** the orchestrator invokes
the checker via `${CLAUDE_PLUGIN_ROOT}/…` with `--root ${CLAUDE_PROJECT_DIR}` (a bare project-relative
path is rejected by the validator); **(B2)** the checker **fails closed** — exit 0 only for public +
overall VALID + ≥1 validation all VALID + all four gates `pass`; `INVALID`→1, any gate `fail`/`skip`→1,
`BLOCKED`→3, and custom/extension-only may only be BLOCKED, never accepted; **(B3)** validator_type ↔
MCP tool is cross-checked (graphql/polaris-component/theme), and `learn_shopify_api`/`search_docs_chunks`
are rejected as validators; **(B4)** MCP-Evidence, validated-file, and transcript paths must be relative
and resolve **inside** `${CLAUDE_PROJECT_DIR}` (absolute/`..`/symlink-escape/missing rejected); **(B5)**
`output.text` alone is no longer accepted — a captured transcript ref + SHA-256 is required and the
transcript is cross-checked for the scoped tool name, tool-call id, input and status; local gates carry
command + exit_code + output hash; and the artifact is described as *consistency-checked*, not
authenticated runtime proof; **(B6)** the doc guard now rejects the affirmative false claim
"validate_theme … validates extension configuration …" without treating "theme"/"Liquid" as
negations. Acceptance is **16 mandatory checks** (T15 runs **29** evidence cases; T16 covers the path
and wording negatives). The four NOT-EXECUTED disclosures (real developer-subagent MCP call, QA
MCP-denial, interactive cold session, live dev-store smoke) remain **mandatory before pilot**.

</details>

<details><summary>v0.1.8-beta.2 — MCP enforcement hardened</summary>

Narrow patch on beta.1; no policies/gates/scope/cache/
tokens/schema/session-storage/pinned-version changed). Three things: (1) the developer's MCP
handoff must reference a **structured evidence artifact** (`tools/schemas/mcp-validation-evidence.schema.json`)
— `check-dev-handoff.py` is rewritten to schema-validate it, match the reviewed **commit SHA** and
every validated-file **SHA-256**, require the fully-scoped tool name and real validator output, and
reject bare claims, contradictions (BLOCKED+VALID, NOT-EXECUTED+PASSED, INVALID+approved), and any
missing lint/typecheck/tests/build result; the **orchestrator runs this gate** before QA and QA must
read/verify the artifact (validator + acceptance enforce the wiring). (2) extension wording corrected
— `validate_theme` is **Liquid/theme only**, the Dev MCP has **no** extension-config validator (a doc
guard rejects overstatement); extension-only projects stay out of scope. (3) real **developer-subagent
MCP runtime** proof and the **QA MCP-denial** test are added to the cold-session plan as mandatory —
but marked **NOT EXECUTED** here because the build sandbox has no logged-in, model-backed session
(`claude -p` → "Not logged in"); a direct `mcp-selfcheck.mjs` is explicitly **not** accepted as that
proof. Acceptance is **16 mandatory checks** (added the 16-case evidence gate + workflow-wiring
guards). The two external-environment tests remain **NOT EXECUTED**.

</details>

<details><summary>v0.1.8-beta.1 — Shopify Dev MCP integrated as a developer validation tool</summary>

`.mcp.json` bundles
`@shopify/dev-mcp` at an **exact pinned version** (no `@latest`); the server is granted **only**
to `shopify-developer` via `mcp__plugin_webdesk-shopify-apps_shopify-dev-mcp__*`, and
`validate-plugin.py` + acceptance reject any other agent holding MCP tools, an unpinned version,
`mcpServers:` in an agent, or a mis-scoped tool name. The developer gains a Shopify preflight
(determine distribution type → confirm schemas/components via MCP → after coding, run the MCP
validators plus lint/typecheck/tests/build → structured handoff), and a handoff that *claims*
Shopify validation without MCP evidence is rejected. Acceptance grows to **16 mandatory checks**
including a live MCP self-check (bad GraphQL → INVALID, good → VALID; no store, no auth). This is
a **beta** release candidate: the public-App-Store workflow, gates, policies, preload tokens, and
QA/Code-Review permissions are unchanged; **custom-app delivery remains out of scope** (documented
finding). The two external-environment tests (`tests/*.md`) remain **NOT EXECUTED**.

</details>

<details><summary>v0.1.7 — preload markers made visible + self-authorizing</summary>

Each skill's `WSA-PRELOAD-<skill>-<hex>`
token now sits in a **visible** Markdown line (not an HTML comment) that explicitly authorizes
the agent to return it during the cold test, removing the earlier "do not print" wording that a
well-preloaded agent might have obeyed and false-failed on. `validate-plugin.py` + acceptance
**T11** now also enforce that the marker is **visible** (survives HTML-comment stripping) and
that the token's embedded skill name **matches its directory**, on top of the v0.1.6 one-per-skill
/ unique / no-leak checks. The cold-session probe now requires a **fresh agent invocation per
(agent, skill) pair** (no resumed conversation, one question each) and keeps the zero-tool-call
pass rule. Token values are still never printed in docs or evidence. No Shopify application
rules, agents, permissions, gates, or workflow changed. The two external-environment tests
(`tests/*.md`) remain **NOT EXECUTED**.

</details>

<details><summary>v0.1.6 — preload proof hardened + evidence integrity</summary>

Each skill carries one **opaque, high-entropy preload token** (`WSA-PRELOAD-<skill>-<hex>`)
placed once in its `SKILL.md` and nowhere else; `validate-plugin.py`/**T11** enforce
one-per-skill, all-unique, no-leak; the cold probe asks for the token, passing only with no
`Read`/`Grep`/`Glob`/`Bash`/`Skill` lookup. `RELEASE-EVIDENCE.md` isolation proof relies on the
documented `CLAUDE_CONFIG_DIR` + disposable working dir + explicit runtime assertions (the
earlier before/after line-count claim was removed).

</details>

<details><summary>v0.1.5 — enforcement scope stated precisely + tests isolated</summary>

The `Agent(...)` allowlist
is platform-enforced **only when the orchestrator is the main agent** (settings default
or `--agent`); as a subagent the parenthesized list is ignored, so the docs no longer
claim `@`-mention gives the same guarantee. **T10 runs entirely under a throwaway
`CLAUDE_CONFIG_DIR`** (the operator's real `~/.claude` is never touched) and installs the
**exact, unfiltered package** — no pre-clean — so a stray component fails the test
instead of being masked. QA/Code-Review tools must be **exactly** `Read, Grep, Glob`
(Bash/Agent/Write/Edit rejected). QA now requires **evidence provenance** (commit SHA,
CI run ID/executor, timestamp, environment, artifact source, store/build id) and marks
evidence **BLOCKED** on a commit mismatch; QA proposes audit-log entries rather than
"logging" them (it has no write tools). Pilot install scope documented (`--scope
local`/`project` from the Rossy repo). Cold-session plan upgraded to **per-skill canary
probes** and remains **NOT EXECUTED**. Full unedited negative-test + acceptance evidence
ships in `RELEASE-EVIDENCE.md`. The two external-environment tests (`tests/*.md`) run in
your Shopify + Claude Code environment.

</details>
