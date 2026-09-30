# Cross Genotypes: offspring picker

Design doc for replacing the typed offspring shorthand in `scripts/Cross Genotypes.md` with a form that lists every offspring combination the two parents can produce. Companion to `2026-09-28-genotype-form-editor-design.md` (form conventions and drawing style).

---

## Goals

1. Choose an offspring by picking, per chromosome, one mother × father homolog pair. No typing of genotypes.
2. Keep everything else the script does today: parent detection, `parents` stamping, cross glyph, lineage arrow, optional label and criterion, auto-Tidy.
3. Draw the offspring in the same style as `Genotype`, and keep that style when Tidy redraws the cross.

## Non-goals

- Recombinant chromosomes. Every option is an unmodified maternal homolog over an unmodified paternal homolog.
- Allele knowledge (which alleles are balancers, dominant markers, recessive lethal). No reordering by allele identity, filtering or lethality flags. See Future work. (Text-identity merging of duplicate/flipped cards is in scope; see Options below.)

---

## Unchanged behavior

- Selection must contain elements of exactly two genotypes.
- Mother and father come from the sex glyphs (♀/☿ maternal, ♂ paternal), falling back to leftmost = maternal.
- After commit: offspring elements carry `parents: { maternal, paternal }`; a `cross-glyph` is created or reused; a `cross-lineage` arrow is drawn; optional `genotype-label` and `cross-criterion` elements are created; Tidy runs on the lineage.

## Reading the parents

Parent alleles come from `genotype-allele` elements, using `originalText` (then `rawText`, then `text`).

Per chromosome, each parent contributes two homologs:

| Parent chromosome | Homologs |
|---|---|
| `top` / `bottom` | `[top, bottom]` |
| `single` on an autosome, or on the mother's X | `[single, single]` |
| `single` on the father's X | `[single, "Y"]` |
| Missing (father's X) | `["+", "Y"]` |
| Missing (any other) | `["+", "+"]` |

The father's X homolog list is split into his X homologs (everything except `Y`) and `Y`. If his X is written `yw/Y`, his X is `yw`.

## Options

For each autosome (II, III), the options are every maternal homolog × every paternal homolog, in order: mother homolog 1 × father homolog 1, 1 × 2, 2 × 1, 2 × 2. Maternal homolog on top. Cards that are identical, or that differ only in which parent gave which homolog (`CyO/+` and `+/CyO` are the same genotype), are merged into one card: the first occurrence in that order is kept and later duplicates/flips are dropped. A homozygous parent no longer produces duplicate-looking cards.

X always lists daughters, then sons, then both-sex combos: each maternal X × each paternal X (female), each maternal X × `Y` (male), then each maternal X over `<paternal X> or Y` (both; drawn literally, e.g. `FM7a` over `w or Y`). Sons and combos are listed only when the father has a `Y`. The same merge rule applies within each of the three groups (daughters, sons, both-sex combos) independently; a card is never merged with a card of a different sex tag.

Sex and the X card are kept consistent:

| Action | Effect |
|---|---|
| Select a male X card | Sex becomes ♂. |
| Select a female X card | Sex becomes ♀, unless it is ☿, which is kept. |
| Select a both-sex combo card | Sex becomes ⚥. |
| Select ♂ / ♀ or ☿ / ⚥ | If the X card is of another kind, X moves to the first male / female / combo card. |
| Select none | X unchanged. |

On open, the sex is set from the first X card (♀).

Chromosome IV is not shown. It is drawn only if a parent has it, using the first option (mother homolog 1 over father homolog 1).

## The form

An Obsidian `Modal`, styled like `Genotype`:

1. **Header:** both parents drawn as they appear on the canvas, `♀ <mother>  ×  ♂ <father>`: sex glyph, each chromosome as top over a bar over bottom (bare chromosomes stay bare), `;` between chromosomes. Directly under the parents, an **Offspring preview** shows the offspring as it will be drawn, updated on every pick. A divider line separates the parents from the Offspring label.
2. **Sex column** on the left, vertically centered on the card area: ♂ ♀ ☿ ⚥ none, one active, linked to the X card as described under Options.
3. **Option columns** X, `;`, II, `;`, III. Each column is a vertical stack of cards. A card is a small fraction (maternal homolog, 2 px bar, paternal homolog), centered. The selected card is highlighted. Default: first card in each column.
4. **Label** and **Criterion** text inputs below the columns.
5. OK and Cancel.

### Keyboard

| Key | Behavior |
|---|---|
| ↑ / ↓ | Previous / next card in the focused column. |
| ← / → , Tab / Shift+Tab | Previous / next column (X, II, III), then the Label and Criterion inputs. |
| F | Flip a card (swap top and bottom): the card under the mouse, or, with no card under the mouse, the focused column's selected card. Flipping also selects the card. Per card, lasts while the picker is open (press again to flip back). X cards that carry a Y (sons, and "X or Y" both-sex cards) never flip. Ignored while typing in the Label or Criterion inputs, or with Cmd/Ctrl/Alt held. |
| Enter | Commit. |
| Esc | Close without changes. |

Clicking a card selects it and focuses its column.

## Drawing

The offspring is drawn with `Genotype`'s style: Computer Modern via Excalidraw's Local Font (font family 4, Helvetica fallback), sex glyph in Helvetica, `roughness: 0`, `FRACTION_GAP` 5. Every chosen pair is drawn as a fraction (top = maternal, bottom = paternal), including identical pairs.

Cross furniture, in both `Cross Genotypes` and Tidy: the `x` glyph uses Virgil (font family 1), for a hand-drawn look. Lineage arrows are elbow arrows (`elbowed: true`): a single vertical segment when the child sits directly under the `x`, otherwise down, across at the vertical midpoint, and down. Each arrow is bound at both ends so it follows when either end moves: start to the `x` glyph at its bottom middle (`fixedPoint [0.5, 1]`), end to the offspring's invisible `genotype-frame` at its top middle (`[0.5, 0]`). The frame covers the offspring and its label (see the Genotype design doc). Grouping a whole cross was considered and not done: plain groups would make single-genotype selection need a double-click and would merge multi-generation pedigrees into one group; Excalidraw frames are the candidate if one-drag moves of a whole cross are wanted.

## Tidy

Tidy regenerates genotype elements with its own copy of the drawing code (Virgil, `FRACTION_GAP` 2, default roughness). Its style constants and glyph font are changed to match `Genotype`, so Tidy no longer restyles genotypes drawn by `Genotype` or `Cross Genotypes`. Only style lines change; Tidy's layout logic is untouched. Verified 2026-09-28: after a cross, both parents and the offspring have allele font family 4, glyph font family 2 and fraction roughness 0.

**Tidy moves things as little as possible.** After computing the relative layout of a lineage, Tidy translates it by the per-axis median of each genotype's offset (pre-Tidy position minus laid-out position), which minimizes total movement. Genotypes already in formation stay put and stray ones move back; the lineage no longer follows whichever genotype was selected or dragged last. Verified 2026-09-28 on a two-generation cross (5 genotypes): dragging F2 by (+250, +120) and running Tidy with F2 selected returned F2 to its place with every other genotype at 0 px offset; a second run moved nothing; moving three of the five genotypes by (-200, +80) brought the other two along, keeping the cross intact at the new spot.

**Tidy with nothing selected tidies every lineage.** With a genotype element selected, Tidy works on that genotype's lineage as before. With nothing selected, it runs once per lineage in the drawing, one lineage at a time (founders are used as seeds, but placement follows the median rule above). Verified 2026-09-28 in a throwaway drawing with a two-generation cross, a second cross and a lone genotype: two consecutive Tidy runs moved nothing (67 elements); a displaced offspring was returned exactly to its tidy position by tidy-all; with a founder of one lineage selected, only that lineage was tidied; each genotype kept exactly one frame and each arrow stayed bound (0 px offset) at both ends.

## Test hook

`window._crossGenotypesAuto` stays, with a new shape (consumed on read):

```js
window._crossGenotypesAuto = {
  offspringGlyph: "♀",          // or null
  pick: { X: 0, II: 2, III: 1 }, // option index per chromosome
  labelText: "",                 // optional
  criterionText: "",             // optional
};
```

`window._crossGenotypesOptions` is set to `{ X: [...], II: [...], III: [...] }` (each option `{ top, bottom }`) for the sex in effect, so tests can check the enumeration. While the modal is open, `window._crossGenotypesModal` exposes `{ modal, state }`.

## Testing

On `Excalidraw/_test-scratch.md`:

1. **Enumeration.** Two parents built with `Genotype`; check the option lists for II and III (4 each, correct order) and X for ♀, ♂ and none, including a bare father X (`w` gives `w` and `Y`) and a missing chromosome (`+/+`).
2. **Commit.** Pick by index through the hook; check the offspring alleles, `parents`, cross glyph, lineage arrow, label and criterion.
3. **Style after Tidy.** Offspring and both parents use font family 4 (glyphs 2) and fraction lines have roughness 0 after auto-Tidy.
4. **Keyboard.** ↑/↓ change the selection within a column; ←/→ and Tab move between columns; changing sex rebuilds X.
5. **Visual.** Screenshot the form and the resulting cross.

## Future work

- **Allele vocabulary.** Record per-allele facts (balancer, dominant markers, recessive lethal, chromosome) so the picker can put balancers on the bottom, flag lethal combinations such as `CyO/CyO`, and suggest selection criteria from markers. Candidate home: one vault note per feature with frontmatter plus a Base as the editing view, shareable with DrosCross's feature vocabulary. Deferred by the user on 2026-09-28.
- **Recombinants.** A per-chromosome option for recombinant homologs from the mother.
