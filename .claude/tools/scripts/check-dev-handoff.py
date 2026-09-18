#!/usr/bin/env python3
"""check-dev-handoff.py — hardened gate for a shopify-developer handoff (v0.1.8-beta.5).

Developer prose is NEVER proof. The handoff must reference a structured MCP evidence
artifact (`MCP-Evidence: <relative path>`) conforming to
tools/schemas/mcp-validation-evidence.schema.json. This checker enforces:

  * schema validity;
  * commit provenance (evidence commit == reviewed commit; stale/reused rejected);
  * path containment — MCP-Evidence, every validated_files[].path, every validation
    record_ref, and every gate output_ref must be RELATIVE and resolve (realpath,
    symlinks followed) INSIDE the reviewed project root; absolute paths, `..` traversal,
    symlink escapes, and missing files are rejected;
  * validator_type ↔ MCP tool mapping (graphql→validate_graphql_codeblocks,
    polaris-component→validate_component_codeblocks, theme→validate_theme);
    learn_shopify_api / search_docs_chunks are supporting calls, never a validator;
  * a STRUCTURED validation record (mcp-validation-record.schema.json), NOT free text —
    referenced by SHA-256, schema-validated, and bound to the validation by an EXACT
    match of tool_call_id, scoped tool, validator_type, and the SINGLE authoritative
    result.status (a VALID result must carry no blocking errors, and result.summary must
    not declare a contradicting status); the validator input is matched to the actual file
    content by SHA-256 (never a filename in text); tool_call_ref is unique per validation;
    graphql records carry the Dev MCP conversationId + api surface, bound to the evidence;
  * local gates: each runs its EXACT required package script (lint→npm run lint, etc.; no
    shell wrappers/operators/no-ops/alternatives), the captured log carries a
    __GATE_EXIT__ marker (written by run-gates.py) bound to the recorded exit_code, no
    output_ref is reused, and the output SHA-256 is recomputed and matched;
  * project binding: ${CLAUDE_PROJECT_DIR}/project.json is schema-validated and the
    evidence distribution_type + api_version must equal project.shopify.{distribution,api_version};
  * strict pass semantics (see EXIT CODES).

**Honest scope:** this is a *consistency-checked validation record* — the artifact, its
hashes and its structured record are mutually consistent and confined to the repo. It is
NOT an authenticated capture of a live Claude Code `shopify-developer` subagent invoking
the MCP; that is proven only by the mandatory interactive cold-session test
(tests/cold-plugin-discovery.md §9). No runtime provenance is authenticated or invented.

EXIT CODES:
  0 = ACCEPTED — may proceed to Code Review + QA. ONLY when ALL hold:
        distribution_type == "public"; overall_status == "VALID"; >=1 validation;
        every validation.status == "VALID"; lint/typecheck/tests/build all "pass";
        and every commit-provenance, path-containment, validator_type↔tool, file/record/
        gate-output hash, structured validation-record binding, gate-command + __GATE_EXIT__
        binding, and project.json distribution/api_version check passed.
  3 = BLOCKED  — honest blocked (overall BLOCKED, or out-of-scope custom/extension-only
        recorded as BLOCKED). Must NOT proceed.
  1 = REJECTED — anything else (INVALID, a failed/skipped gate, custom/ext + non-BLOCKED,
        contradictions, missing/stale/mismatched/escaping evidence).

Usage: check-dev-handoff.py <handoff-file> --commit <reviewed-sha> --root <project-dir>
                            [--schema <path>]
"""
import sys, os, re, json, hashlib, argparse

try:
    import jsonschema
except ImportError:
    print("REJECTED: python 'jsonschema' is required"); sys.exit(1)

BLOCK_MARKER = "blocked: shopify mcp validation not executed"
SCOPED_PREFIX = "mcp__plugin_webdesk-shopify-apps_shopify-dev-mcp__"
TYPE_TOOL = {
    "graphql": "validate_graphql_codeblocks",
    "polaris-component": "validate_component_codeblocks",
    "theme": "validate_theme",
}
NON_VALIDATOR_TOOLS = {"learn_shopify_api", "search_docs_chunks"}


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("handoff")
    ap.add_argument("--commit", required=True)
    ap.add_argument("--root", required=True, help="reviewed project root (${CLAUDE_PROJECT_DIR})")
    ap.add_argument("--schema", default=None)
    a = ap.parse_args()

    here = os.path.dirname(os.path.abspath(__file__))
    schema_path = a.schema or os.path.join(here, "..", "schemas", "mcp-validation-evidence.schema.json")
    record_schema_path = os.path.join(here, "..", "schemas", "mcp-validation-record.schema.json")
    project_schema_path = os.path.join(here, "..", "schemas", "project-json.schema.json")
    real_root = os.path.realpath(a.root)

    def reject(msg): print("HANDOFF REJECTED: " + msg); sys.exit(1)
    def blocked(msg): print("HANDOFF BLOCKED: " + msg + " — must NOT proceed to Code Review or QA."); sys.exit(3)

    def safe_resolve(rel, what):
        """Return realpath of a RELATIVE path confined to real_root, or reject."""
        if not isinstance(rel, str) or not rel:
            reject(f"{what}: empty path")
        if os.path.isabs(rel):
            reject(f"{what}: absolute paths are not allowed ({rel})")
        if ".." in rel.replace("\\", "/").split("/"):
            reject(f"{what}: '..' traversal is not allowed ({rel})")
        p = os.path.realpath(os.path.join(real_root, rel))
        if p != real_root and not p.startswith(real_root + os.sep):
            reject(f"{what}: path escapes the project root ({rel})")
        if not os.path.isfile(p):
            reject(f"{what}: file not found inside project root ({rel})")
        return p

    if not os.path.isfile(a.handoff):
        reject(f"handoff file not found: {a.handoff}")
    text = open(a.handoff, encoding="utf-8", errors="ignore").read()
    low = text.lower()

    has_not_exec = "not executed" in low
    has_pass_claim = re.search(r"\bpass(?:ed)?\b|\bapproved\b|proceed to (?:qa|code ?review|review)|ready for (?:qa|review)", low) is not None
    has_valid_claim = re.search(r"(?<![a-z])valid(?:ated)?\b", low) and not re.search(r"\binvalid\b", low)
    honest_block = BLOCK_MARKER in low

    m = re.search(r"MCP-Evidence:\s*(\S+)", text, re.IGNORECASE)
    if m is None:
        if honest_block and not (has_valid_claim or has_pass_claim):
            blocked("honest 'BLOCKED: SHOPIFY MCP VALIDATION NOT EXECUTED' (no MCP evidence, no success claim)")
        reject("no structured MCP evidence artifact referenced (`MCP-Evidence: <relative path>`). "
               "A bare tool-name claim or a typed 'Validation Summary' in prose is not evidence.")

    ev_path = safe_resolve(m.group(1), "MCP-Evidence")
    try:
        ev = json.load(open(ev_path, encoding="utf-8"))
    except json.JSONDecodeError as e:
        reject(f"MCP evidence is not valid JSON: {e}")

    try:
        schema = json.load(open(schema_path, encoding="utf-8"))
        jsonschema.validate(ev, schema)
    except jsonschema.ValidationError as e:
        reject(f"MCP evidence fails schema: {e.message} (at {'/'.join(str(p) for p in e.path)})")
    except Exception as e:
        reject(f"could not load evidence schema: {e}")

    overall = ev["overall_status"]
    dist = ev["distribution_type"]

    # commit provenance (stale / reused evidence)
    if ev["commit_sha"] != a.commit:
        reject(f"commit mismatch: evidence commit {ev['commit_sha']!r} != reviewed commit "
               f"{a.commit!r} (stale or reused evidence)")

    # local-gate binding: each gate must run its EXACT required package script (no shell
    # wrappers / operators / alternatives), and the captured log's own recorded exit code
    # (the __GATE_EXIT__ marker written by tools/scripts/run-gates.py) must match the metadata.
    REQUIRED_GATE_CMD = {"lint": "npm run lint", "typecheck": "npm run typecheck",
                         "tests": "npm test", "build": "npm run build"}
    exit_marker = re.compile(r"__GATE_EXIT__:(-?\d+)")
    gates = ev["local_gates"]
    seen_outputs = {}
    for g in ("lint", "typecheck", "tests", "build"):
        if g not in gates:
            reject(f"missing local-gate result: {g}")
        gg = gates[g]
        st, ec, cmd = gg["status"], gg["exit_code"], gg.get("command", "").strip()
        if cmd != REQUIRED_GATE_CMD[g]:
            reject(f"gate '{g}' command must be exactly '{REQUIRED_GATE_CMD[g]}' (no shell wrappers, "
                   f"operators, no-ops, or alternatives) — got {cmd!r}")
        oref = gg["output_ref"]
        if oref in seen_outputs:
            reject(f"gate '{g}' reuses the output_ref of gate '{seen_outputs[oref]}' ({oref})")
        seen_outputs[oref] = g
        op = safe_resolve(oref, f"gate '{g}' output_ref")
        if sha256_file(op) != gg["output_sha256"]:
            reject(f"gate '{g}' output hash mismatch ({oref}) — recorded hash does not match the file")
        marks = exit_marker.findall(open(op, encoding="utf-8", errors="ignore").read())
        if len(marks) != 1:
            reject(f"gate '{g}' output must contain exactly one __GATE_EXIT__ marker "
                   f"(produced by run-gates.py); found {len(marks)}")
        log_exit = int(marks[0])
        if log_exit != ec:
            reject(f"gate '{g}' captured log exit code {log_exit} != recorded exit_code {ec}")
        if st == "pass" and ec != 0:
            reject(f"gate '{g}' status=pass but exit_code={ec}")
        if st == "fail" and ec == 0:
            reject(f"gate '{g}' status=fail but exit_code=0")
        if st == "pass" and log_exit != 0:
            reject(f"gate '{g}' status=pass but the captured run exited {log_exit}")

    # load the structured validation-record schema once
    try:
        record_schema = json.load(open(record_schema_path, encoding="utf-8"))
    except Exception as e:
        reject(f"could not load validation-record schema: {e}")

    # per-validation: tool mapping, path containment, and a STRUCTURED validation record
    # whose single event object is bound to this validation (exact ids/tool/status; input by hash).
    seen_call_ids = set()
    for i, v in enumerate(ev.get("validations", [])):
        vt, tool = v["validator_type"], v["mcp_tool"]
        base = tool[len(SCOPED_PREFIX):] if tool.startswith(SCOPED_PREFIX) else tool
        if base in NON_VALIDATOR_TOOLS:
            reject(f"validation[{i}] uses supporting tool '{base}' as a validator "
                   f"(learn_shopify_api / search_docs_chunks are not validators)")
        expected = SCOPED_PREFIX + TYPE_TOOL.get(vt, "")
        if tool != expected:
            reject(f"validation[{i}] validator_type '{vt}' must use tool "
                   f"'{SCOPED_PREFIX}{TYPE_TOOL.get(vt, '?')}', not '{tool}'")
        # duplicate / reused tool-call id across validations
        if v["tool_call_ref"] in seen_call_ids:
            reject(f"validation[{i}] reuses tool_call_ref {v['tool_call_ref']!r} (each MCP call has a unique id)")
        seen_call_ids.add(v["tool_call_ref"])
        # validated files: recompute the real file hash (input is bound by hash, not filename)
        file_hashes = set()
        for hf in v["validated_files"]:
            fp = safe_resolve(hf["path"], f"validation[{i}] validated file")
            if sha256_file(fp) != hf["sha256"]:
                reject(f"validation[{i}] file hash mismatch for {hf['path']}")
            file_hashes.add(hf["sha256"])
        # structured validation record (NOT free text): resolve, hash, schema-validate, bind event
        rmeta = v["record"]
        rp = safe_resolve(rmeta["record_ref"], f"validation[{i}] record_ref")
        if sha256_file(rp) != rmeta["sha256"]:
            reject(f"validation[{i}] record hash mismatch ({rmeta['record_ref']})")
        try:
            rec = json.load(open(rp, encoding="utf-8"))
        except json.JSONDecodeError as e:
            reject(f"validation[{i}] record is not valid JSON: {e}")
        try:
            jsonschema.validate(rec, record_schema)
        except jsonschema.ValidationError as e:
            reject(f"validation[{i}] record fails record-schema: {e.message} "
                   f"(at {'/'.join(str(p) for p in e.path)})")
        evt = rec["event"]
        res = evt["result"]   # the SINGLE authoritative result (status/summary/errors)
        # bind the SAME event object's fields to this validation (all EXACT, no substring)
        if evt["tool_call_id"] != v["tool_call_ref"]:
            reject(f"validation[{i}] record tool_call_id {evt['tool_call_id']!r} != evidence tool_call_ref {v['tool_call_ref']!r}")
        if evt["tool"] != tool:
            reject(f"validation[{i}] record tool {evt['tool']!r} != evidence mcp_tool {tool!r}")
        if evt["validator_type"] != vt:
            reject(f"validation[{i}] record validator_type {evt['validator_type']!r} != evidence {vt!r}")
        if res["status"] != v["status"]:
            reject(f"validation[{i}] record result.status {res['status']!r} != evidence status "
                   f"{v['status']!r} (exact match required — no substring inference)")
        # a VALID result must carry NO blocking errors
        if res["status"] == "VALID" and res["errors"]:
            reject(f"validation[{i}] result.status is VALID but result.errors is non-empty "
                   f"({len(res['errors'])} error(s))")
        # summary is descriptive only — an explicit status label in it must not contradict result.status
        m_sum = re.search(r"(?:overall\s+)?status\s*[:=]\s*(VALID|INVALID|BLOCKED)", res["summary"], re.I)
        if m_sum and m_sum.group(1).upper() != res["status"]:
            reject(f"validation[{i}] result.summary declares status {m_sum.group(1).upper()} but "
                   f"result.status is {res['status']}")
        # input matched to actual file content by SHA-256, not by a filename appearing in text
        if set(evt["validated_input_sha256"]) != file_hashes:
            reject(f"validation[{i}] record validated_input_sha256 does not match the SHA-256 of the "
                   f"actual validated file content")
        # GraphQL: bind the Dev MCP conversationId (record <-> evidence) and require the api surface
        if vt == "graphql":
            ev_conv = v.get("conversation_id")
            if not ev_conv:
                reject(f"validation[{i}] (graphql) evidence is missing conversation_id")
            if evt.get("conversation_id") != ev_conv:
                reject(f"validation[{i}] (graphql) conversation_id mismatch: record "
                       f"{evt.get('conversation_id')!r} != evidence {ev_conv!r}")

    # ---- STRICT decision semantics (fail closed) ---------------------------------
    statuses = [v["status"] for v in ev.get("validations", [])]
    bad_gate = [g for g in ("lint", "typecheck", "tests", "build") if gates[g]["status"] != "pass"]

    # contradictions in prose
    if has_not_exec and has_pass_claim:
        reject("contradiction: handoff asserts NOT EXECUTED and PASSED simultaneously")
    if honest_block and overall != "BLOCKED":
        reject("contradiction: handoff says BLOCKED but evidence overall_status is not BLOCKED")
    has_block_word = re.search(r"\bblocked\b", low) is not None
    if has_block_word and (has_valid_claim or has_pass_claim) and overall != "BLOCKED":
        reject("contradiction: handoff asserts BLOCKED and VALID/passed simultaneously")

    # distribution: custom / extension-only may ONLY be an out-of-scope BLOCKED (exit 3)
    if dist != "public":
        if overall == "BLOCKED":
            blocked(f"distribution_type '{dist}' is out of scope (public App Store only) — recorded as BLOCKED")
        reject(f"distribution_type '{dist}' is out of scope and overall_status is '{overall}', not BLOCKED — "
               f"custom / extension-only work must never be ACCEPTED, only BLOCKED")

    if overall == "BLOCKED":
        blocked("evidence overall_status=BLOCKED")
    if overall == "INVALID":
        reject("overall_status=INVALID — must not proceed (a coherent INVALID is not approval)")
    # overall == VALID
    if not statuses:
        reject("overall_status VALID but no validations recorded")
    if any(s != "VALID" for s in statuses):
        reject("a validation status is not VALID while overall_status is VALID")
    if bad_gate:
        reject(f"local gate(s) not 'pass': {bad_gate} (a fail/skip must never proceed)")

    # B12: bind the accepted public evidence to the reviewed repo's project.json
    proj_path = os.path.join(real_root, "project.json")
    if not os.path.isfile(proj_path):
        reject("missing project.json in the reviewed project root (${CLAUDE_PROJECT_DIR}/project.json)")
    try:
        proj = json.load(open(proj_path, encoding="utf-8"))
    except json.JSONDecodeError as e:
        reject(f"project.json is not valid JSON: {e}")
    try:
        proj_schema = json.load(open(project_schema_path, encoding="utf-8"))
        jsonschema.validate(proj, proj_schema)
    except jsonschema.ValidationError as e:
        reject(f"project.json fails the project schema: {e.message}")
    except Exception as e:
        reject(f"could not load project schema: {e}")
    pshop = proj.get("project", {}).get("shopify", {})
    if ev["distribution_type"] != pshop.get("distribution"):
        reject(f"evidence distribution_type {ev['distribution_type']!r} != project.json "
               f"distribution {pshop.get('distribution')!r}")
    if ev["api_version"] != pshop.get("api_version"):
        reject(f"evidence api_version {ev['api_version']!r} != project.json api_version "
               f"{pshop.get('api_version')!r}")

    print(f"HANDOFF OK: consistency-checked validation record(s) — distribution=public, overall=VALID, "
          f"commit matches, {len(statuses)} validation(s) with matching tool/type/hashes and a structured "
          f"record bound by exact ids + input hash, all four gates verified against their captured output. "
          f"May proceed. NOTE: this is a consistency check, NOT authenticated runtime provenance — that a "
          f"live shopify-developer subagent actually invoked the MCP is proven only by the interactive "
          f"cold-session test.")
    sys.exit(0)


if __name__ == "__main__":
    main()
