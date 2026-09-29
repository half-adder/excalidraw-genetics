# Changelog

Versions are release dates (`YYYY.M.D`, with `.2`, `.3` for more releases on the same day).

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
