#!/usr/bin/env bash
# Runs every test in tests/ one after another (they share the Obsidian
# window), printing a PASS/FAIL line with the duration of each. The shared
# throwaway drawing stays open between tests and is trashed at the end.
# Exit status: 0 only if every test passed. Set VERBOSE=1 to see each
# test's own output.
set -uo pipefail
TESTS="$(cd "$(dirname "$0")" && pwd)"
source "$TESTS/lib.sh"
set +e
export FLY_KEEP=1
finally() {   # trash the shared drawing, waiting for it
  FLY_KEEP=0 fly_test >/dev/null <<<"T.check('PASS: cleanup');" || echo "warning: final cleanup failed"
}
trap finally EXIT
now() { perl -MTime::HiRes=time -e 'printf "%.1f", time'; }
failed=0
start=$(now)
for t in "$TESTS"/*.sh; do
  name=$(basename "$t" .sh)
  case "$name" in lib|run-all|make-fixtures) continue ;; esac
  t0=$(now)
  out=$(bash "$t" 2>&1); rc=$?
  dt=$(perl -e "printf '%.1f', $(now) - $t0")
  if ((rc == 0)); then printf 'PASS  %-30s %5ss\n' "$name" "$dt"
  else printf 'FAIL  %-30s %5ss\n' "$name" "$dt"; failed=1; fi
  if ((rc != 0)) || [[ -n "${VERBOSE:-}" ]]; then printf '%s\n' "$out" | sed 's/^/      /'; fi
done
printf 'total %.1fs\n' "$(perl -e "print $(now) - $start")"
exit $failed
