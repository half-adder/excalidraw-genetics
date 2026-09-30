# Fly Genetics as an Obsidian plugin: foundation

Design for moving Fly Genetics from Excalidraw Script Engine scripts to an Obsidian plugin, first as a like-for-like port. Tracker: epic `fly-fl9`. Later sub-projects build on this one: genotype actions and dashboard (`fly-9fo`), allele knowledge (`fly-7fv`).

---

## Why a plugin

- Shared code. Scripts cannot import each other, so helpers (the undo-safe transaction, the duplicate split) are copied into up to 7 scripts and kept identical by a check in `tests/run-all.sh`. A plugin has modules.
- UI the scripts cannot have: a settings tab (a user-editable action vocabulary), sidebar views (a daily dashboard), event hooks instead of polling.
- A domain model: an allele registry (balancers, dominant markers, recessive lethals) used by the picker, the Genotype form and Tidy.

## Goals

1. Every current script becomes a plugin command with the same name and behavior.
2. Every existing drawing keeps working with no conversion.
3. Labmates install and update through BRAT from the public GitHub repo.
4. The code is organized so the next two sub-projects add modules rather than copies.

## Non-goals

- New features. The foundation is a port; a behavior change is a bug unless a test documents it. Actions, dashboard and allele knowledge are separate sub-projects.
- Changing the drawing format.

## Prerequisite

The undo-safe scripts release (branch `undo-safe`) ships to labmates first. The plugin ports its operation discipline; it does not redesign it.

---

## Shape

- TypeScript, built with esbuild, following Obsidian's sample plugin layout. Plugin id `fly-genetics`, name "Fly Genetics".
- Lives in this repository. The scripts in `scripts/` are retired once the plugin passes the parity suite (below); until then both exist.
- Depends on the Excalidraw plugin and uses its ExcalidrawAutomate API. On load it checks that Excalidraw 2.20.2 or newer is installed and enabled, and otherwise shows a notice explaining what to install; its commands stay unavailable until then.
- No Node-only APIs (no `fs`, `path`, `child_process`), so it can run on mobile wherever Excalidraw does. `isDesktopOnly: false`.

## Modules

Each has one job and a small interface.

| Module | Responsibility |
|---|---|
| `schema` | The v2 `customData` format (kinds, fields, `schemaVersion: 2`) as types and validators. Unchanged from the scripts. |
| `scene` | Read a drawing: genotypes and their drawings, crosses (parent pairs, x glyphs, offspring), lineages, the lineage set of a selection. |
| `operation` | The undo-safe transaction: every scene write goes through it, nested commands join the running operation, one undo step per operation, rollback on error. Ported from the `undo-safe` branch. |
| `duplicates` | Duplicated genotypes become their own genotypes; copied families stay families. |
| `backcross` | A parent crossed on more than one row gets a copy per lower cross. |
| `layout` | The Tidy engine as pure functions: genotypes, crosses and sizes in, positions and arrow routes out. No Excalidraw calls. |
| `render` | Draw genotypes, labels, criteria, x glyphs and lineage arrows through `operation`. |
| `forms` | The Genotype form and the Cross Genotypes picker (including dedup and F / Option+F flipping). |
| `commands` | Genotype, Cross Genotypes, Cross Mode, Tidy, Tidy Below, Select Below, Select Lineage, Break Cross: each a thin composition of the modules above. |

Command display names match the script names; command ids are kebab-case (`fly-genetics:genotype`, `cross-genotypes`, `cross-mode`, `tidy`, `tidy-below`, `select-below`, `select-lineage`, `break-cross`). Hotkeys set on the old script commands must be assigned again once, in Obsidian's Hotkeys settings.

## Testing

- **Parity suite.** The existing Obsidian-driven tests (`tests/*.sh`, harness, fixtures) are ported to call the plugin's commands instead of the Script Engine. The port is complete when every current test passes unchanged, `tests/undo.sh` included. Fixture scenarios and their assertions do not change.
- **Unit tests.** Pure modules (`layout`, picker options in `forms`, `duplicates` and `backcross` rules on plain element arrays, `schema`) get Node unit tests with Vitest. These run in seconds and do not need Obsidian.
- The run-all sync and discipline checks for copied helpers are replaced by the module structure, plus one unit test that fails if any source file outside `operation` calls `updateScene`, `addElementsToView`, `deleteViewElements` or the history API.

## Distribution

- The public repository gets `manifest.json` and `versions.json` at its root, and each release is a GitHub release carrying `main.js`, `manifest.json` and `styles.css`. BRAT installs and updates from those releases.
- Release steps stay as in `CLAUDE.md`: private history on `main`, the orphan `public` branch pushed as the public `main`, `tools/scan.sh` before every push, and date-based versions in the form `YYYY.MDD.N` (for example `2026.929.0`, then `2026.929.1` the same day, and `2026.1001.0` on October 1). BRAT reads versions as semver and ignores a fourth part, so the scripts' `YYYY.M.D.2` scheme would hide a second same-day release. The installer note in `dist/` and "Update Fly Genetics" are retired after migration.

## Migration for labmates

1. The last scripts release's "What's new" tells labmates to install BRAT and add the Fly Genetics plugin.
2. On first load the plugin looks for Fly Genetics scripts in the Excalidraw script folder (by the installer's file names) and offers to move them to the trash, so each command does not appear twice. It never deletes without confirmation.
3. Drawings need no conversion: the plugin reads the same `customData`.
4. BRAT installs only the plugin files, so on first load, if the Computer Modern font or Excalidraw's local-font setting is missing, the plugin offers to set them up exactly as the scripts installer does today (never without confirmation). This is parity with the installer, not a new feature.

## Plugin watch (for later sub-projects)

Signals that already justified the plugin, kept as a checklist for features to come: a settings UI (action vocabulary, allele registry), a live sidebar view (dashboard), performance on large vaults (scanning drawings), mobile.
