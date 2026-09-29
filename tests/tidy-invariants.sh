#!/usr/bin/env bash
# Layout invariants for Tidy on a real drawing, without touching it: copies
# the saved elements of <drawing> (vault-relative path, default
# Excalidraw/_test-scratch.md) into the throwaway drawing, runs Tidy with
# nothing selected, and checks
#   1. no two genotypes overlap (frames, which cover labels),
#   2. no genotype overlaps a cross glyph that is not its own,
#   3. every offspring has exactly one lineage arrow, bound from its parents'
#      x to its own frame,
#   4. no lineage arrow segment passes through a genotype frame other than
#      its own child's,
#   5. a second Tidy moves nothing.
# Prints PASS/FAIL per check; exit 0 only if all pass.
SRC="${1:-Excalidraw/_test-scratch.md}"
source "$(dirname "$0")/lib.sh"
fly_test <<JS
await T.copyDrawing('$SRC');
await T.tidyAll();
T.check(F.overlaps());
T.check(F.foreignX());
T.check(F.arrows());
T.check(F.cut());
await T.unmoved('second Tidy', T.tidyAll);
JS
