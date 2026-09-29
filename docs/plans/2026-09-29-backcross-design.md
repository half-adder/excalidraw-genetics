# Tidy: parents crossed on more than one row

Design doc for drawing a backcross (an offspring crossed to its own parent) and, more generally, any genotype that is a parent in crosses on different rows. Builds on the duplicate-genotype fix (`splitDuplicateGenotypes`, test `tests/duplicate-genotype.sh`).

---

## Problem

Tidy places each genotype on the row where it is used (`computeDepths`, pass 2: a genotype's row is the deepest top-down depth among its co-parents). A genotype that is a parent in crosses on two rows can only be drawn on one of them. Tidy pulls it down to the lower row, and the cross on the upper row is left with one parent beside its x.

Example: P1 x P2 -> A, then A x P2 -> B. P2 is pulled down beside A; P1 x P2's x sits alone on row 0.

The same happens without a backcross: stock S crossed to an F1 and, later, to an unrelated F2.

## Goals

1. Crossing A with the original P2 draws a copy of P2 beside A for the backcross. P2 stays with P1.
2. Any genotype that is a parent on more than one row gets a copy for each cross below its highest row.
3. Drawings that already have the conflict are repaired by the next Tidy.

## Non-goals

- Linking the copy to the original. A copy is an independent founder: editing one does not change the other, and Select Lineage / Select Below do not follow a copy to the original's ancestry. This matches what a user-made duplicate (Cmd+D, copy/paste, alt-drag) becomes.
- New logic in Cross Genotypes or Cross Mode. Both already run Tidy after a cross and get the behavior from it.

---

## The rule

Runs in Tidy after `splitDuplicateGenotypes` and before `computeDepths`, over the lineage being tidied.

1. Compute top-down depths (pass 1 of `computeDepths`).
2. A cross is a pair of parents with at least one offspring (its x glyph and its offspring's `parents`). Its row is the larger top-down depth of its two parents, so a cross never needs copies of both. Only crosses whose parents are both in the lineage set count (in subset mode, the lineages of the subset's genotypes; see below).
3. For each genotype G, collect the rows of the crosses it is a parent in. If there is more than one distinct row:
   - G keeps its crosses on the smallest row (highest in the figure).
   - Every other cross of G gets its own copy of G. Two F1 sisters each crossed back to G give two copies, whether they were crossed one after the other or repaired in one Tidy; copies are unlinked, so nothing could tell a later cross which copy to reuse. To share one copy, cross the second sister with the existing copy: it is a founder on that row, so there is no conflict.
4. A copy has G's alleles, sex glyph and label, a fresh `genotypeId` (`crypto.randomUUID()`, as in `splitDuplicateGenotypes`), its own group, and no `parents`. G's `cross-criterion` belongs to the arrow into G and is not copied.
5. Rewire each moved cross: replace G's id with the copy's in the x glyph's `parents` and in the `parents` of every element of that cross's offspring. Lineage arrows are keyed by `childGenotypeId` and do not change.

Then layout runs unchanged. A copy is a founder (top-down depth 0), so pass 2 puts it on its co-parent's row, beside its partner.

One pass is enough. A copy has no parents and G keeps its own parents, so no top-down depth changes: an offspring of a moved cross gets its depth from its deeper parent, which is the partner, not G (G's cross was moved because the cross row is deeper than G's kept row).

## Where it applies

| Script | Behavior |
|---|---|
| Tidy (full) | Splits every conflict in the lineage. |
| Tidy Below, Tidy with several genotypes selected (subset) | Finds conflicts over the whole lineages of the subset's genotypes, but copies only for crosses inside the subset (both parents and every offspring in it); crosses outside it are left alone. Each copy joins the subset. A genotype that got a copy leaves the subset if it is no longer a parent in a cross inside the subset nor an offspring of one (it was there only as the moved cross's mate), so it stays where it is. |
| Cross Genotypes, Cross Mode | Record the cross with the original ids; the Tidy they start splits it. |

A second Tidy finds no conflicts and moves nothing.

## Tests

Written first, generic public alleles only, invariant checks from `tests/checks.js` (arrows, overlaps, foreignX, xOverlap, cut) plus "a second Tidy moves nothing" in each.

1. **Backcross** (fixture `backcross`): cross A with the original P2 -> B. Expect layout `P1 P2 | A P2' | B`, P2 drawn once on P1's row, B's father is the copy (a founder with P2's alleles, on A's row).
2. **Stock reused in a later generation**: P1 x P2 -> A, B; A x P3 -> C; S x B (row 1); S x C (row 2). S is not an ancestor of C. Expect S on row 1 beside B, a copy of S on row 2 beside C, and the S x B cross unchanged.
3. **Existing drawing**: a scene that already has the conflict (P2 used by both P1 x P2 and A x P2, built by rewriting the copy's id back to P2's and deleting the copy, as in the reported drawing). Expect one Tidy to produce the layout of test 1.
4. **Two sisters**: P1 x P2 -> A, C. A x P2 -> B, then C x P2 -> D. Expect two copies of P2 on the F1 row, one for each cross.
5. **Shared by choice**: A x P2 -> B, then C x (B's copy of P2) -> D. Expect one copy, the father of both B and D, and no new copy.
6. **Existing drawing, subset modes**: the scene of test 3, then Tidy Below on A, and Tidy with A, B and P2 selected. Expect the layout of test 1; with A, B and P2 selected, P1, P2 and their x do not move (P1 x P2 is outside the subset).
