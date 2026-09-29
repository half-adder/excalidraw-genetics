#!/usr/bin/env bash
# Regression test: a genotype crossed with two of its siblings (A x B and
# A x C) must end up between them (B - A - C chain), so neither x lands on a
# genotype. Fixture sibling-chain: P1 x P2 -> A, B, C, then A x B -> D and
# A x C -> E. Puts A at the far right, runs Tidy, and checks that no genotype
# overlaps a cross glyph and that a second Tidy moves nothing.
# Prints PASS/FAIL per check; exit 0 only if all pass.
source "$(dirname "$0")/lib.sh"
fly_test <<'JS'
await T.fixture('sibling-chain');
T.setup(['P1', 'P2', 'A', 'B', 'C', 'D', 'E']);
// Put A at the far right (so a naive order leaves it at one end), then Tidy everything.
await F.move({ A: [Math.max(F.cx('B'), F.cx('C')) + 400 - F.cx('A'), 0] }, false);
await T.tidyAll();
T.check(F.foreignXAlleles());
await T.unmoved('second Tidy', T.tidyAll);
JS
