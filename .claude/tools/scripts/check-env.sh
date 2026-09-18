#!/usr/bin/env bash
# check-env.sh — verify local prerequisites for developing the Shopify app.
set -uo pipefail
ok=0
need(){ command -v "$2" >/dev/null 2>&1 && echo "  OK   $1 ($($2 --version 2>&1|head -1))" || { echo "  MISS $1"; ok=1; }; }
echo "Environment check:"
need "Node.js (>=22)" node
need "npm" npm
need "Shopify CLI" shopify
need "python3" python3
need "git" git
python3 -c "import jsonschema,yaml" 2>/dev/null && echo "  OK   python jsonschema+pyyaml" || { echo "  MISS python jsonschema/pyyaml (pip install jsonschema pyyaml)"; ok=1; }
[ "$ok" -eq 0 ] && echo "All prerequisites present." || echo "Missing prerequisites."
exit "$ok"
