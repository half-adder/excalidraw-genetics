# Changelog

Versions are release dates (`YYYY.M.D`, with `.2`, `.3` for more releases on the same day).

## 2026.9.30

- Undo is safe: every command (Genotype, Cross Genotypes, Cross Mode, Tidy, Tidy Below, Break Cross) is undone by one Cmd+Z, and redone by one Cmd+Shift+Z. Undoing a cross used to step through half-finished states, deleting whole lineages from view. Requires Excalidraw 2.20.2 or newer.
- The cross picker lists each offspring once: identical cards, and pairs that differ only in which parent gave which homolog (CyO/+ and +/CyO), are merged.
- In the cross picker, F flips the card under the mouse (or the selected card) top to bottom. Cards with a Y don't flip.
- In the Genotype form, Option+F flips the chromosome under the mouse (or the one being typed in), and each chromosome shows a flip button when hovered. Chromosomes with a Y don't flip.

## 2026.9.29.5

- Backcrosses: crossing an offspring with its own parent (or crossing a stock again in a later generation) draws a copy of that parent beside its new mate, so the original cross keeps both its parents. Tidy repairs drawings that already have this.
- A genotype copied with Cmd+D, copy/paste or alt-drag becomes its own genotype. Tidy used to merge the copies, deleting one. Copying a whole family (parents, their `x` and offspring together) keeps it a family.

## 2026.9.29.4

- Genotypes always show X, II and III: an empty chromosome is drawn as +/+ (so w ; +/+ ; MKRS/TM6B can't be misread). Tidy fills in missing chromosomes on older genotypes.
- Updating in a vault whose scripts are symbolic links (a development setup) leaves those scripts alone.
- README GIFs regenerated.

## 2026.9.29.3

- Cross Mode is one-shot: it turns off once the offspring is created (cancelling the picker keeps it on to try again).
- Leaving Cross Mode no longer leaves Excalidraw's tool lock switched on.
- README: illustrated tour, including selecting a sub-lineage and dragging it; corrected path to the script folder setting.

## 2026.9.29.2

- Versions are now dates, and "Update Fly Genetics" shows what changed.
- Updates are detected by content, so a release is never missed because of its version name.

## 2026.9.29

- First public release: Genotype editor, cross picker, Cross Mode, Tidy (with Tidy Below and selection tidy), Select Lineage / Below, Break Cross, one-file installer with a built-in updater, Computer Modern font.
