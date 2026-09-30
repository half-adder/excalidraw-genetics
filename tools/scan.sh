#!/usr/bin/env bash
# Pre-publish scan: fail if any tracked text file, or the text embedded in the
# built installer, or the built main.js, matches a term from the maintainer's private blocklist
# (one case-insensitive term per line; default ~/.config/fly-genetics/blocklist.txt).
# The list itself is never stored in this repo.
set -euo pipefail
cd "$(dirname "$0")/.."
LIST="${FLY_BLOCKLIST:-$HOME/.config/fly-genetics/blocklist.txt}"
[[ -s "$LIST" ]] || { echo "scan: no blocklist at $LIST"; exit 2; }
pattern=$(grep -v '^\s*$' "$LIST" | paste -sd'|' -)
# npm integrity hashes in package-lock.json are random base64 and can contain
# a short blocklist term by chance; they are skipped (only those lines).
hits=$(git ls-files -z | grep -zv '\.ttf$' | grep -zv '^dist/' | xargs -0 grep -I -i -n -E "$pattern" | grep -v -E '^package-lock\.json:[0-9]+: *"integrity": "sha[0-9]+-[A-Za-z0-9+/=]+",?$' || true)
installer=$(uv run --no-project python - "$pattern" <<'PY'
import json, re, sys
s = open("dist/Install Fly Genetics.md").read()
i = s.index("const PAYLOAD = ") + len("const PAYLOAD = ")
p = json.loads(s[i:s.index("\n", i)].rstrip(";"))
text = s[: s.index("const PAYLOAD")] + "\n".join(p["scripts"].values()) + p["license"]["text"]
print("\n".join(m.group(0) for m in re.finditer(r"(?i).{0,20}(" + sys.argv[1] + r").{0,20}", text)))
PY
)
# The built plugin (main.js, not tracked), freshly built from this checkout:
# its text, with the embedded font (esbuild's binary loader) stripped first,
# since random base64 can contain a short term by chance, as with the
# integrity hashes. Only the font is stripped: main.js must hold exactly one
# long base64 run, and it must be exactly fonts/cmu-serif-500-roman.ttf.
npm run build --silent >/dev/null || { echo "scan: FAIL (npm run build)"; exit 1; }
text=$(node -e '
const fs = require("fs");
const js = fs.readFileSync("main.js", "utf8"), font = fs.readFileSync("fonts/cmu-serif-500-roman.ttf").toString("base64");
const runs = js.match(/[A-Za-z0-9+\/=]{200,}/g) ?? [];
if (runs.length !== 1 || runs[0] !== font) { console.error(`main.js: expected exactly one long base64 run, the font (${font.length} chars); found ${runs.length}: ${runs.map((r) => r.length).join(", ")}${runs.length === 1 ? " (not the font)" : ""}`); process.exit(1); }
process.stdout.write(js.replace(font, ""));
') || { echo "scan: FAIL"; exit 1; }
bundle=$(grep -o -i -E ".{0,20}($pattern).{0,20}" <<<"$text" || true)
if [[ -n "$hits$installer$bundle" ]]; then
  echo "scan: FAIL"; [[ -n "$hits" ]] && echo "$hits"; [[ -n "$installer" ]] && echo "installer: $installer"; [[ -n "$bundle" ]] && echo "main.js: $bundle"; exit 1
fi
echo "scan: PASS ($(git ls-files | wc -l | tr -d ' ') tracked files + installer text + main.js text)"
