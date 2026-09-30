# Shared helpers for the Obsidian-driven tests. A test sources this file and
# calls fly_test with its body: JavaScript (an async function body of T, the
# harness, and F, the checks) that runs inside Obsidian in one go.
#
#   source "$(dirname "$0")/lib.sh"
#   fly_test <<'JS'
#   await T.fixture('sibling-order');
#   await T.tidyAll();
#   T.check(F.overlaps());
#   JS
#
# The body runs in a shared throwaway drawing, Excalidraw/_test-harness.excalidraw.md,
# which is trashed afterwards (kept between tests when FLY_KEEP=1; run-all.sh
# trashes it at the end). T (tests/harness.js) loads fixtures, runs scripts
# and waits for them to finish; F (tests/checks.js) holds the invariant checks;
# tests/scenarios.js holds the fixture build steps. Output lines
# containing FAIL fail the test; so does a body that records no PASS line.
# Requires Obsidian running with a vault that has the fly-genetics plugin
# linked by tools/dev-install.sh (FLY_ENGINE=plugin, the default: T.run runs
# the plugin's commands, and fixtures are built and hashed with the src/
# files that determine what the fixture scenarios build, FIXTURE_SRC in
# harness.js) or these scripts in Excalidraw/Scripts
# (FLY_ENGINE=scripts, until the scripts are retired: fixtures are hashed with
# the scripts). FLY_FROZEN=1 loads fixtures as saved, without rebuilding
# stale ones.
set -euo pipefail

TESTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(dirname "$TESTS")"
[[ -z "${FLY_VAULT:-}" && -f "$HOME/.config/fly-genetics/env" ]] && source "$HOME/.config/fly-genetics/env"
[[ -n "${FLY_VAULT:-}" ]] || { echo "tests: set FLY_VAULT to your vault path (or put it in ~/.config/fly-genetics/env)"; exit 2; }
VAULT="$FLY_VAULT"
cd "$VAULT"

ENGINE="${FLY_ENGINE:-plugin}"
# The plugin engine runs this checkout's main.js: build it once per shell.
if [[ "$ENGINE" == plugin && -z "${FLY_BUILT:-}" ]]; then
  (cd "$REPO" && npm run build --silent >/dev/null) || { echo "FAIL: npm run build"; exit 1; }
  export FLY_BUILT=1
fi

ev() { obsidian eval code="$1" | sed "s/^=> //"; }

# Loads the harness files into Obsidian (global scope).
fly_load() {
  ev "(()=>{for(const f of ['checks.js','scenarios.js','harness.js'])(0,eval)(require('fs').readFileSync('$TESTS/'+f,'utf8'));return typeof window.__flyT?.start})()" | grep -q function \
    || { echo "FAIL: could not load the test harness into Obsidian"; exit 1; }
}

# Runs the test body read from stdin; prints its lines; exit 0 only if it
# printed at least one PASS line and no FAIL line.
fly_test() {
  local dir; dir=$(mktemp -d)
  trap "rm -rf '$dir'" EXIT
  cat >"$dir/body.js"
  fly_load
  ev "(()=>{window.__flyT.start({out:'$dir/out',body:'$dir/body.js',repo:'$REPO',keep:${FLY_KEEP:-0},engine:'$ENGINE',frozen:${FLY_FROZEN:-0}});return 1})()" >/dev/null
  local i
  for ((i = 0; i < 6000; i++)); do   # up to 5 minutes (a first run may build fixtures)
    [[ -f "$dir/out" ]] && grep -q '^END$' "$dir/out" && break
    perl -e 'select(undef,undef,undef,0.05)'
  done
  [[ -f "$dir/out" ]] && grep -q '^END$' "$dir/out" || { echo "FAIL: test did not finish"; return 1; }
  grep -v '^END$' "$dir/out"
  grep -q PASS "$dir/out" && ! grep -q FAIL "$dir/out"
}
