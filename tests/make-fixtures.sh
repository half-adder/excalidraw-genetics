#!/usr/bin/env bash
# Rebuilds fixture scenarios (tests/scenarios.js) through Genotype and Cross
# Genotypes and saves each as tests/fixtures/<scenario>.json, plain JSON with
# one element per line ({hash, names, buildErrors, elements}: the
# hash of the scripts and build steps, scenario name -> genotypeId, errors
# the scripts threw while building, and the scene). Tests rebuild a missing
# or stale fixture on their own; this forces a rebuild.
# Usage: make-fixtures.sh [scenario...]   (default: all)
source "$(dirname "$0")/lib.sh"
list=""
for s in "$@"; do list+="'$s',"; done
fly_test <<JS
const names = [$list].length ? [$list] : Object.keys(window.__flyScenarios);
for (const s of names) {
  if (!window.__flyScenarios[s]) throw new Error('unknown scenario ' + s);
  await T.buildFixture(s);
}
T.check('PASS: built ' + names.join(', '));
JS
