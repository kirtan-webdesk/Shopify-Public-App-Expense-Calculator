#!/usr/bin/env python3
"""Real YAML-parsing validator for the webdesk-shopify-apps Claude Code plugin.

Replaces the old regex frontmatter check. Validates ONLY the intended plugin
documents and uses a genuine YAML parser (PyYAML), so it catches unquoted
descriptions with colons, bad list types, etc.

Checks:
  1. .claude-plugin/plugin.json         -> valid JSON, required `name`, field allow-list
  2. skills/<name>/SKILL.md frontmatter -> valid YAML; required name+description;
                                           only allowed keys; allowed-tools shape
  3. agents/<name>.md frontmatter       -> valid YAML; required name+description;
                                           only allowed keys; tools is a list; model valid
  4. referenced plugin paths in skills/agents resolve on disk
Files whose basename starts with "_" or "." are treated as internal and skipped.

Usage: python3 validate-plugin.py [plugin_root]   (default: two levels up)
Exit 0 only if zero errors.
"""
import os
import sys
import json
import glob
import re

try:
    import yaml
except ImportError:
    print("ERROR: PyYAML is required (pip install pyyaml).")
    sys.exit(2)

# ---- allowed field sets (per code.claude.com docs, verified 2026-08-17) ----
PLUGIN_ALLOWED = {"name", "displayName", "version", "description", "author",
                  "homepage", "repository", "license", "keywords", "metadata",
                  "experimental", "commands", "agents", "skills", "hooks", "mcpServers"}
SKILL_ALLOWED = {"name", "description", "allowed-tools", "disable-model-invocation"}
SKILL_REQUIRED = {"name", "description"}
AGENT_ALLOWED = {"name", "description", "model", "effort", "maxTurns", "tools",
                 "disallowedTools", "skills", "memory", "background", "isolation"}
AGENT_REQUIRED = {"name", "description"}
VALID_MODELS = {"sonnet", "opus", "haiku", "inherit"}

# The orchestrator may spawn ONLY these seven plugin specialists. Claude Code's
# sub-agent allowlist syntax is `tools: Agent(name1, name2, ...)`; a bare `Agent`
# with no parentheses allows ALL sub-agents and is rejected. A plugin agent is
# registered as an invocable SUB-AGENT TYPE only under its scoped identifier
# `<plugin-name>:<agent-name>` — the bare name resolves only when launching that
# agent as the session's main agent (`--agent <plugin>:<name>`), never for
# Agent(...) delegation lookup. This was the beta.5 defect: a bare-name allowlist
# platform-validated but failed at runtime with "Agent type '<name>' not found.
# Available agents: none". So every allowlist entry MUST be fully scoped.
ORCHESTRATOR_SPECIALISTS = {"pm", "architect", "designer", "shopify-developer",
                            "qa", "code-review", "delivery-head"}

_plugin_name_cache = {}


def get_plugin_name(root):
    if root not in _plugin_name_cache:
        try:
            _plugin_name_cache[root] = json.load(
                open(os.path.join(root, ".claude-plugin", "plugin.json"), encoding="utf-8"))["name"]
        except Exception:
            _plugin_name_cache[root] = None
    return _plugin_name_cache[root]

errors = []
warnings = []
checked = 0


def parse_tools(tools):
    """Normalize an agent `tools:` value (Claude Code accepts either a YAML list
    or a single comma-separated string, e.g. `Agent(pm, qa), Read, Bash`).

    Returns (names, agent_allowlist, agent_present):
      names           -> set of top-level tool base names (Agent, Read, Write, ...)
      agent_allowlist -> list of sub-agent names inside Agent(...), or None if the
                         Agent tool appears bare (no parentheses) or is absent
      agent_present   -> True if the Agent (or legacy Task) tool is listed at all
    """
    if tools is None:
        return set(), None, False
    if isinstance(tools, list):
        items = [str(x).strip() for x in tools]
    elif isinstance(tools, str):
        # split on top-level commas only (not commas inside Agent(...))
        items = [i.strip() for i in re.split(r',\s*(?![^()]*\))', tools.strip()) if i.strip()]
    else:
        return set(), None, False
    names, allow, present = set(), None, False
    for it in items:
        m = re.match(r'^([A-Za-z_][A-Za-z0-9_-]*)\s*(?:\((.*)\))?\s*$', it)
        if not m:
            names.add(it)
            continue
        base, inside = m.group(1), m.group(2)
        names.add(base)
        if base in ("Agent", "Task"):  # Task is the pre-2.1.63 alias for Agent
            present = True
            if inside is not None:
                allow = [a.strip() for a in inside.split(",") if a.strip()]
    return names, allow, present


def _rel(path, start=None):
    """os.path.relpath, but never crashes when `path` and the relative-to
    directory are on different Windows drives (e.g. a plugin root on D:\\
    validated against a scratch copy under a C:\\ temp dir). Falls back to the
    normalized absolute path for display purposes only — never used for
    containment/security checks, which compare resolved absolute paths directly."""
    try:
        return os.path.relpath(path, start) if start is not None else os.path.relpath(path)
    except ValueError:
        return os.path.abspath(path)


def raw_tool_items(tools):
    """Return the raw tool entries (list form, or top-level comma-split of a string),
    unnormalized — preserves MCP entries like 'mcp__plugin_x_y__*' verbatim."""
    if tools is None:
        return []
    if isinstance(tools, list):
        return [str(x).strip() for x in tools if str(x).strip()]
    if isinstance(tools, str):
        return [i.strip() for i in re.split(r',\s*(?![^()]*\))', tools.strip()) if i.strip()]
    return []


def is_internal(path):
    # Skip if any path component (dir or file) starts with "_" or "." — internal/scratch.
    parts = path.replace("\\", "/").split("/")
    return any(p.startswith("_") or p.startswith(".") for p in parts)


def parse_frontmatter(path):
    """Return (data, err). Uses real YAML parsing of the --- block."""
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    if not text.startswith("---"):
        return None, "missing YAML frontmatter block (must start with ---)"
    end = text.find("\n---", 3)
    if end == -1:
        return None, "unterminated frontmatter block (no closing ---)"
    block = text[3:end]
    try:
        data = yaml.safe_load(block)
    except yaml.YAMLError as e:
        return None, f"invalid YAML: {e}"
    if not isinstance(data, dict):
        return None, "frontmatter is not a mapping"
    return data, None


def check_manifest(root):
    global checked
    mpath = os.path.join(root, ".claude-plugin", "plugin.json")
    if not os.path.isfile(mpath):
        errors.append(".claude-plugin/plugin.json missing")
        return
    checked += 1
    try:
        data = json.load(open(mpath, encoding="utf-8"))
    except json.JSONDecodeError as e:
        errors.append(f"plugin.json: invalid JSON: {e}")
        return
    if "name" not in data:
        errors.append("plugin.json: required field 'name' missing")
    for k in data:
        if k not in PLUGIN_ALLOWED:
            warnings.append(f"plugin.json: unrecognized field '{k}' (allowed as metadata, but flagged)")


def check_doc(path, allowed, required, kind):
    global checked
    checked += 1
    rel = _rel(path)
    data, err = parse_frontmatter(path)
    if err:
        errors.append(f"{rel}: {err}")
        return None
    for r in required:
        if r not in data or data[r] in (None, ""):
            errors.append(f"{rel}: missing required key '{r}'")
    for k in data:
        if k not in allowed:
            errors.append(f"{rel}: key '{k}' not in allowed {kind} fields {sorted(allowed)}")
    # description should be a non-trivial string
    if "description" in data and not isinstance(data["description"], str):
        errors.append(f"{rel}: 'description' must be a string")
    return data


def check_skill(path):
    data = check_doc(path, SKILL_ALLOWED, SKILL_REQUIRED, "skill")
    if not data:
        return
    rel = _rel(path)
    at = data.get("allowed-tools")
    if at is not None and not isinstance(at, (str, list)):
        errors.append(f"{rel}: 'allowed-tools' must be a space-separated string or a list")
    dmi = data.get("disable-model-invocation")
    if dmi is not None and not isinstance(dmi, bool):
        errors.append(f"{rel}: 'disable-model-invocation' must be a boolean")


def check_agent(path):
    data = check_doc(path, AGENT_ALLOWED, AGENT_REQUIRED, "agent")
    if not data:
        return
    rel = _rel(path)
    tools = data.get("tools")
    if tools is not None and not isinstance(tools, (list, str)):
        errors.append(f"{rel}: 'tools' must be a YAML list or a comma-separated string "
                      f"(got {type(tools).__name__})")
    m = data.get("model")
    if m is not None and m not in VALID_MODELS:
        errors.append(f"{rel}: model '{m}' not in {sorted(VALID_MODELS)}")


PRODUCING_AGENTS = {"pm", "architect", "designer", "shopify-developer", "delivery-head"}
READONLY_AGENTS = {"qa", "code-review"}
# read-only agents must carry exactly this tool set — no Bash, Agent, Write, Edit, etc.
READONLY_EXACT = {"Read", "Grep", "Glob"}


def _agent_fm(root, name):
    p = os.path.join(root, "agents", name + ".md")
    if not os.path.isfile(p):
        return None
    d, _ = parse_frontmatter(p)
    return d if isinstance(d, dict) else None


def check_agent_wiring(root):
    """Item-6 checks: agent skills exist; orchestrator has Agent tool + refs real
    specialists; producing agents have Write+Edit; read-only agents have neither."""
    skill_names = {os.path.basename(os.path.dirname(p))
                   for p in glob.glob(os.path.join(root, "skills", "*", "SKILL.md"))
                   if not is_internal(p)}
    agent_files = [p for p in glob.glob(os.path.join(root, "agents", "*.md")) if not is_internal(p)]
    agent_names = {os.path.splitext(os.path.basename(p))[0] for p in agent_files}

    # every skills: entry on every agent must resolve to a real skill
    for p in agent_files:
        d, err = parse_frontmatter(p)
        if err or not isinstance(d, dict):
            continue
        for s in (d.get("skills") or []):
            if s not in skill_names:
                errors.append(f"{_rel(p, root)}: skills: '{s}' is not a real skill in this plugin")

    # orchestrator: must carry an EXACT Agent(...) allowlist of the seven plugin
    # specialists, using their FULLY SCOPED identifiers `<plugin-name>:<agent-name>`.
    # A bare `Agent` (all sub-agents), a short/wrong list, or any BARE (unscoped)
    # specialist name is rejected — bare names do not register as delegatable
    # sub-agent types for a plugin agent (v0.1.8-beta.5 runtime defect; fixed in
    # beta.6 by requiring the scoped form everywhere).
    plugin_name = get_plugin_name(root)
    orch = _agent_fm(root, "orchestrator")
    if orch is None:
        errors.append("agents/orchestrator.md missing")
    elif plugin_name is None:
        errors.append("cannot verify orchestrator Agent(...) allowlist: plugin.json name unreadable")
    else:
        scoped_allowlist = {f"{plugin_name}:{a}" for a in ORCHESTRATOR_SPECIALISTS}
        example = ", ".join(sorted(scoped_allowlist))
        _, allow, agent_present = parse_tools(orch.get("tools"))
        if not agent_present:
            errors.append("agents/orchestrator.md: must include the Agent tool for delegation")
        elif allow is None:
            errors.append(f"agents/orchestrator.md: Agent tool must be a restricted, fully-scoped "
                          f"allowlist Agent({example}) — a bare 'Agent' allows ALL sub-agents and "
                          f"is not permitted")
        else:
            got = set(allow)
            unscoped = {a for a in got if ":" not in a}
            if unscoped:
                errors.append(f"agents/orchestrator.md: Agent(...) allowlist contains BARE "
                              f"(unscoped) specialist name(s) {sorted(unscoped)} — a plugin agent "
                              f"only registers as a delegatable sub-agent type under its scoped "
                              f"identifier '{plugin_name}:<name>'; a bare name platform-validates "
                              f"but fails at runtime with \"Agent type '<name>' not found. Available "
                              f"agents: none\" (the beta.5 defect). Use the scoped form.")
            missing = scoped_allowlist - got
            extra = got - scoped_allowlist - unscoped
            if missing:
                errors.append(f"agents/orchestrator.md: Agent(...) allowlist is missing "
                              f"specialist(s) {sorted(missing)}")
            if extra:
                errors.append(f"agents/orchestrator.md: Agent(...) allowlist contains "
                              f"non-specialist or wrongly-scoped agent(s) {sorted(extra)} (allowed: "
                              f"{sorted(scoped_allowlist)})")
            # every scoped allowlisted name must map to a real agent file in this plugin
            for a in sorted(got - unscoped):
                bare = a.split(":", 1)[1] if ":" in a else a
                plugin_part = a.split(":", 1)[0] if ":" in a else None
                if plugin_part != plugin_name:
                    errors.append(f"agents/orchestrator.md: Agent(...) allowlists '{a}' scoped to "
                                  f"plugin '{plugin_part}', not this plugin ('{plugin_name}')")
                elif bare not in agent_names:
                    errors.append(f"agents/orchestrator.md: Agent(...) allowlists '{a}' "
                                  f"but no agents/{bare}.md exists")

    # producing agents must have Write + Edit
    for a in PRODUCING_AGENTS:
        d = _agent_fm(root, a)
        if d is None:
            errors.append(f"agents/{a}.md: required producing agent is missing")
            continue
        names, _, _ = parse_tools(d.get("tools"))
        if "Write" not in names or "Edit" not in names:
            errors.append(f"agents/{a}.md: producing agent must have Write and Edit (has {sorted(names)})")

    # read-only agents must have EXACTLY {Read, Grep, Glob} — nothing else.
    # (Rejecting only Write/Edit was too weak: Bash or Agent could be added while the
    # validator still called the agent read-only.)
    for a in READONLY_AGENTS:
        d = _agent_fm(root, a)
        if d is None:
            errors.append(f"agents/{a}.md: required read-only agent is missing")
            continue
        names, _, agent_present = parse_tools(d.get("tools"))
        if names != READONLY_EXACT:
            extra = sorted(names - READONLY_EXACT)
            missing = sorted(READONLY_EXACT - names)
            msg = f"agents/{a}.md: read-only agent tools must be EXACTLY {sorted(READONLY_EXACT)}"
            if extra:
                msg += f"; remove disallowed tool(s) {extra}"
            if missing:
                msg += f"; add missing tool(s) {missing}"
            errors.append(msg)


def check_dir_references(root):
    """Backticked directory references (paths ending in '/') must resolve."""
    import re
    dirs = set()
    for dp, dn, _ in os.walk(root):
        for d in dn:
            dirs.add(os.path.relpath(os.path.join(dp, d), root).replace("\\", "/"))
    pat = re.compile(r'`([A-Za-z0-9_./-]+/)`')
    PRE = ("skills/", "agents/", "tools/", "reference/", ".github/", "tests/", "docs/")
    for f in glob.glob(os.path.join(root, "**", "*.md"), recursive=True):
        if is_internal(f):
            continue
        base = os.path.dirname(os.path.relpath(f, root)).replace("\\", "/")
        for m in set(pat.findall(open(f, encoding="utf-8").read())):
            mm = m.strip("/").lstrip("./")
            if not m.lstrip("./").startswith(PRE):
                continue
            alt = (base + "/" + mm).replace("//", "/") if base else mm
            if mm not in dirs and alt not in dirs:
                errors.append(f"{_rel(f, root)}: broken directory reference '{m}'")


PRELOAD_TOKEN_RE = re.compile(r'WSA-PRELOAD-[a-z0-9-]+-[0-9A-F]{16}')


def check_preload_tokens(root):
    """Preload-verification tokens (WSA-PRELOAD-<skill>-<HEX16>): each SKILL.md must
    contain exactly one, all tokens unique, and each token must appear ONLY in its
    owning SKILL.md — never in an agent, another skill, a test plan, documentation,
    or the release-evidence file. This makes the cold-session preload probe sound:
    a correct answer cannot be echoed from anywhere but the injected skill body.
    Token VALUES are discovered by scanning (never hard-coded here)."""
    skill_files = [p for p in glob.glob(os.path.join(root, "skills", "*", "SKILL.md"))
                   if not is_internal(p)]
    skill_dir = {p: os.path.basename(os.path.dirname(p)) for p in skill_files}

    # token -> set of files it appears in (relative)
    occ = {}
    for dp, dn, fs in os.walk(root):
        if ".git" in dp.split(os.sep) or "__pycache__" in dp.split(os.sep):
            continue
        for f in fs:
            fp = os.path.join(dp, f)
            try:
                txt = open(fp, encoding="utf-8", errors="ignore").read()
            except Exception:
                continue
            for tok in PRELOAD_TOKEN_RE.findall(txt):
                occ.setdefault(tok, set()).add(os.path.relpath(fp, root).replace("\\", "/"))

    # 1) exactly one token per SKILL.md, VISIBLE (not inside an HTML comment), and the
    #    token's embedded skill segment must match the owning skill directory name.
    html_comment = re.compile(r'<!--.*?-->', re.S)
    for p in skill_files:
        rel = os.path.relpath(p, root).replace("\\", "/")
        raw = open(p, encoding="utf-8", errors="ignore").read()
        found = PRELOAD_TOKEN_RE.findall(raw)
        if len(found) == 0:
            errors.append(f"{rel}: missing its WSA-PRELOAD preload-verification token")
            continue
        if len(found) > 1:
            errors.append(f"{rel}: has {len(found)} WSA-PRELOAD tokens (must be exactly one)")
        tok = found[0]
        # visible marker: token must survive HTML-comment stripping
        if tok not in html_comment.sub('', raw):
            errors.append(f"{rel}: preload token must be a VISIBLE marker, not inside an HTML comment "
                          f"(a preloaded agent must be able to read and return it)")
        # embedded skill name must match the directory
        owner = skill_dir[p]
        if not tok.startswith(f"WSA-PRELOAD-{owner}-") or \
           not re.fullmatch(r'[0-9A-F]{16}', tok[len(f"WSA-PRELOAD-{owner}-"):]):
            errors.append(f"{rel}: token '{_mask(tok)}' does not match the required form "
                          f"WSA-PRELOAD-{owner}-<16 uppercase hex>")

    # 2) exactly one token per skill overall (uniqueness + count == #skills)
    if len(occ) != len(skill_files):
        errors.append(f"preload tokens: found {len(occ)} distinct token(s) but there are "
                      f"{len(skill_files)} skill(s) — expected exactly one unique token per skill")

    # 3) each token must occur in exactly ONE file, and that file must be a SKILL.md
    skill_relset = {os.path.relpath(p, root).replace("\\", "/") for p in skill_files}
    for tok, files in occ.items():
        if len(files) != 1:
            errors.append(f"preload token leaked: {_mask(tok)} appears in {sorted(files)} "
                          f"(must occur once, only in its owning SKILL.md)")
            continue
        only = next(iter(files))
        if only not in skill_relset:
            errors.append(f"preload token {_mask(tok)} lives in '{only}', not a SKILL.md")


def _mask(tok):
    """Report a token without printing its full high-entropy value."""
    return tok.rsplit("-", 1)[0] + "-<redacted>"


MCP_SERVER_NAME = "shopify-dev-mcp"
MCP_PACKAGE = "@shopify/dev-mcp"
MCP_DEV_AGENT = "shopify-developer"
EXACT_SEMVER = re.compile(r'^\d+\.\d+\.\d+$')


def check_mcp(root):
    """v0.1.8 — Shopify Dev MCP integration guardrails:
      * plugin ships a valid `.mcp.json` declaring the shopify-dev-mcp server;
      * the MCP package version is EXACT-pinned (reject @latest, ranges, wildcards);
      * ONLY shopify-developer may access the MCP tools, via the correctly plugin-scoped
        name `mcp__plugin_<plugin>_shopify-dev-mcp__*`;
      * every other agent has ZERO `mcp__` tools; qa/code-review stay exactly read-only.
    """
    # plugin name (for the scoped tool prefix)
    plugin_name = get_plugin_name(root)
    # per docs, any char outside [A-Za-z0-9_-] in plugin/server name becomes "_"
    def norm(s):
        return re.sub(r'[^A-Za-z0-9_-]', '_', s)
    scoped_prefix = (f"mcp__plugin_{norm(plugin_name)}_{norm(MCP_SERVER_NAME)}__"
                     if plugin_name else None)
    expected_wildcard = scoped_prefix + "*" if scoped_prefix else None

    # 1) .mcp.json valid + pinned server
    mpath = os.path.join(root, ".mcp.json")
    if not os.path.isfile(mpath):
        errors.append(".mcp.json missing at plugin root (required to bundle the Shopify Dev MCP)")
    else:
        try:
            mdata = json.load(open(mpath, encoding="utf-8"))
        except json.JSONDecodeError as e:
            errors.append(f".mcp.json: invalid JSON: {e}")
            mdata = None
        if isinstance(mdata, dict):
            servers = mdata.get("mcpServers")
            if not isinstance(servers, dict) or MCP_SERVER_NAME not in servers:
                errors.append(f".mcp.json: must declare mcpServers['{MCP_SERVER_NAME}']")
            else:
                entry = servers[MCP_SERVER_NAME]
                args = entry.get("args") if isinstance(entry, dict) else None
                if not entry.get("command"):
                    errors.append(f".mcp.json: {MCP_SERVER_NAME} needs a 'command'")
                specs = [a for a in (args or []) if isinstance(a, str) and a.startswith(MCP_PACKAGE + "@")]
                if not specs:
                    errors.append(f".mcp.json: {MCP_SERVER_NAME} args must run '{MCP_PACKAGE}@<exact version>'")
                else:
                    ver = specs[0].rsplit("@", 1)[1]
                    if not EXACT_SEMVER.match(ver):
                        errors.append(f".mcp.json: MCP package must be an EXACT pinned version "
                                      f"(got '{MCP_PACKAGE}@{ver}') — '@latest', ranges (^ ~ x *) and "
                                      f"snapshots are not reproducible and are rejected")

    # 2) shopify-developer must have the correctly-scoped MCP access; nothing mis-scoped
    dev = _agent_fm(root, MCP_DEV_AGENT)
    if dev is None:
        errors.append(f"agents/{MCP_DEV_AGENT}.md missing (must hold the Shopify Dev MCP tools)")
    else:
        items = raw_tool_items(dev.get("tools"))
        mcp_items = [t for t in items if t.startswith("mcp__")]
        if expected_wildcard and expected_wildcard not in items and \
           not any(t.startswith(scoped_prefix) for t in mcp_items):
            errors.append(f"agents/{MCP_DEV_AGENT}.md: must grant Shopify Dev MCP access "
                          f"'{expected_wildcard}' in tools")
        for t in mcp_items:
            if scoped_prefix and not t.startswith(scoped_prefix):
                errors.append(f"agents/{MCP_DEV_AGENT}.md: MCP tool '{t}' is incorrectly scoped — "
                              f"a plugin-bundled server must use the prefix '{scoped_prefix}' "
                              f"(a bare 'mcp__{MCP_SERVER_NAME}__…' never resolves for a plugin server)")

    # 3) no OTHER agent may hold any MCP tool
    for p in glob.glob(os.path.join(root, "agents", "*.md")):
        if is_internal(p):
            continue
        name = os.path.splitext(os.path.basename(p))[0]
        if name == MCP_DEV_AGENT:
            continue
        d, _ = parse_frontmatter(p)
        if not isinstance(d, dict):
            continue
        bad = [t for t in raw_tool_items(d.get("tools")) if t.startswith("mcp__")]
        if bad:
            errors.append(f"agents/{name}.md: only {MCP_DEV_AGENT} may hold MCP tools; found {bad}")

    # 4) workflow wiring (v0.1.8-beta.2): the MCP-evidence checker must be part of the REAL
    #    workflow, not only acceptance tests.
    ev_schema = os.path.join(root, "tools", "schemas", "mcp-validation-evidence.schema.json")
    if not os.path.isfile(ev_schema):
        errors.append("tools/schemas/mcp-validation-evidence.schema.json missing "
                      "(required structured MCP evidence schema)")
    rec_schema = os.path.join(root, "tools", "schemas", "mcp-validation-record.schema.json")
    if not os.path.isfile(rec_schema):
        errors.append("tools/schemas/mcp-validation-record.schema.json missing "
                      "(required structured MCP validation-record schema)")
    checker = os.path.join(root, "tools", "scripts", "check-dev-handoff.py")
    if not os.path.isfile(checker):
        errors.append("tools/scripts/check-dev-handoff.py missing (developer handoff gate)")
    if not os.path.isfile(os.path.join(root, "tools", "scripts", "run-gates.py")):
        errors.append("tools/scripts/run-gates.py missing (bundled deterministic gate runner)")
    orch_p = os.path.join(root, "agents", "orchestrator.md")
    if os.path.isfile(orch_p):
        ob = open(orch_p, encoding="utf-8").read()
        if "check-dev-handoff.py" not in ob:
            errors.append("agents/orchestrator.md: must reference and enforce "
                          "check-dev-handoff.py after shopify-developer (workflow gate, not only acceptance)")
        # B1: the checker lives in the INSTALLED plugin — must be invoked via ${CLAUDE_PLUGIN_ROOT},
        # never a bare project-relative path, and --root must be ${CLAUDE_PROJECT_DIR}.
        plugin_ref = r"${CLAUDE_PLUGIN_ROOT}/tools/scripts/check-dev-handoff.py"
        if plugin_ref not in ob:
            errors.append("agents/orchestrator.md: must invoke the checker via "
                          "\"${CLAUDE_PLUGIN_ROOT}/tools/scripts/check-dev-handoff.py\" (the script ships "
                          "inside the installed plugin, not the app repo)")
        if "${CLAUDE_PROJECT_DIR}" not in ob:
            errors.append("agents/orchestrator.md: the checker's --root must target ${CLAUDE_PROJECT_DIR}")
    # reject a bare project-relative `tools/scripts/check-dev-handoff.py` anywhere in agent content
    for ap in (orch_p, os.path.join(root, "agents", "shopify-developer.md")):
        if not os.path.isfile(ap):
            continue
        body = open(ap, encoding="utf-8").read()
        for occ in re.finditer(r'(\$\{CLAUDE_PLUGIN_ROOT\}/)?tools/scripts/check-dev-handoff\.py', body):
            if not occ.group(1):
                errors.append(f"agents/{os.path.basename(ap)}: bare project-relative "
                              f"'tools/scripts/check-dev-handoff.py' — must be "
                              f"'${{CLAUDE_PLUGIN_ROOT}}/tools/scripts/check-dev-handoff.py'")
    qa_p = os.path.join(root, "agents", "qa.md")
    if os.path.isfile(qa_p):
        qb = open(qa_p, encoding="utf-8").read()
        if "mcp-validation-evidence" not in qb and "MCP validation evidence" not in qb:
            errors.append("agents/qa.md: must require the structured MCP validation evidence artifact "
                          "when the change is Shopify-specific")


def check_extension_wording(root):
    """v0.1.8-beta.3 — reject any doc/agent sentence that AFFIRMATIVELY claims `validate_theme`
    validates Shopify EXTENSION configuration. `validate_theme` covers Liquid/theme only. The
    words 'theme'/'Liquid' are NOT treated as negations (that was the beta.2 weakness that let
    'The validate_theme tool validates extension configuration and theme code.' pass). A sentence
    is flagged when it contains `validate_theme` AND 'extension' AND an affirmative validation
    claim (a 'validat(e|es|ing)' verb, or an 'extension… validator' noun phrase), UNLESS it carries
    an explicit hard negation (not/no/never/n't/cannot/without)."""
    import re as _re
    tool = _re.compile(r"validate_theme", _re.I)
    ext = _re.compile(r"\bextension", _re.I)
    verb = _re.compile(r"\bvalidat(?:e|es|ing)\b", _re.I)
    nounclaim = _re.compile(r"extension[\w-]*\s+validator", _re.I)
    hardneg = _re.compile(r"\bnot\b|\bno\b|\bnever\b|n['’]t|\bcannot\b|\bwithout\b", _re.I)
    md = set(glob.glob(os.path.join(root, "*.md"))
             + glob.glob(os.path.join(root, "agents", "*.md"))
             + glob.glob(os.path.join(root, "docs", "*.md"))
             + glob.glob(os.path.join(root, "tests", "*.md"))
             + glob.glob(os.path.join(root, "skills", "**", "*.md"), recursive=True))
    # CHANGELOG / RELEASE-EVIDENCE legitimately QUOTE the rejected statement as captured
    # test output; the guard targets live guidance (agents, skills, README, INSTALL, DECISIONS).
    skip_names = {"CHANGELOG.md", "RELEASE-EVIDENCE.md"}
    for f in md:
        if is_internal(f) or os.path.basename(f) in skip_names:
            continue
        txt = open(f, encoding="utf-8", errors="ignore").read()
        for sentence in _re.split(r"(?<=[.\n])", txt):
            if not (tool.search(sentence) and ext.search(sentence)):
                continue
            affirmative = verb.search(sentence) or nounclaim.search(sentence)
            if affirmative and not hardneg.search(sentence):
                errors.append(f"{_rel(f, root)}: overstated extension claim — 'validate_theme' "
                              f"must not be described as validating extension configuration "
                              f"(sentence: {sentence.strip()[:100]!r})")


def check_references(root):
    """Every plugin-relative path referenced in a skill/agent body must resolve."""
    import re
    existing = set()
    for dp, _, fs in os.walk(root):
        for f in fs:
            existing.add(os.path.relpath(os.path.join(dp, f), root).replace("\\", "/"))
    pat = re.compile(r'`([A-Za-z0-9_./-]+\.(?:md|json|ts|tsx|js|jsx|sh|py|yml|yaml|toml))`')
    PRE = ("skills/", "agents/", "tools/", "reference/", ".github/", "tests/")
    docs = glob.glob(os.path.join(root, "skills", "**", "*.md"), recursive=True) + \
        glob.glob(os.path.join(root, "agents", "*.md"))
    for d in docs:
        if is_internal(d):
            continue
        base = os.path.dirname(os.path.relpath(d, root)).replace("\\", "/")
        txt = open(d, encoding="utf-8").read()
        for m in set(pat.findall(txt)):
            mm = m.lstrip("./")
            if not mm.startswith(PRE):
                continue
            # resolve relative to plugin root OR relative to the doc's own dir
            if mm in existing:
                continue
            alt = (base + "/" + mm).replace("//", "/") if base else mm
            if alt in existing:
                continue
            errors.append(f"{_rel(d, root)}: broken reference '{m}'")


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "..")
    root = os.path.abspath(root)
    if not os.path.isdir(os.path.join(root, ".claude-plugin")):
        print(f"ERROR: {root} is not a plugin root (no .claude-plugin/)")
        return 2

    check_manifest(root)
    for p in glob.glob(os.path.join(root, "skills", "**", "SKILL.md"), recursive=True):
        if not is_internal(p):
            check_skill(p)
    for p in glob.glob(os.path.join(root, "agents", "*.md")):
        if not is_internal(p):
            check_agent(p)
    check_references(root)
    check_agent_wiring(root)
    check_dir_references(root)
    check_preload_tokens(root)
    check_mcp(root)
    check_extension_wording(root)

    print(f"validate-plugin: checked {checked} documents under {_rel(root)}")
    if warnings:
        print(f"\n{len(warnings)} warning(s):")
        for w in warnings:
            print(f"  WARN {w}")
    if errors:
        print(f"\n{len(errors)} error(s):")
        for e in errors:
            print(f"  ERROR {e}")
        return 1
    print("OK: zero errors.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
