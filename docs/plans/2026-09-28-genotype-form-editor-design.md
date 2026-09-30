# Genotype form editor

Design doc for a form-based script that creates and edits a single genotype without typing shorthand or LaTeX. Replaces `Build Genotype`. Independent of Cross Builder and Tidy.

---

## Goals

1. Edit any allele of an existing genotype by selecting the genotype and pressing one hotkey.
2. Create a new genotype through the same form, so there is one tool to learn.
3. Keep the script lightweight: no persistent sidepanel, no background event listeners, no layout engine beyond what `Build Genotype` already has.

## Non-goals

- Chromosome IV. The form shows X, II and III only.
- Labels, selection criteria, crosses, lineage. Cross Builder and Tidy own those.
- Double-click to open. Opening is hotkey-only (see Invocation).
- Live redraw while typing. The drawing updates on Enter only.
- Parsing shorthand. The form has one field per homolog, so the brace-aware `;` and `/` parser is not needed for form input.

---

## Invocation

The script is `scripts/Genotype.md`. It replaces `scripts/Build Genotype.md` (renamed with `git mv`). The vault symlink `Excalidraw/Scripts/Build Genotype.md` is replaced by `Excalidraw/Scripts/Genotype.md`.

Excalidraw registers the script as the command `obsidian-excalidraw-plugin:Genotype`. The user assigns it a hotkey in Obsidian Settings → Hotkeys.

Mode is chosen from the current selection when the script runs:

| Selection | Mode |
|---|---|
| At least one element whose `customData.genotypeId` is set | Edit the genotype of the first such element. If the selection spans more than one `genotypeId`, show a Notice naming the one being edited. |
| Nothing, or only elements without `genotypeId` | Create |

## Reading a genotype back (edit mode)

Collect the view elements whose `customData.genotypeId` matches **and** whose `kind` is one this script manages (`genotype-allele`, `genotype-fraction`, `genotype-separator`, `genotype-glyph`). Other elements sharing the id, such as Cross Builder labels and lineage, are never read, deleted or moved. Fill the form from the managed elements:

| Element | Form field |
|---|---|
| `kind: "genotype-allele"`, `side: "top"` | `<chromosome>` top |
| `kind: "genotype-allele"`, `side: "bottom"` | `<chromosome>` bottom |
| `kind: "genotype-allele"`, `side: "single"` | `<chromosome>` top; bottom left empty |
| `kind: "genotype-glyph"` | Sex-symbol selection (its text) |
| `kind: "genotype-fraction"`, `kind: "genotype-separator"` | Not read; regenerated on redraw |

The field value is the element's current text (`originalText`, falling back to `rawText`, then `text`), so edits made directly on the canvas are kept.

Alleles with `chromosome: "IV"` are not shown in the form and are carried through unchanged: the redraw keeps IV as it was. An allele element with no `chromosome` or `side` is skipped, and a Notice lists the skipped text.

The initially focused field is the one matching the selected element when that element is an allele. Otherwise it is X top. Focus is set one tick after `onOpen`, because `Modal.open()` focuses the first input after `onOpen` returns.

## The form

An Obsidian `Modal` (`ea.obsidian.Modal`) containing:

1. A vertical column of sex-symbol toggle buttons (♂ ♀ ☿ ⚥ and "none") to the left of the grid, centered on the fraction bars. Exactly one is active. The buttons are mouse-only; Tab and the arrows move between allele fields.
2. A grid laid out like the genotype: columns X, `;`, II, `;`, III; rows header, top allele, fraction bar, bottom allele. Each `;` spans the allele rows. Each fraction bar is a 2 px line the width of its column. Each chromosome's header row also carries a small, faint `⇅` flip button (mouse-only, `tabindex="-1"`), hidden/disabled when that chromosome can't flip.
3. Text in the inputs is centered. Each chromosome column is as wide as its longer allele (minimum 120 px plus padding) and updates as you type; the modal grows with it, up to 95% of the window width.
4. OK and Cancel buttons.

### Keyboard

| Key | Behavior |
|---|---|
| Tab / Shift+Tab | Next / previous field in reading order: X top, X bottom, II top, II bottom, III top, III bottom. |
| ↑ / ↓ | Move to the top / bottom field of the same chromosome. |
| ← / → | Move the text cursor. When the cursor is already at the start (←) or end (→) of the field, move to the same row of the previous / next chromosome. |
| Option+F (Alt+F) | Flip a chromosome: swap its top and bottom text. Acts on the chromosome under the mouse; with no hover, acts on the chromosome of the focused field, and focus follows the flipped text (same field position, same cursor offset). A chromosome with `Y` in either field, or with only one field filled, never flips. Matched on `e.code === "KeyF" && e.altKey` (no Cmd/Ctrl) since macOS reports `e.key` as `"ƒ"` for this combination; always `preventDefault`, so plain F and Shift+F still type normally. The `⇅` button beside a chromosome's header does the same flip on click. |
| Enter | Commit: redraw and close. |
| Esc | Close without changes. |

## Drawing

On commit, build the genotype with `Build Genotype`'s existing layout code (constants, fraction and separator placement, grouping). Input comes from the form fields instead of parsed shorthand. Per chromosome:

| Top | Bottom | Drawn as |
|---|---|---|
| filled | filled | `top` and `bottom` alleles with a fraction line |
| filled | empty | one `single` allele, no fraction line |
| empty | filled | one `single` allele from the bottom text |
| empty | empty | nothing; no separator for this chromosome |

Fields are trimmed before these rules are applied. The text is otherwise used as typed; commas, brackets and braces are not interpreted.

customData stays schema 2, with the same `kind`, `chromosome`, `side` and `after` fields `Build Genotype` writes today.

**Create mode** places the genotype at the free spot nearest `ea.getViewCenterPosition()`, with a new `genotypeId`. Candidate positions form a grid around the view center (steps of half the genotype width and its full height, 12 rings), tried in order of distance. The first position whose box clears every existing element's bounding box by 20 px wins. If none clears, it falls back to the view center.

**Binding frame.** Every genotype drawn by this script, `Cross Genotypes` or Tidy gets an invisible rectangle (`kind: "genotype-frame"`, transparent stroke and fill, 4 px padding) around its elements and its label, if any, in the same group. Lineage arrows bind to its top middle (`fixedPoint [0.5, 0]`). In edit mode the frame is **kept** (same id), not recreated, so bindings survive; it is resized to the new bounds, and every arrow whose `endBinding` points at it is re-routed (`lineagePoints`) to the new top middle. Verified 2026-09-28: after widening a bound offspring, the frame id was unchanged and the arrow end sat at the new top middle, still bound at both ends.

**Typography.** Allele text and `;` use Excalidraw's Local Font (font family 4), configured in Excalidraw settings as Computer Modern Serif (`Excalidraw/Fonts/cmu-serif-500-roman.ttf`, OFL, from the `computer-modern` npm package) to match LaTeX. The `.ttf` is used rather than `.woff2` because Excalidraw reads font metrics only from non-woff files. If the Local Font is disabled, the script uses Helvetica (family 2) and shows a Notice. The sex glyph always uses Helvetica, because Computer Modern lacks ♂, ☿ and ⚥. Fraction lines are drawn with `roughness: 0`.

**Edit mode** redraws in place:

1. Record the old genotype's anchor: the minimum `x` over its elements and the `midlineY` (the `y` of any fraction line, else the vertical center of the single-allele text).
2. Build the new elements with the same `genotypeId`, laid out from that left edge and midline instead of the view center.
3. Copy through any customData keys on the old elements that this script does not set (for example Cross Builder's `parents`), so crosses stay linked.
4. Give the new elements the old elements' `groupIds`, so outer groups (a genotype grouped with its label) survive. Create mode groups the new elements with `ea.addToGroup`.
5. Mark the old elements `isDeleted` in the same workbench batch as the new elements, and commit with one `addElementsToView` call.

Undo: one Cmd+Z restores the previous genotype. Verified 2026-09-28: after an edit, a single Cmd+Z restored all 12 original element ids with the old text.

## Edge cases

| Case | Behavior |
|---|---|
| All fields empty on Enter, create mode | Close; draw nothing. |
| All fields empty on Enter, edit mode | The form shows "All fields are empty. Press Enter again to delete this genotype." A second Enter deletes it; typing in any field clears the warning. |
| Selected genotype's elements have differing `groupIds` | The new elements take the `groupIds` of the first old element. |
| Schema 1 genotypes | Read the same way; redrawn as schema 2. |

## Test hook

Keep the repo's agentic test hook pattern with a new global, `window._genotypeAuto`, consumed on read:

```js
window._genotypeAuto = {
  glyph: "♀",                       // or null
  X:   { top: "yw, nanos-FLP", bottom: "Y" },
  II:  { top: "ubi-GFP, FRT40A", bottom: "ubi-GFP, FRT40A" },
  III: { top: "UAS-GFP", bottom: "TM6C" },
};
```

When set, the modal is skipped and these values are committed directly, using the same mode selection as an interactive run. A second hook, `window._genotypeFormProbe = true`, stores the form's initial state (mode, focused field, field values) in `window._genotypeFormState` and exits without opening the modal, for round-trip checks. While the real modal is open, `window._genotypeFormModal` exposes `{ modal, inputs, focusKey, labelInput, critInput, chromosomes, flipButtons }` for keyboard tests, where `chromosomes` and `flipButtons` are keyed by chromosome label (`"X"`, `"II"`, `"III"`): `chromosomes[chr]` is the hoverable wrapper element for Option+F, `flipButtons[chr]` its `⇅` button.

## Testing

All tests run on `Excalidraw/_test-scratch.md`, per the repo `CLAUDE.md`.

1. **Round-trip.** Create a genotype through the hook, select it, open the form through the probe hook, and check that the field values match the input.
2. **Edit in place.** Change III bottom from `TM6C` to `TM3`. Check that the `genotypeId`, left edge and midline are unchanged, the III fraction line width matches the new widest allele, and no old element ids remain.
3. **Bare and fraction.** Clear a bottom field and check that the fraction line for that chromosome is gone and the allele is `side: "single"`. Refill it and check that the fraction line returns.
4. **Carry-through.** Add a `parents` key to a genotype's elements, edit the genotype, and check that the key survives.
5. **Undo.** After an edit, one Cmd+Z restores the previous element set. `editor:undo` is the Markdown editor's command and does not reach Excalidraw; dispatch a `keydown` (`key: "z"`, `metaKey: true`) on the view's `.excalidraw` container instead.
6. **Keyboard.** Dispatch synthetic key events in the open modal and check focus movement for Tab, Shift+Tab, ↑, ↓, and ← / → at field edges and mid-field.
7. **Flip.** Dispatch a `keydown` with `code: "KeyF"`, `key: "ƒ"`, `altKey: true` while hovering a chromosome (mouseenter on `window._genotypeFormModal.chromosomes[chr]`) and check its fields swap; same key with no hover but a field focused, and check focus follows the swapped text at the same cursor offset; click `window._genotypeFormModal.flipButtons[chr]`; check a `Y`-bearing chromosome's button is hidden/disabled and Option+F on it is a no-op; check plain `f` still types (not `defaultPrevented`). `tests/genotype-form-flip.sh`.
8. **Visual.** Screenshot the modal and a redrawn genotype, and inspect both.
