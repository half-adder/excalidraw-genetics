#!/usr/bin/env bash
# Regression test: a genotype crossed with three siblings in the same row
# ("chain + x beside the rest"). Fixture three-partners: P1 x P2 -> A (male)
# and B, C, D (females), then B x A -> E, C x A -> F, D x A -> G. Scrambles
# every genotype's position, runs Tidy with nothing selected, and checks
#   1. no two genotypes overlap (frames, which cover labels),
#   2. no genotype overlaps a cross glyph that is not its own,
#   3. no two cross glyphs overlap,
#   4. a second Tidy moves nothing.
# Prints PASS/FAIL per check; exit 0 only if all pass.
source "$(dirname "$0")/lib.sh"
fly_test <<'JS'
await T.fixture('three-partners');
T.setup(['P1', 'P2', 'A', 'B', 'C', 'D', 'E', 'F', 'G']);
// Scramble: every genotype (with its label) to a fixed, shuffled spot, A far
// right of its partners and offspring out of order.
await F.move({ P1: [300, 0], P2: [-200, 0], A: [900, 200], B: [100, 200], C: [-300, 200], D: [500, 200], E: [700, 420], F: [-100, 420], G: [250, 420] });
await T.tidyAll();
T.check(F.overlaps());
T.check(F.foreignX());
T.check(F.xOverlap());
T.out(F.layout());
await T.unmoved('second Tidy', T.tidyAll);
JS
