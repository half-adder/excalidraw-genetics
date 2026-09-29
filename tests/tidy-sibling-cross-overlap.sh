#!/usr/bin/env bash
# Regression test: when two siblings are crossed with each other and a third
# sibling is not in that cross, Tidy must not place the third sibling on top
# of the x between the crossed pair. Fixture sibling-cross: P1 x P2 -> A, B,
# C, then A x B -> D. Puts C between A and B, runs Tidy, and checks that no
# genotype overlaps a cross glyph and that a second Tidy moves nothing.
# Prints PASS/FAIL per check; exit 0 only if all pass.
source "$(dirname "$0")/lib.sh"
fly_test <<'JS'
await T.fixture('sibling-cross');
T.setup(['P1', 'P2', 'A', 'B', 'C', 'D']);
// Put C between A and B (the pair that is crossed), then Tidy everything.
await F.move({ C: [(F.cx('A') + F.cx('B')) / 2 - F.cx('C'), 0] }, false);
await T.tidyAll();
T.check(F.foreignXAlleles());
await T.unmoved('second Tidy', T.tidyAll);
JS
