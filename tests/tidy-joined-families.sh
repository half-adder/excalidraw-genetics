#!/usr/bin/env bash
# Regression test: two families joined by a cross between a child of one and
# a grandchild of the other. Fixture joined-families:
#   family 1: P1 x P2 -> A, B; A x P3 -> C (C is a grandchild, row 2),
#   family 2: Q1 x Q2 -> D, E (row 1),
# then D x C -> F (D is pulled down to C's row). Scrambles every genotype's
# position, runs Tidy with nothing selected, and checks
#   1. every offspring has exactly one lineage arrow, bound from its parents'
#      x (starting at its bottom middle) to its own frame (ending at its top
#      middle),
#   2. no two genotypes overlap (frames, which cover labels),
#   3. no genotype overlaps a cross glyph that is not its own,
#   4. no two cross glyphs overlap,
#   5. no lineage arrow segment passes through a genotype frame other than
#      its own child's, and none is diagonal,
#   6. a second Tidy moves nothing.
# Prints PASS/FAIL per check; exit 0 only if all pass.
source "$(dirname "$0")/lib.sh"
fly_test <<'JS'
await T.fixture('joined-families');
T.setup(['P1', 'P2', 'A', 'B', 'P3', 'C', 'Q1', 'Q2', 'D', 'E', 'F']);
// Scramble: family 2 on the far left and interleaved rows, so the layout has
// to bring the families together on its own.
await F.move({ Q2: [-900, 300], Q1: [-400, -100], D: [600, 0], E: [-700, 500], P1: [500, -200], P2: [100, 100], A: [900, 400], B: [-100, 200], P3: [300, 600], C: [-300, 700], F: [800, -300] });
await T.tidyAll();
T.check(F.arrows({ pos: true }));
T.check(F.overlaps());
T.check(F.foreignX());
T.check(F.xOverlap());
T.check(F.cut({ diag: true }));
T.out(F.layout());
await T.unmoved('second Tidy', T.tidyAll);
JS
