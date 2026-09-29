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
# The splitDuplicateGenotypes block (banner to the function's closing brace)
# must be byte-identical across exactly the 7 scripts that define the
# function; any script defining the function without the banner is a fail
# too. No Obsidian needed.
t0=$(now)
REQUIRED_DUP_SCRIPTS=("Tidy.md" "Cross Genotypes.md" "Cross Mode.md" "Genotype.md" "Select Below.md" "Select Lineage.md" "Break Cross.md")
dup_check() {   # $1 = scripts dir; prints "PASS"/"FAIL" + detail lines
  local scripts_dir="$1" problems="" sums="" n=0
  for f in "$scripts_dir"/*.md; do
    grep -q '^async function splitDuplicateGenotypes' "$f" || continue
    grep -q '^// ---- Duplicated genotypes' "$f" \
      || problems+="defines splitDuplicateGenotypes without the banner: $(basename "$f")"$'\n'
  done
  for name in "${REQUIRED_DUP_SCRIPTS[@]}"; do
    f="$scripts_dir/$name"
    if [[ ! -f "$f" ]]; then
      problems+="missing required script: $name"$'\n'; continue
    fi
    if ! grep -q '^// ---- Duplicated genotypes' "$f"; then
      problems+="required script missing the banner: $name"$'\n'; continue
    fi
    sum=$(awk '/^\/\/ ---- Duplicated genotypes/{on=1} on{print} on&&/^async function splitDuplicateGenotypes/{fn=1} fn&&/^}/{exit}' "$f" | shasum | cut -d' ' -f1)
    sums+="$sum  $name"$'\n'
    n=$((n + 1))
  done
  if [[ -z "$problems" ]] && ((n == ${#REQUIRED_DUP_SCRIPTS[@]})) \
    && (($(printf '%s' "$sums" | cut -d' ' -f1 | sort -u | wc -l) == 1)); then
    echo "PASS"
  else
    echo "FAIL"
    printf '%s' "$problems$sums" | sed '/^$/d; s/^/      /'
  fi
}
result=$(dup_check "$TESTS/../scripts")
dt=$(perl -e "printf '%.1f', $(now) - $t0")
if [[ "$(head -1 <<<"$result")" == "PASS" ]]; then
  printf 'PASS  %-30s %5ss\n' "duplicate-helper-sync" "$dt"
else
  printf 'FAIL  %-30s %5ss\n' "duplicate-helper-sync" "$dt"; failed=1
  tail -n +2 <<<"$result"
fi
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
