# Changelog — webdesk-shopify-apps

## v0.1.8-beta.6 (2026-08-24) — subagent-registration runtime defect fixed (one blocker on beta.5)

Minimal runtime-registration patch on the **corrected** beta.5 package. **No Shopify rules, gates,
permissions, skills, workflow content, public-only distribution scope, `@shopify/dev-mcp@1.14.5`
pin, session-storage decisions, or QA/code-review read-only permissions changed.** Reproduced first,
fixed second: the exact beta.5 failure was reproduced against the installed Claude Code 2.1.241 build
before any file was touched.

**The blocker — orchestrator delegation to all seven specialists failed at runtime.** `claude plugin
details` showed a healthy 8-agent/11-skill install, but any delegation attempt returned `Agent type
'shopify-developer' not found. Available agents: none` (same for `pm`). Root cause: a plugin agent
registers as an invocable **sub-agent type**, for `Agent(...)` delegation-lookup purposes, only under
its fully **plugin-scoped** identifier `webdesk-shopify-apps:<name>` — the bare name resolves only
when launching that agent directly as a session's *main* agent, never as a delegation target. The
beta.1–beta.5 orchestrator allowlist used the bare form; it passed `validate-plugin.py` and `claude
plugin validate --strict`, and looked correct in `claude plugin details`, but failed on every real
delegation. This is not stated explicitly either way in the official Claude Code docs — confirmed
empirically against the installed build.

**Fix.** `agents/orchestrator.md`'s `tools:` allowlist now names all seven specialists by their scoped
identifier: `Agent(webdesk-shopify-apps:pm, webdesk-shopify-apps:architect, webdesk-shopify-apps:designer,
webdesk-shopify-apps:shopify-developer, webdesk-shopify-apps:qa, webdesk-shopify-apps:code-review,
webdesk-shopify-apps:delivery-head)`. `validate-plugin.py` now requires exactly this scoped form —
rejecting a bare `Agent`, any bare/unscoped specialist name (the beta.5 regression shape), a
wrong-plugin-scoped entry, and a missing/extra specialist — while still confirming every scoped id
maps to a real `agents/<name>.md`. `tests/run-acceptance.sh` T4 updated; new **T17** adds a positive
case (shipped allowlist validates clean) plus the 5 negative mutations above. Read/Grep/Glob/Bash and
every agent's role, `skills:`, and tool grants are otherwise unchanged.

**Also fixed while re-running the full suite (pre-existing, unrelated to the delegation defect):**
`tools/scripts/mcp-selfcheck.mjs` couldn't spawn `npx` on Windows (`spawn npx ENOENT` — Node needs
`shell: true` to resolve `npx.cmd` via PATH on `win32`); `tests/mcp-evidence-cases.py`'s symlink-escape
case now skips cleanly instead of crashing the whole suite on a host that can't create the fixture
(no `/etc/hostname`, or unprivileged `os.symlink` blocked — stock Windows); `validate-plugin.py`'s
error-message-only `os.path.relpath()` calls no longer crash when the plugin root and the invoking
cwd sit on different Windows drive letters (display text only — no validation-logic change).

**New:** a Windows PowerShell 5.1 BOM-free `marketplace.json` write recipe in `INSTALL.md`
(`[System.IO.File]::WriteAllText(path, json, [System.Text.UTF8Encoding]::new($false))`), addressing a
runbook defect reported alongside the beta.5 test (`Set-Content -Encoding utf8` on PowerShell 5.1
prepends a BOM that `claude plugin marketplace add` rejects). A separate Shopify Partner-Dashboard
`[events]`-block finding (DEV-001, unrelated to this plugin) is documented in
`tests/shopify-dev-store-smoke.md` with the disposable-dev-store-only workaround.

**Authenticated runtime tests — executed and PASS (see `RELEASE-EVIDENCE.md` §5 for full evidence):**
orchestrator delegates to `shopify-developer`, which calls `learn_shopify_api` +
`validate_graphql_codeblocks` and correctly reports the deliberately-invalid query INVALID, with both
MCP calls attributed to the developer subagent in the debug log (real `toolu_…` ids captured); QA,
asked to use the Dev MCP, makes **zero** `mcp__` tool calls and remains exactly `[Read, Grep, Glob]`;
and the full preload/discovery cold-session probe (`tests/cold-plugin-discovery.md` §6, all 26
(agent, declared-skill) pairs across all 8 agents) — **26/26 PASS**, exact token match with zero
tool-lookup attempts, confirmed via the debug log's `Preloaded skill` marker at subagent-spawn time.
No MCP-inheritance/runtime blocker was found — the developer subagent received full MCP access on
the first delegation.

Acceptance: **`PASSED=17  FAILED=0  SKIPPED=2`** → `ACCEPTANCE OK`. `claude plugin validate --strict`
→ `✔ Validation passed`. `validate-plugin.py` → `OK: zero errors`.

**Still NOT EXECUTED (unchanged from beta.5):** the live Shopify dev-store smoke test — requires a
real disposable Partner dev store this environment does not have. This is now the only one of the
four beta.5 gating tests still outstanding.

## v0.1.8-beta.5 (2026-08-21) — final local-evidence patch (three blockers on beta.4)

The last narrow local-evidence patch before the authenticated cold-session tests. **No Shopify rules,
public-only scope, workflow stages, agents, permissions, `@shopify/dev-mcp@1.14.5`, session storage,
caching, billing, preload tokens, or custom-app architecture changed.** Every beta.2/beta.3/beta.4
regression preserved. Each blocker was reproduced with a failing test on beta.4 first.

**B10 — structured result could contradict structured status.** The record had two status sources
(`event.status` and a free-text `event.result`). It is replaced by a single authoritative
`event.result` object `{status, summary, errors}`. `result.status` is the only status; evidence
`validation.status` must equal it exactly; overall VALID requires every `result.status == VALID`; a
VALID result must have an **empty `errors`** array; a `summary` that declares a contradicting explicit
status is rejected; and an arbitrary result string is rejected by the schema. Negatives: result INVALID
/ BLOCKED vs evidence VALID, summary contradiction, non-empty errors with VALID, missing status,
arbitrary string, overall VALID with a non-VALID validation — all exit 1.

**B11 — mandatory gate command + output are now bound.** Each gate must run its **exact** required
package script (`lint→npm run lint`, `typecheck→npm run typecheck`, `tests→npm test`,
`build→npm run build`); shell wrappers (`bash -c`), no-ops (`true`/`echo`/`printf`/`exit 0`), operators
(`&&`/`||`/`;`/pipes), wrong-gate assignments, and alternatives are rejected. A **bundled deterministic
runner `tools/scripts/run-gates.py`** executes the four commands with argument arrays + `shell=False`,
captures stdout/stderr, records the real exit code, writes each log with a `__GATE_EXIT__:<code>`
marker + a structured manifest, and produces the hashes the checker consumes. The checker binds the
captured log's `__GATE_EXIT__` to the recorded exit code, rejects reused output files, and re-hashes
the output. Honest limitation kept: consistency-checked local evidence, not cryptographically
authenticated execution. Negatives: `bash -c true`, `echo passed`, lint using the build command, an
appended shell operator, log/exit mismatch, pass with a failing run, missing/hash-mismatched output,
reused output — all exit 1.

**B12 — evidence bound to project.json.** For an accepted public handoff the checker requires
`${CLAUDE_PROJECT_DIR}/project.json`, schema-validates it with the plugin's project schema, and
requires evidence `distribution_type` == `project.shopify.distribution` and evidence `api_version` ==
`project.shopify.api_version`; missing/malformed/mismatched project context is rejected, and
custom/extension-only remains out-of-scope BLOCKED. GraphQL records must carry the Dev MCP
`conversation_id` + Admin `api` surface, bound exactly to the evidence. Negatives: api-version differs,
distribution/project mismatch, missing project.json, malformed project.json, graphql record missing
conversation_id, conversation_id mismatch — all exit 1; plus a matching-project positive.

**Cleanup.** `check-dev-handoff.py` header updated to beta.5; stale free-text "transcript" wording
removed (replaced by the structured record); "authenticated" is never used for local evidence;
`${CLAUDE_PLUGIN_ROOT}`/`${CLAUDE_PROJECT_DIR}` execution paths preserved. Acceptance T15 =
**52 cases**. Result: `PASSED=16 FAILED=0 SKIPPED=2`.

**Next action (not another evidence layer):** run the four local cold-session tests — real
shopify-developer MCP invocation, QA MCP-denial, preload/discovery cold session, live disposable
dev-store smoke — which remain **NOT EXECUTED** and mandatory.

## v0.1.8-beta.4 (2026-08-21) — evidence-checker patch (three blockers on beta.3)

Narrow patch. **No Shopify rules, public-App-Store-only scope, workflow, agents, permissions,
`@shopify/dev-mcp@1.14.5`, caching decisions, session storage, billing, preload tokens, or custom-app
scope changed.** All six beta.3 fixes preserved with regression tests. Each blocker was reproduced
with a failing test on beta.3 before the fix. `PASSED=16 FAILED=0 SKIPPED=2`; the four external tests
remain **NOT EXECUTED**.

**B7 — INVALID transcript passed as VALID.** The checker verified the status by substring
(`if token not in tcontent`), so a transcript reading `Overall Status: INVALID` satisfied "VALID"
(which is a substring of "INVALID"). Status is now an **exact enum field** carried by a structured
record and compared with `==`; a VALID validation requires the record's `event.status == "VALID"`
exactly. Negative tests: record INVALID / BLOCKED / `NOT VALID` (bad enum) / "VALID" only in
commentary / missing status — all exit 1.

**B8 — local-gate output hashes were never verified.** `output_ref` is now **mandatory** for lint,
typecheck, tests and build; it must be a relative path resolving (realpath, symlinks followed) inside
`${CLAUDE_PROJECT_DIR}`, and the checker recomputes the file's SHA-256 and matches `output_sha256`. A
gate passes only when `status=pass`, `exit_code=0`, the output file exists and its hash matches; blank
or no-op commands (`true`/`false`/`:`) are rejected; `fail`/`skip` remain non-proceeding. Negative
tests: no `output_ref`, arbitrary hash, hash mismatch, missing file, absolute path, `..` traversal,
symlink escape, pass-with-nonzero-exit, fail-with-zero-exit — all exit 1.

**B9 — arbitrary text was accepted as an "authenticated transcript."** Free text is removed. Each
validation now references a **structured validation record** (new
`tools/schemas/mcp-validation-record.schema.json`) referenced by SHA-256 and schema-validated. Its
single `event` object is bound to the evidence by an **exact** match of tool-call id, scoped tool,
validator type and status; the validator **input is matched to the actual validated file content by
SHA-256** (`validated_input_sha256`), never by a filename appearing in text; duplicate/reused
tool-call ids across validations are rejected. **Every "authenticated transcript" claim is removed**
from the checker output, schema, agents and docs — the artifact is a **consistency-checked validation
record**, and genuine Claude Code runtime provenance stays proven only by the mandatory interactive
cold-session test. No stream-json format is invented. Negative tests: plain text with all tokens,
tool-id/result from different events, correct tool but wrong input hash, filename present but content
not validated, record INVALID vs evidence VALID, duplicate tool-call id, malformed record — all exit
1; plus a positive test in the exact structured format.

Updated: `check-dev-handoff.py`, `tools/schemas/mcp-validation-evidence.schema.json` (gate `output_ref`
mandatory; validation `output`→`record`), new `tools/schemas/mcp-validation-record.schema.json`,
`tests/mcp-evidence-cases.py` (**45** cases), acceptance T15/T16, orchestrator/developer/QA wording,
`validate-plugin.py` (requires the record schema), README/CHANGELOG/DECISIONS/RELEASE-EVIDENCE.

## v0.1.8-beta.3 (2026-08-21) — MCP-gate enforcement patch (six blockers on beta.2)

Narrow enforcement patch. **No Shopify policies, public-App-Store-only scope, agents, agent
permissions, workflow gates, session storage, caching decisions, preload tokens, billing rules,
custom-app architecture, or the pinned `@shopify/dev-mcp@1.14.5` changed.** Every blocker was
**reproduced with a failing test before the fix**, and each fix ships with a negative test.
`PASSED=16 FAILED=0 SKIPPED=2`. External tests remain **NOT EXECUTED**.

1. **B1 — installed-plugin script path.** The orchestrator now invokes the checker as
   `python3 "${CLAUDE_PLUGIN_ROOT}/tools/scripts/check-dev-handoff.py" <handoff> --commit <sha>
   --root "${CLAUDE_PROJECT_DIR}"` (the script ships inside the installed plugin, not the app
   repo). `validate-plugin.py` rejects a bare project-relative `tools/scripts/check-dev-handoff.py`,
   a missing `${CLAUDE_PLUGIN_ROOT}` reference, and a `--root` that is not `${CLAUDE_PROJECT_DIR}`.
2. **B2 — the checker now fails closed.** Exit **0 only when** distribution is public, overall
   status is VALID, at least one validation exists and every validation is VALID, and lint/
   typecheck/tests/build are all `pass`. Overall `INVALID` → exit 1; any gate `fail`/`skip` → exit 1;
   overall `BLOCKED` → exit 3; a `custom`/`extension-only` project may only be an out-of-scope
   `BLOCKED` (exit 3), never accepted. (Previously a coherent `INVALID` returned exit 0.) QA must
   explicitly BLOCK any overall INVALID/BLOCKED evidence or any non-VALID individual validation.
3. **B3 — validator_type ↔ MCP tool cross-check.** `graphql`→`validate_graphql_codeblocks`,
   `polaris-component`→`validate_component_codeblocks`, `theme`→`validate_theme`; every mismatch is
   rejected, and `learn_shopify_api`/`search_docs_chunks` are rejected as validators (they are
   supporting calls).
4. **B4 — evidence-path containment.** The `MCP-Evidence` path, every `validated_files[].path`, and
   every `transcript_ref` must be **relative** and resolve (realpath, symlinks followed) **inside**
   `${CLAUDE_PROJECT_DIR}`; absolute paths, `..` traversal, symlink escapes, and missing files are
   rejected.
5. **B5 — developer text is not proof.** The evidence schema no longer accepts `output.text` alone —
   a captured **transcript reference + SHA-256** is required; the checker verifies the transcript
   hash and cross-checks that the transcript contains the scoped tool name, the tool-call event id,
   the validated input, and the status, all inside the project root. Local gates now carry
   `command`, `exit_code`, and an output hash — a typed `"status":"pass"` alone is not execution
   proof. The artifact is explicitly documented as **consistency-checked** evidence; genuine
   Claude Code runtime provenance is **not** cryptographically authenticated and remains proven only
   by the mandatory interactive cold-session test. No cryptographic guarantee is invented.
6. **B6 — extension-validation wording.** Broad phrasings like "GraphQL / Polaris / Liquid /
   extensions with the Dev MCP" are corrected to "GraphQL, Polaris, and Liquid/theme portions of a
   public app or public-app extension"; extension TOML, targets, build configuration, and runtime
   behaviour remain Shopify CLI/build/dev-store responsibilities. The doc guard was rebuilt so it
   rejects the exact false statement "The validate_theme tool validates extension configuration and
   theme code." — the words "theme"/"Liquid" are no longer treated as negations.

**Required acceptance cases** (all proven; `tests/mcp-evidence-cases.py` = **29** cases + T16
validator negatives): overall INVALID; each gate = skip; a gate = fail; custom + VALID;
extension-only + VALID; each validator/tool mismatch; `output.text`-only; fabricated/mismatched
transcript; absolute + `..` + symlink + absolute-evidence paths; bare-`${CLAUDE_PLUGIN_ROOT}`
checker command; `--root` not `${CLAUDE_PROJECT_DIR}`; overstated validate_theme/extension wording;
plus the schema-valid positive. **NOT EXECUTED (mandatory before pilot):** real shopify-developer
MCP invocation, QA MCP-denial runtime test, interactive cold session, live dev-store smoke.

## v0.1.8-beta.2 (2026-08-21) — MCP enforcement patch (three blockers on beta.1)

Narrow enforcement patch. **No Shopify policies, gates, public-app-only scope, cache decisions,
agent responsibilities, preload tokens, session storage, project schema, workflow stages, or the
pinned `@shopify/dev-mcp@1.14.5` were changed.** 8 agents / 11 skills preserved; QA and Code Review
remain exactly `[Read, Grep, Glob]`; MCP access remains `shopify-developer`-only. Verified against
official Shopify + Claude Code docs. External tests remain **NOT EXECUTED** (not fabricated).

**Blocker 1 — real developer-agent MCP access is honestly scoped, not overclaimed.** T13
(`mcp-selfcheck.mjs`) proves the MCP *process* works but **bypasses** Claude Code plugin loading,
tool namespacing, subagent tool inheritance, the developer's `tools:` allowlist, and actual
developer-agent invocation — so it is **not** proof of developer-agent access. A real model-backed
subagent turn **cannot** run in the build sandbox (`claude -p` → "Not logged in"), so the required
runtime tests are **NOT EXECUTED** and added to `tests/cold-plugin-discovery.md` (§9) as
**mandatory before pilot**: (9.1) install the exact package in an isolated `CLAUDE_CONFIG_DIR`,
orchestrator-as-main delegates a validation-only task to `shopify-developer` using the new fixture
`tests/fixtures/public-app-min/project.json` (`distribution: public`, `2026-07`), the developer
calls `…__learn_shopify_api` + `…__validate_graphql_codeblocks` on an invalid query, and the
**transcript** must show those scoped tool calls resolving *through the developer subagent* with the
query reported INVALID; (9.2) QA, asked to use the MCP, can call **no** `mcp__` tool. The docs no
longer claim developer runtime access was proven.

**Blocker 2 — the weak handoff check is replaced by a schema-driven, workflow-wired gate.**
Added `tools/schemas/mcp-validation-evidence.schema.json` (schema version, distribution, API
version, commit SHA, UTC timestamp, executor/session id, fully-scoped MCP tool name, tool-call
event id, MCP conversationId, validator type, validated files **with SHA-256**, status, raw output
or a hashed transcript reference, the four local-gate results, warnings, live-store items).
`check-dev-handoff.py` is rewritten to load and **schema-validate** the referenced artifact, match
the reviewed **commit SHA**, recompute and match every validated-file **SHA-256**, require the
scoped tool name and real output, and **reject**: a bare tool-name claim, a typed "Validation
Summary" with no structured evidence, missing evidence, schema failures, mis-scoped names, commit
mismatch / reused-earlier-commit, file-hash mismatch, `BLOCKED`+`VALID`, `NOT EXECUTED`+`PASSED`,
`INVALID`+approved, and any missing lint/typecheck/tests/build result. An honest
`BLOCKED: SHOPIFY MCP VALIDATION NOT EXECUTED` is accepted **only as blocked** (exit 3) — never as
permission to proceed. The gate is wired into the **real workflow**: the **orchestrator** runs it
after `shopify-developer` and does not route to Code Review/QA on nonzero; **QA** must read and
verify the evidence artifact (commit + provenance) and returns `BLOCKED` on missing/stale/
contradictory/mismatched evidence, never trusting the developer's word. `validate-plugin.py`
now requires the schema to exist, the orchestrator to reference the checker, and QA to require the
artifact. Acceptance adds **16 evidence cases** (`tests/mcp-evidence-cases.py`) and **workflow-wiring
negatives** (unwired orchestrator, unrequired-QA-evidence, QA+MCP/Bash). QA is **not** given Bash.

**Blocker 3 — extension-validation wording corrected.** `validate_theme` is described as
**Liquid/theme only**; `validate_graphql_codeblocks` = GraphQL, `validate_component_codeblocks` =
Polaris web components. The Dev MCP has **no dedicated extension-configuration validator** —
extension TOML, targets, API-version compatibility, build config, and runtime behaviour must use
the Shopify CLI/build process and disposable dev-store testing. Extension-only projects stay
distribution-out-of-scope; a public app *containing* an extension may use MCP for its GraphQL/
component/theme portions only. A `validate-plugin.py` **doc guard** rejects documentation that
overstates `validate_theme` beyond its Liquid/theme scope. It must never be presented as
validating extension configuration.

**Acceptance (this build):** `PASSED=16  FAILED=0  SKIPPED=2` → `ACCEPTANCE OK`.

## v0.1.8-beta.1 (2026-08-18) — Shopify Dev MCP as a developer validation tool

Controlled patch. **No Shopify policies, gates, agent responsibilities, preload tokens, project
workflow, session-storage decisions, or distribution rules changed** beyond the new MCP access for
`shopify-developer`. Verified against official Shopify + Claude Code docs and the npm registry; full
unedited evidence in `RELEASE-EVIDENCE.md`. External tests remain **NOT EXECUTED**.

1. **Bundled the Shopify Dev MCP server (only the server, not the AI Toolkit plugin).** Added a
   plugin-root `.mcp.json` declaring `shopify-dev-mcp = npx -y @shopify/dev-mcp@1.14.5` — an **exact
   pinned** version (current `latest` at build time; `@latest`/ranges are rejected for
   reproducibility). The server runs locally, needs **no credentials, and never connects to a
   Shopify store**. Confirmed: `claude plugin details` lists it under `MCP servers (1)
   shopify-dev-mcp`; it exposes `learn_shopify_api`, `search_docs_chunks`,
   `validate_graphql_codeblocks`, `validate_component_codeblocks` (Polaris), `validate_theme` (Liquid).
2. **MCP access granted to `shopify-developer` ONLY.** Added the plugin-scoped tool
   `mcp__plugin_webdesk-shopify-apps_shopify-dev-mcp__*` to that agent's `tools:` (the scoped-name
   form verified verbatim against the Claude Code MCP docs). No `mcpServers:` was added to any agent
   frontmatter (Claude Code ignores it there). orchestrator/pm/architect/designer/qa/code-review/
   delivery-head get **no** MCP access; QA and Code Review remain exactly `[Read, Grep, Glob]`.
3. **Developer Shopify preflight.** `shopify-developer` now must: determine distribution type
   (public / custom / extension-only), identify the API surface + version, and confirm current
   schemas/components via the Dev MCP instead of memory before coding; after coding, run the MCP
   validators appropriate to the change **plus** the unchanged lint/typecheck/tests/build, and return
   a structured handoff (distribution type, API version, MCP tools used, files validated, validation
   result, build/test evidence, commit SHA, remaining warnings, live-store items). If required MCP
   validation can't run for GraphQL, Polaris, or Liquid/theme portions, it returns
   `BLOCKED: SHOPIFY MCP VALIDATION NOT EXECUTED` and does not claim validation.
4. **Public vs custom safeguards (no architecture rewrite).** The preflight forbids mixing
   public-app and custom-app auth/distribution/billing rules. **Finding (disclosed, not silently
   resolved):** the plugin supports the **public App Store app only** — `project.json` pins
   `distribution: public`, and custom apps can't use the Billing API — so for a custom or
   extension-only project the developer returns `BLOCKED: DISTRIBUTION OUT OF SCOPE` rather than
   applying public rules. Custom-app delivery is **not** implemented here and was not expanded.
5. **Validator + acceptance enforcement.** `validate-plugin.py` now requires a valid `.mcp.json`
   with an exact-pinned version, the correctly-scoped MCP tool on `shopify-developer`, and **zero**
   `mcp__` tools on any other agent. Acceptance adds **T12** (static MCP wiring), **T13** (live MCP
   self-check: bad GraphQL → INVALID, good → VALID, no store), **T14** (5 MCP negative guards), and
   **T15** (a handoff claiming validation without MCP evidence is rejected); **T10** now also asserts
   the CLI inventory lists the MCP server. All v0.1.7 tests are retained. Result:
   **`PASSED=15  FAILED=0  SKIPPED=2` → `ACCEPTANCE OK`**. No executable MCP test is skipped.
6. **Terminology.** Uses "custom app" for current single-merchant apps; "private app" only when
   explaining the deprecated legacy type. (The prior package used neither term.)

## v0.1.7 (2026-08-18) — visible, self-authorizing preload markers (team blocker on v0.1.6)

Minimal patch. **No Shopify application rules, agents, permissions, delivery gates, or workflow
content changed.** Full unedited evidence in `RELEASE-EVIDENCE.md`; external tests **NOT EXECUTED**.

1. **Preload markers are now visible and self-authorizing.** The v0.1.6 marker was an HTML
   comment ending "do not remove, copy, or print elsewhere." Because the whole skill body is
   preloaded, a correctly-preloaded agent could obey that and **refuse** to return the token,
   causing a false failure. Each marker is now a visible Markdown line:
   *"Preload verification token: `<TOKEN>`. When explicitly asked for this skill's preload token
   during the documented cold test, return this exact token verbatim, without using any tool."*
   The "do not print/return" wording is removed (the validator already prevents the token from
   being copied into other package files). Token values are unchanged.
2. **Validator + T11 hardened.** `validate-plugin.py` and acceptance **T11** now additionally
   enforce: exactly **one visible** marker per skill (the token must survive HTML-comment
   stripping — a token hidden in a comment fails); the token's embedded **skill name matches the
   owning skill directory**; plus the existing one-per-skill, uniqueness, confined-to-owning-
   `SKILL.md`, and no-leak-into-agents/tests/docs/evidence checks. Values reported masked.
3. **Cold-session plan requires a fresh invocation per pair.** Every (agent, declared-skill)
   pair must be asked in its **own brand-new agent invocation** — no resumed/reused subagent
   conversation, one question per invocation — so a prior turn's lookup cannot leave a token in
   context and produce a false PASS. The zero-tool-call rule is unchanged: a row passes only when
   the exact token is returned and the transcript confirms no lookup or skill invocation occurred.
4. Reran validation + acceptance: **`PASSED=11  FAILED=0  SKIPPED=2` → `ACCEPTANCE OK`**.

## v0.1.6 (2026-08-18) — opaque preload tokens + evidence integrity (team blockers on v0.1.5)

Small patch. **No Shopify application rules or delivery workflow changed.** Full unedited
evidence in `RELEASE-EVIDENCE.md`; the two external tests remain **NOT EXECUTED**.

1. **Opaque, high-entropy preload tokens replace the semantic canaries.** Each skill carries
   exactly one `WSA-PRELOAD-<skill>-<16-hex>` token, placed once in its `SKILL.md` and nowhere
   else in the package. The token is meaningless, so an agent can only produce it if that
   skill's body was injected into its context — closing the hole where a semantic canary
   (e.g. a webhook header) could be answered from the agent body or general knowledge.
2. **Token values are never printed** in `cold-plugin-discovery.md`, agent bodies, docs, or
   `RELEASE-EVIDENCE.md`. The cold plan asks each agent for its token per declared skill and
   the reviewer compares against the `SKILL.md` marker read at review time.
3. **Stricter cold-test pass criteria.** A preload row passes only if the agent returns the
   **exact** token **and no `Read`/`Grep`/`Glob`/`Bash`/`Skill`/file-discovery call occurs in
   that turn** **and** the transcript/debug trace confirms no lookup. Any lookup — even one
   returning the right token — fails the row (it proves discoverability, not preload).
4. **Automated enforcement.** `validate-plugin.py` and new acceptance **T11** verify: exactly
   one token per skill; all tokens unique; each token occurs only in its owning `SKILL.md`; no
   token appears in any agent, other skill, test plan, documentation, or release-evidence file.
   The checks discover tokens by pattern (never hard-code values) and report masked.
5. **`RELEASE-EVIDENCE.md` integrity fixed.** The isolation section no longer shows a
   marketplace id inconsistent with T10 and no longer claims that equal before/after
   `plugin list` line counts prove the real config was untouched. Isolation now rests on the
   documented `CLAUDE_CONFIG_DIR` override + a disposable working dir + explicit runtime
   assertions that print both the isolated config path and positive proof the install record
   landed inside the throwaway config.
6. Reran validation + acceptance: **`PASSED=11  FAILED=0  SKIPPED=2` → `ACCEPTANCE OK`**
   (T11 added).

## v0.1.5 (2026-08-18) — enforcement scope corrected + tests isolated (team blockers on v0.1.4)

Every change validated in-sandbox; the full unedited negative-test + acceptance output
ships in **`RELEASE-EVIDENCE.md`** inside this package. The two external tests (live
Shopify dev store; real interactive cold session) remain **NOT EXECUTED** and are not
fabricated.

1. **T10 is safe and isolated.** Every marketplace/install/details/uninstall/remove
   command in T10 now runs through `CLAUDE_CONFIG_DIR="$WORK/claude-config"` (a throwaway
   config dir; ref: env-vars docs). The operator's real `~/.claude` is never touched;
   teardown uses the **qualified** `webdesk-shopify-apps@wsa-accept --scope local`, not an
   unqualified uninstall against the normal environment.
2. **T10 tests the EXACT shipped package.** Removed the `tar --exclude` scratch filters
   and the `find … -rm` component cleanup that masked packaging defects. T10 now
   `cp -a "$ROOT/."` and installs it **unfiltered**; any unexpected component (or a count
   ≠ 8 agents / 11 skills) **fails**. The `_probe`/`probe-bad` scratch components were
   **deleted from the source tree**, so the real package is clean.
3. **Main-agent vs `@`-mention semantics corrected.** Per the sub-agents docs, the
   `Agent(...)` allowlist is platform-enforced **only when the orchestrator runs as the
   main thread** (settings default or `--agent`); invoked as a subagent via `@`-mention,
   the parenthesized list is ignored. Fixed in `agents/orchestrator.md` (incl. the stale
   `@webdesk-shopify-apps:orchestrator` line), `README.md`, `INSTALL.md`, `CHANGELOG.md`,
   `docs/DECISIONS.md`, and `tests/cold-plugin-discovery.md`. `@agent-…` is no longer
   listed as a main-agent path, the docs state the `@`-mention path does **not** provide
   the nested-agent restriction, and the cold-session rejection test runs only after
   confirming main-agent mode.
4. **Project-safe install scope.** Because the plugin ships a default `agent`, the docs
   now recommend installing from the Rossy repo with `--scope local` (or `--scope project`
   to share via `.claude/settings.json`), warn that the default **user** scope activates
   the orchestrator in every enabled project, and use the same qualified name + scope for
   teardown.
5. **Skill-preload cold test strengthened.** Replaced the duplicated bad-HMAC-401 example
   (that fact is in the QA agent body, so it never proved preload) with a **per-skill
   canary** table: a token unique to each skill body, tested for **every** declared skill
   across **all eight** agents, recorded separately. (Canaries verified present-in-skill /
   absent-in-agent-body by a build check; the interactive run stays NOT EXECUTED.)
6. **Read-only tool set tightened.** `qa` and `code-review` must declare **exactly**
   `[Read, Grep, Glob]`; `validate-plugin.py` and T5 now reject Bash, Agent, Write, Edit,
   and any other tool (previously only Write/Edit were rejected).
7. **QA evidence provenance.** QA requires every evidence set to include commit SHA, CI
   run ID / executor identity, execution timestamp, test environment, artifact source, and
   the store/build id, and marks evidence **BLOCKED** on missing provenance or a
   commit mismatch. "Log every QA run" changed to "return the proposed audit-log entry to
   the orchestrator" (QA has no write tools).
8. **Release evidence included.** `RELEASE-EVIDENCE.md` carries the complete unedited
   output: bare `Agent` rejected; missing specialist rejected; **extra** specialist
   rejected; **QA with Bash** rejected; invalid skill preload detected; `2026-02` **and**
   `2026-13` rejected; wrong default-agent value rejected; exact unfiltered package
   inventory; T10 under an isolated `CLAUDE_CONFIG_DIR`; and `PASSED=10 FAILED=0 SKIPPED=2`.

**Acceptance result (this build):** `PASSED=10  FAILED=0  SKIPPED=2` → `ACCEPTANCE OK`.

## v0.1.4 (2026-08-17) — allowlist correctly enforced + drift removed (team blockers on v0.1.3)

Every change below was validated in-sandbox; the full unedited acceptance output and
the negative-test evidence are in the release notes. The two external tests (live
Shopify dev store; real interactive end-user cold session) remain **NOT EXECUTED**.

1. **Sub-agent allowlist is now platform-enforced (corrects a v0.1.3 error).** The
   v0.1.3 statement *"Claude Code has no hard sub-agent allowlist"* was **wrong**.
   Claude Code supports `tools: Agent(name1, name2, …)` to restrict which sub-agents an
   agent may spawn. The orchestrator now declares
   `Agent(pm, architect, designer, shopify-developer, qa, code-review, delivery-head), Read, Grep, Glob, Bash`
   (string form — verified to pass `claude plugin validate --strict`). `validate-plugin.py`
   and acceptance **T4** now require **exactly** those seven: a bare `Agent`, a missing
   specialist, or an extra/unknown name **fails**. The "no hard allowlist" wording is
   removed from `orchestrator.md`, `docs/DECISIONS.md`, and this changelog.
2. **Activation corrected.** Typeahead (`@` → `webdesk-shopify-apps:orchestrator`) and
   manual `@agent-webdesk-shopify-apps:orchestrator`; `--agent webdesk-shopify-apps:orchestrator`
   for disambiguation. `settings.json` now uses the **plugin-local** `{"agent": "orchestrator"}`.
   _(v0.1.5 note: this entry did not distinguish main-agent from subagent invocation; the
   `Agent(...)` allowlist is enforced only for the main agent — see v0.1.5 item 3.)_
   `claude plugin details <name>` requires the plugin **installed** (takes a name, not
   `--plugin-dir`); documented via a local marketplace whose plugin `source` is relative.
3. **QA execution contradiction resolved (one model).** QA is **tool-level read-only**
   (`Read, Grep, Glob`) and runs nothing. CI (`app-ci.yml`) or an authorized executor
   runs the suite + Shopify checks and writes **immutable artifacts**; QA reads them,
   judges G4/G5, and returns a verdict to the orchestrator, which records it. Missing
   evidence = **BLOCKED**, never PASS; the implementation agent's "tests passed" is
   never the sole proof. All "seed/fire/probe/run" imperatives in `qa.md` reworded to
   "inspect the executor's evidence."
4. **Pre-launch Web Vitals drift removed.** G5 renamed to *"milestone regression,
   architecture fitness, and applicable baseline performance"* in `shopify-public-app-delivery/SKILL.md`
   and `reference/gates.md`. Production LCP/CLS/INP stay a **post-launch Built-for-Shopify**
   measurement; the designer's App-Bridge note no longer calls that a "store-listing gate."
5. **Cold-session test plan repaired** (`tests/cold-plugin-discovery.md`, still **NOT
   EXECUTED**): verifies all **8** agents (incl. `shopify-developer`) and **11** skills,
   orchestrator-as-default-main-agent, manual + typeahead invocation, delegation to an
   allowed specialist, an unapproved agent **rejected** by the `Agent(...)` allowlist,
   each agent's declared `skills:` **actually preloaded** (not mere folder existence),
   the QA execution model, and the startup header + `/context`.
6. **Validation strengthened + drift cleaned.** README's stale "7 sub-agents / 6
   specialists" tree fixed to 8/7. Acceptance **T8** asserts `settings.json` = `{"agent":
   "orchestrator"}`. New **T10** installs the plugin via a temporary local marketplace and
   asserts the **real** `claude plugin details` inventory = **8 agents / 11 skills with no
   `_`/probe scratch components** (the frontmatter-only parse missed those). API version
   validated as a Shopify **quarter** `YYYY-(01|04|07|10)` in the scaffolder **and** the
   JSON schema (rejects `2026-13` *and* `2026-02`). Fixed `/tmp/t1,/tmp/t2` replaced by a
   per-run `mktemp` scratch dir with a cleanup trap. Mandatory-dependency-missing still
   counts as **FAIL** (not skip); only the two external tests may skip.

**Acceptance result (this build):** `PASSED=10  FAILED=0  SKIPPED=2` → `ACCEPTANCE OK`.

## v0.1.3 (2026-08-17) — functional orchestration + validation hardening (team blockers on v0.1.2)

All changes validated in-sandbox; complete acceptance output is in the release evidence.

1. **Functional orchestrator.** Added the `Agent` tool to the orchestrator; it delegates to the 7 named specialists. _(This entry originally claimed "Claude Code has no hard sub-agent allowlist" — that was **incorrect**; **v0.1.4** replaces the bare `Agent` tool with an enforced `Agent(...)` allowlist. See v0.1.4 item 1.)_ Added a real **`shopify-developer`** agent (Read/Grep/Glob/Write/Edit/Bash) owning React Router 7, TypeScript, Admin GraphQL, webhooks, billing integration, config, and approved bug fixes. **QA and Code Review are read-only** (`[Read, Grep, Glob]`, no Write/Edit).
2. **Correct activation.** Removed the wrong `/webdesk-shopify-apps:orchestrator` slash docs (slash = skills). Agents use `@webdesk-shopify-apps:orchestrator`, `claude --agent webdesk-shopify-apps:orchestrator`, or the shipped **`settings.json`** default agent. Discovery documented via `/context`, `@`-typeahead, and `claude plugin details`. Interactive verification remains the team's cold-session test (updated plan).
3. **Exact `skills:` on every agent.** Every agent now lists only skills that exist; replaced all stale names (`shopify-app-auth`→`shopify-app-auth-and-routes`, `shopify-app-webhooks`→`shopify-webhooks-compliance`, `shopify-app-graphql`→`shopify-admin-graphql`, `shopify-app-polaris`/`shopify-app-app-bridge`→`shopify-polaris-app-bridge`). The validator enforces existence.
4. **Policy contradictions removed.** `customers/data_request` now = acknowledge empty/minimal 2xx, then deliver to the store owner within 30 days (no "returns data"). Blanket "no unauthenticated endpoints" replaced by the route-auth matrix (blocker = unauthenticated **sensitive/protected** route; a static non-sensitive health endpoint is allowed). Web Vitals thresholds removed from pre-submission G-Review (kept as post-launch BFS measurement). The no-UI / G2-skipped path removed — every public app provides an operational merchant UI; **G2 can be reduced, never skipped**.
5. **Scaffolder repaired.** `project.id` is now a real **UUID v4** and the schema enforces the UUID pattern (generator + schema agree). Refuses to overwrite an existing non-empty project unless `--force`. Validates `--api-version` format (`YYYY-MM`). Removed the broken `tools/pilot` reference.
6. **Stronger validation + acceptance.** `validate-plugin.py` now verifies: every agent `skills:` name exists; the orchestrator has the `Agent` tool and references every existing specialist; producing agents have Write+Edit and read-only agents don't; and **directory** references resolve (not just extension-based file refs). `run-acceptance.sh` reports **PASSED / FAILED / SKIPPED separately**, treats a missing Claude CLI / dependency on a mandatory test as a **FAILURE** (not a skip), and only the two external tests may be skipped. Latest run: **PASSED=9 FAILED=0 SKIPPED=2, exit 0**.

### Still NOT executed (accepted external limitations)
- Live Shopify dev-store smoke test and a real end-user cold Claude Code session — delivered as `tests/*.md` plans; run in your environment.


## v0.1.2 (2026-08-17) — release-blocking correction (team feedback on v0.1.1)

Repackaged from a bespoke "knowledge skill" into a **valid Claude Code plugin**,
normalized frontmatter, replaced the validator, repaired the scaffolder, corrected
the Shopify guidance against live docs, added GitHub Actions and automated
acceptance tests. Every runnable change was validated in-sandbox with the outputs
recorded below.

### 1. Packaged as a valid Claude Code plugin
- Added `.claude-plugin/plugin.json` (only `name` required; custom values under `metadata`).
- Skills at canonical `skills/<name>/SKILL.md`; agents as **real sub-agents** at `agents/<name>.md`.
- Orchestrator + 6 specialists are now agent definitions Claude discovers by `description` and invoked via `@webdesk-shopify-apps:orchestrator` / `--agent` (corrected in v0.1.3; slash `/…` is for skills only).
- Documented one tested install/validate command (README) + local load + marketplace install (INSTALL.md).
- **Evidence:** `claude plugin validate . --strict` → `✔ Validation passed`.

### 2. Normalized every SKILL.md / agent frontmatter
- Skills use only `name`, `description`, `allowed-tools`, `disable-model-invocation`. Agents use only `name`, `description`, `model`, `tools`, etc.
- Removed the bespoke `tier`/`load_when`/`version`/`color`/`model`-in-skill fields (Claude silently ignores them; they conveyed the old progressive-disclosure model, now replaced by `description`-based discovery + real agent configs).
- All descriptions containing colons are quoted (valid YAML).

### 3. Replaced the regex validator with real YAML parsing
- New `tools/scripts/validate-plugin.py` uses PyYAML: validates the manifest, skill/agent required fields + allowed keys + types, and that internal references resolve. Validates only intended docs (skips `_`/`.` scratch paths).
- Proven to catch unquoted-colon descriptions (`mapping values are not allowed here`).
- **Evidence:** `validate-plugin.py .` → `OK: zero errors` (exit 0).

### 4. Repaired `init-project.sh`
- Strict client-slug validation (`^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])$`).
- `project.json` built + **schema-validated** by python3 + jsonschema (values passed via env, **no string interpolation**); writes only if schema-valid.
- Schema-conforming IDs; dependency checks (python3+jsonschema required; node/npm/jq checked); `chmod +x`; every path written to `CLAUDE.md` is created and re-verified.
- **Evidence:** generates schema-valid `project.json` for app-build / feature / maintenance; rejects bad slug/type with exit 2.

### 5. Updated the Shopify skeleton to the current official React Router template
- `distribution: AppDistribution.AppStore`; `future: { expiringOfflineAccessTokens: true }` (offline token 60-min expiry + refresh handling); `authPathPrefix: "/auth"`; `addDocumentResponseHeaders` for CSP/frame-ancestors; `shopify-api-key` meta before `app-bridge.js` (injected by `<AppProvider embedded>`); current App Bridge nav (`<s-app-nav>`/`<s-link>`).
- Session storage kept on `@shopify/shopify-app-session-storage-postgresql` — documented, supported deviation from the template default (Prisma); **not switched to Prisma** (team decision).
- API pinned to **`ApiVersion.July26` (2026-07)** — explicit, reproducible; **no dynamic latest-resolution**; quarterly review process.

### 6. Rewrote the billing guidance
- App Events **client-credentials** auth (token 60-min, scope `write_global_api_app_events`, 500 req/s, PII prohibited, retry semantics, **permanent** billing-event idempotency, 24-hour uninstall window).
- **Removed** the unsupported one-to-one reconciliation between App Events idempotency keys and Partner Historical Event IDs; reconciliation is **aggregate/`chargeId`-only**.
- Corrected the Historical Events shape (`App.events`, no top-level `historicalEvents`; money fields `grossAmount`/`netAmount`/`shopifyFee`, no `shopifySaleAmount`).
- Stated clearly which reconciliation is supported (aggregate) and that billing-validation failures are **visible only in Shopify's dashboard**.

### 7. Rewrote privacy webhook instructions
- Acknowledge 2xx quickly; HMAC verification mandatory (**401 on bad HMAC**); `customers/data_request` delivered to the store owner within 30 days (async ok); `customers/redact`/`shop/redact` windows (48h shop/redact) + legal-retention exceptions; async completion tracking.
- "No PII in the acknowledgment" is labeled a **WebDesk security policy**, not an official Shopify requirement (Shopify does not document it directly).

### 8. Explicit route-authentication matrix
- Embedded admin → session token (`authenticate.admin`); webhooks → HMAC (`authenticate.webhook`, 401 on bad); app-proxy/public/extensions → Shopify signature + CORS (`authenticate.public.*`); health → static, no Shopify auth, non-sensitive. Blanket "all routes need auth" removed.

### 9. Separated baseline App Store gates from Built for Shopify
- **G-Review** = mandatory App Store baseline (pre-submission, blocking). **Built for Shopify** = separate **post-launch** eligibility gate (≥50 installs, ≥5 reviews, rating, measured Web Vitals — cannot be pre-submission). BFS *technical* best-practices kept in the pre-launch workflow.

### 10. Repaired / labeled GitHub Actions (`.github/workflows/`)
- `plugin-validate.yml` (validates this plugin), `app-ci.yml` (mandatory lint/typecheck/test/build, **no `--if-present`**, paths cover ts/tsx/js/jsx/graphql/css/json/toml/workflow), `app-deploy.yml` (marked **NON-PRODUCTION**, failures not masked, **migrate step skipped in shared-SaaS**). No BigCommerce/ERP drift.

### 11. Added automated acceptance tests (`tests/`)
- `run-acceptance.sh` (7 checks): manifest validation, real-YAML frontmatter + reference resolution, skill/agent discoverability, schema-valid generated JSON + all YAML/JSON parse, mandatory checks can't `--if-present`-skip, clean-env bootstrap. **Evidence:** `7 passed, 0 failed` (exit 0).
- **Not executed here (documented, require external systems):** `shopify-dev-store-smoke.md` (disposable dev store: install/token-refresh/embedded-home/webhook/uninstall/privacy) and `cold-plugin-discovery.md` (real end-user cold Claude Code session).

### Known limitations (carried, not hidden)
- The live Shopify dev-store smoke test and a true end-user cold-session discovery test were **not** executed — no Shopify store/credentials/deployed app and no interactive end-user session in the build sandbox. Delivered as scripts/plans; run in your environment.
- Several Shopify version-specifics are marked **verify-at-build** (exact package exports/`ApiVersion` enum on the app's chosen major line; BFS minimum-rating number; per-field protected-data submission form; per-field GraphQL costs).

## v0.1.1 (2026-08-17)
Initial build + pre-pilot self-audit (mechanical + cold-read). Bespoke frontmatter,
regex validator, string-interpolated scaffolder — corrected in v0.1.2.
