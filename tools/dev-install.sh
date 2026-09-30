#!/usr/bin/env bash
# Links the built plugin (main.js, manifest.json, styles.css of this checkout)
# into the development vault and enables it. Marks the script migration and
# the font setup offer as declined there (its font is already set up): that vault's scripts are symlinks into a clone of this repo
# and must never be offered for the trash. Usage: tools/dev-install.sh
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
[[ -z "${FLY_VAULT:-}" && -f "$HOME/.config/fly-genetics/env" ]] && source "$HOME/.config/fly-genetics/env"
[[ -n "${FLY_VAULT:-}" ]] || { echo "dev-install: set FLY_VAULT (or put it in ~/.config/fly-genetics/env)"; exit 2; }
DIR="$FLY_VAULT/.obsidian/plugins/fly-genetics"
mkdir -p "$DIR"
for f in main.js manifest.json styles.css; do ln -sfn "$REPO/$f" "$DIR/$f"; done
[[ -f "$DIR/data.json" ]] || printf '{\n  "migration": "declined",\n  "font": "declined"\n}\n' >"$DIR/data.json"
# An older data.json without a "font" answer: add "font": "declined" (merged,
# not overwritten, so the saved migration answer is kept).
node -e 'const fs = require("fs"), p = process.argv[1], d = JSON.parse(fs.readFileSync(p, "utf8")); if (!("font" in d)) { d.font = "declined"; fs.writeFileSync(p, JSON.stringify(d, null, 2) + "\n"); }' "$DIR/data.json"
cd "$FLY_VAULT"
obsidian eval code="(async()=>{await app.plugins.loadManifests();await app.plugins.enablePluginAndSave('fly-genetics');return !!app.plugins.plugins['fly-genetics']})()"
