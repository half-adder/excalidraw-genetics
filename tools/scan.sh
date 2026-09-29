#!/usr/bin/env bash
# Pre-publish scan: fail if any tracked text file, or the text embedded in the
# built installer, matches a term from the maintainer's private blocklist
# (one case-insensitive term per line; default ~/.config/fly-genetics/blocklist.txt).
# The list itself is never stored in this repo.
set -euo pipefail
cd "$(dirname "$0")/.."
LIST="${FLY_BLOCKLIST:-$HOME/.config/fly-genetics/blocklist.txt}"
[[ -s "$LIST" ]] || { echo "scan: no blocklist at $LIST"; exit 2; }
pattern=$(grep -v '^\s*$' "$LIST" | paste -sd'|' -)
hits=$(git ls-files -z | grep -zv '\.ttf$' | grep -zv '^dist/' | xargs -0 grep -I -i -n -E "$pattern" || true)
installer=$(uv run --no-project python - "$pattern" <<'PY'
import json, re, sys
s = open("dist/Install Fly Genetics.md").read()
i = s.index("const PAYLOAD = ") + len("const PAYLOAD = ")
p = json.loads(s[i:s.index("\n", i)].rstrip(";"))
text = s[: s.index("const PAYLOAD")] + "\n".join(p["scripts"].values()) + p["license"]["text"]
print("\n".join(m.group(0) for m in re.finditer(r"(?i).{0,20}(" + sys.argv[1] + r").{0,20}", text)))
PY
)
if [[ -n "$hits$installer" ]]; then
  echo "scan: FAIL"; [[ -n "$hits" ]] && echo "$hits"; [[ -n "$installer" ]] && echo "installer: $installer"; exit 1
fi
echo "scan: PASS ($(git ls-files | wc -l | tr -d ' ') tracked files + installer text)"
