# Fly Genetics plugin foundation: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the Fly Genetics Excalidraw Script Engine scripts to an Obsidian plugin (`fly-genetics`) with the same commands and behavior, verified by the existing Obsidian-driven tests calling the plugin's commands, and distributed through BRAT.

**Architecture:** A TypeScript plugin built with esbuild (Obsidian sample-plugin layout) that drives the Excalidraw plugin through ExcalidrawAutomate instances it creates per command. Code is split into the spec's modules (`schema`, `scene`, `operation`, `duplicates`, `backcross`, `layout`, `render`, `forms`, `commands`); pure modules are unit-tested with Vitest, and every scene write goes through `operation`, which ports the undo-safe transaction from `main` (after the `undo-safe` merge). The test harness gains a plugin engine so each existing `tests/*.sh` can run against either the scripts or the plugin until the scripts are retired.

**Tech Stack:** TypeScript 5, esbuild, Obsidian API (`obsidian` npm types), Excalidraw plugin 2.20.2+ (ExcalidrawAutomate via `window.ExcalidrawAutomate.getAPI(view)`), Vitest, bash + `obsidian` CLI for the Obsidian-driven parity suite, `uv run` for the existing Python tooling, `gh` for releases, BRAT for installs.

**Spec:** `git show main:docs/plans/2026-09-29-plugin-foundation-design.md` (approved). Undo-safe design: `docs/plans/2026-09-29-undo-safe-design.md` on `main` after the merge.

---

## Global Constraints

- Plugin id `fly-genetics`, name `Fly Genetics`. `isDesktopOnly: false`.
- Every current script becomes a plugin command whose display name is the script name and whose id is its kebab-case form: `genotype` ("Genotype"), `cross-genotypes` ("Cross Genotypes"), `cross-mode` ("Cross Mode"), `tidy` ("Tidy"), `tidy-below` ("Tidy Below"), `select-below` ("Select Below"), `select-lineage` ("Select Lineage"), `break-cross` ("Break Cross"); full ids `fly-genetics:<id>`, e.g. `fly-genetics:cross-genotypes`. Tests and code refer to commands by display name and map to ids with `commandId(name)` (plugin) or `cid(name)` (harness). No default hotkeys.
- No new features. The foundation is a port; a behavior change is a bug unless a test documents it. Element creation order, `customData` contents and Notice texts are ported unchanged.
- The drawing format does not change: `customData` schema v2 (`schemaVersion: 2`), read and written exactly as the scripts do. Existing drawings need no conversion.
- On load the plugin checks that Excalidraw 2.20.2 or newer is installed and enabled; otherwise it shows a Notice explaining what to install, and its commands stay unavailable.
- No Node-only APIs in `src/` (no `fs`, `path`, `child_process`, no `require`). Node APIs are allowed only in tests and tooling.
- Every scene write goes through `operation`: nested commands join the running operation, one undo step per operation, rollback on error. Ported from `main` after the `undo-safe` merge; not redesigned.
- A Vitest unit test fails if any source file outside `src/operation/` calls `updateScene`, `addElementsToView`, `deleteViewElements` or the history API.
- Parity suite: the existing `tests/*.sh` (harness, fixtures) are ported to call the plugin's commands and pass unchanged, `tests/undo.sh` included. Fixture scenarios and their assertions do not change. Only invocation plumbing changes (the harness engine switch, and `genotype-form-flip.sh`'s direct Script Engine call).
- Unit tests: Vitest, for `layout`, the picker options in `forms`, `duplicates` and `backcross` rules on plain element arrays, `schema` (plus `scene`, `render` geometry and `operation`'s pure helpers).
- Distribution: `manifest.json` and `versions.json` at the repository root; each release is a GitHub release carrying `main.js`, `manifest.json` and `styles.css`; BRAT installs and updates from those releases.
- Release flow unchanged: private history on `main`, the orphan `public` branch pushed as the public `main` (remote `public`), `tools/scan.sh` must PASS before every push, versions are release dates in the form `YYYY.MDD.N` (Sean's decision, replacing the spec's `YYYY.M.D` with `.2`, `.3`): year, month and two-digit day, then a release counter from 0, e.g. `2026.929.0`, `2026.929.1` the same day, `2026.1001.0` on October 1. Semver-compatible (BRAT orders them), any number of releases per day. Tags are `v<version>`; `CHANGELOG.md` headings are `## <version>`.
- Font: on first load, if the Computer Modern font or Excalidraw's local-font setting is missing, the plugin offers to set it up exactly as the scripts installer does (same files, same rules, same questions), never without confirmation.
- Migration: on first load the plugin looks for the installer's Fly Genetics script files in the Excalidraw script folder and offers to move them to the trash. It never deletes without confirmation.
- Never write an em dash (U+2014) anywhere: code, comments, docs, commit messages, Notices.
- Tests and fixtures use generic public alleles only (`w`, `y`, `yw`, `Sp`, `CyO`, `Gla`, `Bc`, `Sb`, `TM3`, `TM6B`, `MKRS`, `Y`, `+`).
- No research terms in the repository (it is published): nothing beyond the generic alleles above; `tools/scan.sh` checks tracked files against the private blocklist.
- Python tooling runs with `uv run` (never `python`, `pip`).
- Obsidian stays visible and is never reloaded by an agent (no app reload, no quit). Reloading the `fly-genetics` plugin (`obsidian plugin:reload id=fly-genetics`, or the harness's disable/enable) is allowed. Tests run only in the throwaway drawing `Excalidraw/_test-harness.excalidraw.md`, never on the user's drawings.
- Tests must never leave a modal open: every test that opens a form closes it on every exit path, and the harness closes any modal the plugin still has open when a test ends.
- Subagents: Sonnet or Opus only, never Haiku.
- Obsidian tests are slow: in each task run only the named tests. The full `tests/run-all.sh` runs only in Task 18 and Task 22.
- Do not switch branches in, or commit to, `~/code/excalidraw-genetics` while another agent may be using it; work in the worktree created in "Before you start".
- Every commit message ends with the line `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

---

## Before you start

- [ ] **Confirm the undo-safe merge landed.** Run `git -C ~/code/excalidraw-genetics log --oneline -1 main -- docs/plans/2026-09-29-undo-safe-design.md`. Expected: a commit on `main`. If it prints nothing, stop: this plan ports the operation discipline on `main` after that merge.
- [ ] **Read the merged design and block.** `git -C ~/code/excalidraw-genetics show main:docs/plans/2026-09-29-undo-safe-design.md` and the block from `// ---- Undo-safe operations` to `// ---- End of undo-safe operations` in `git show main:scripts/Tidy.md`. Note every difference from the version this plan cites (`undo-safe@88155fb`): the operation registry key (review fix: keyed by the drawing's file, not the view), Cross Mode child-failure handling, rollback per touched ids, and anything else. Task 5 ports the merged version.
- [ ] **Create the worktree.** `git -C ~/code/excalidraw-genetics worktree add ~/code/excalidraw-genetics-plugin -b plugin-foundation main`. All paths below are relative to `~/code/excalidraw-genetics-plugin` (called `$REPO`).
- [ ] **Check the dev vault.** `source ~/.config/fly-genetics/env; ls -la "$FLY_VAULT/Excalidraw/Scripts"`. The scripts there are symlinks into `~/code/excalidraw-genetics/scripts`; scripts-engine test runs use whatever that checkout has. Before any `FLY_ENGINE=scripts` run, confirm `git -C ~/code/excalidraw-genetics status --short scripts` is empty and its branch is `main`; if not, ask Sean before running scripts-engine tests.

---

## File structure

Build and packaging (repo root):

| File | Responsibility |
|---|---|
| `package.json`, `package-lock.json` | npm scripts (`dev`, `build`, `test`) and dev dependencies |
| `tsconfig.json` | Strict TypeScript for `src/` (type check only; esbuild emits) |
| `esbuild.config.mjs` | Bundles `src/main.ts` to `main.js` (sample-plugin config) |
| `vitest.config.ts` | Unit test config (`tests/unit/**/*.test.ts`) |
| `manifest.json` | Plugin manifest (id, name, version, minAppVersion, isDesktopOnly) |
| `versions.json` | Plugin version to minimum Obsidian version |
| `styles.css` | Form styles (static declarations moved out of the scripts' `cssText`) |
| `.gitignore` | Adds `node_modules/`, `main.js` |
| `tools/dev-install.sh` | Links the built plugin into `$FLY_VAULT` and enables it |
| `tools/set-version.mjs` | Writes a release version into `manifest.json`, `package.json`, `versions.json` |
| `tools/scan.sh` (modify) | Scans the built `main.js` text as well as tracked files |

Source (`src/`):

| File | Responsibility |
|---|---|
| `src/main.ts` | `FlyGeneticsPlugin`: settings, Excalidraw check, command registration, migration offer, unload cleanup |
| `src/constants.ts` | Drawing and layout constants shared by several modules (values from the scripts) |
| `src/hooks.ts` | Typed access to the `window._*` test and interop globals (`take`, `put`) |
| `src/testing.ts` | `TestingHooks`: in-flight command count, recorded errors, open modals (harness uses it) |
| `src/excalidraw/ea.ts` | Minimal types for ExcalidrawAutomate, ExcalidrawView and its API; `newEA`, `activeExcalidrawView` |
| `src/excalidraw/version.ts` | `compareVersions`, `excalidrawStatus`, `checkExcalidraw` |
| `src/schema/index.ts` | v2 `customData` types, element types, `validateCustomData`, small accessors |
| `src/scene/graph.ts` | Lineage walks, depths, selection sets (pure) |
| `src/scene/snapshot.ts` | Tidy's Phase A genotype snapshot (pure) |
| `src/scene/geometry.ts` | `boundingBox`, `lineagePoints`, `pathMidpoint` (pure) |
| `src/scene/index.ts` | Re-exports |
| `src/operation/index.ts` | The undo-safe transaction: `runOperation`, `OperationContext`, `setAppState`, `unrecordLastStep`, registry |
| `src/operation/pure.ts` | `sameDrawn`, `raise`, `planFinish` (pure parts of flyFinish) |
| `src/duplicates/plan.ts` | `planDuplicateSplit` (pure) |
| `src/duplicates/index.ts` | `splitDuplicateGenotypes(ctx)` (plan + commit through `ctx`) |
| `src/backcross/plan.ts` | `planMultiRowSplit` (pure) |
| `src/backcross/index.ts` | `splitMultiRowParents(ctx, lineage, subset)` |
| `src/layout/index.ts` | Tidy engine as pure functions: `layoutLineage`, `linearize`, `layoutUnit`, `resolveRow`, `childArrowPoints`, `collectCrossPairs`, clearance helpers |
| `src/render/index.ts` | Drawing through an EA workbench: genotypes, frames, labels, criteria, x glyphs, lineage arrows, text measuring |
| `src/forms/picker-options.ts` | Cross picker options, dedup, flip and sex rules, parent assignment (pure) |
| `src/forms/genotype-form.ts` | The Genotype form modal |
| `src/forms/cross-picker.ts` | The Cross Genotypes picker modal |
| `src/commands/index.ts` | Command table, `checkCallback` gating, handler wiring |
| `src/commands/genotype.ts` | Genotype |
| `src/commands/cross-genotypes.ts` | Cross Genotypes |
| `src/commands/tidy.ts` | Tidy (dispatch and per-lineage orchestration) |
| `src/commands/select.ts` | Select Below and Select Lineage |
| `src/commands/tidy-below.ts` | Tidy Below |
| `src/commands/break-cross.ts` | Break Cross |
| `src/commands/cross-mode.ts` | Cross Mode |
| `src/migration.ts` | First-load offer to trash the installer's script files |
| `src/settings.ts` | Saved answers to the first-load offers (`migration`, `font`) |
| `src/font/plan.ts` | The installer's font rules (pure) |
| `src/font/assets.ts`, `src/assets.d.ts` | The bundled font and license from `fonts/` (esbuild binary/text loaders) |
| `src/font/index.ts` | First-load offer to set up the Computer Modern font |

Tests:

| File | Responsibility |
|---|---|
| `tests/unit/*.test.ts` | Vitest unit tests (one per module, plus `write-guard.test.ts`) |
| `tests/unit/helpers/fixtures.ts` | Loads `tests/fixtures/<name>.json` and name lookups |
| `tests/unit/helpers/fake-ea.ts` | Deterministic fake EA workbench for `render` tests |
| `tests/unit/helpers/layout-input.ts` | Builds a `LayoutInput` and expected positions from a fixture and its golden |
| `tests/unit/golden/tidy-<fixture>.json` | What the Tidy script made of each single-lineage fixture (captured once) |
| `tests/capture-layout-golden.sh` | Captures the goldens with the scripts engine |
| `tests/harness.js`, `tests/lib.sh`, `tests/run-all.sh` (modify) | Plugin engine (`FLY_ENGINE`), frozen fixtures (`FLY_FROZEN`), modal cleanup, build step |
| `tests/genotype-form-flip.sh` (modify) | Starts Genotype through `T.launch` instead of the Script Engine |
| `tests/plugin-smoke.sh` | Plugin loads; commands gated on an Excalidraw view; errors reach the harness |
| `tests/select.sh` | Select Below and Select Lineage selections (no test covered them) |
| `tests/migration.sh` | Migration offer: confirm, decline, modal path |
| `tests/font-setup.sh` | Font setup offer: confirm, decline, modal path |

---

## Porting rules (apply to every ported function)

1. **Source of truth.** Port from `main` after the `undo-safe` merge. Ranges below are on `undo-safe@88155fb` (`git show 88155fb:"scripts/<Name>.md"`); on the merged `main`, locate the same code by the function names given and port that version.
2. **`ea` is a parameter.** No module-level mutable state. Inside a command, use `ctx.ea` (the command's own EA instance, bound to the view). Constants move to `src/constants.ts` (or `layout`'s own when only layout uses them) with the same values.
3. **Obsidian API.** `new ea.obsidian.Modal(app)` becomes `new Modal(app)` (import from `obsidian`); `app` becomes `ctx.app`; `Notice` is imported from `obsidian`.
4. **Scene writes (through `operation`).**

   | Script | Plugin |
   |---|---|
   | `return await flyOperation("<Name>", async () => { ... })` | the command body `async (ctx) => { ... }`, run by `runOperation` (wired in `src/commands/index.ts`) |
   | `await flyAddElementsToView()` | `await ctx.commit()` |
   | `flyDeleteViewElements(els)` | `ctx.deleteElements(els)` |
   | `api.updateScene({ appState })`, `ea.targetView.updateScene({ appState })` | `ctx.setAppState(appState)` (inside an operation) or `setAppState(view, appState)` (Cross Mode outside one) |
   | `ea.selectElementsInView(els)` | `ctx.selectElements(els)` |
   | `flyStart("<Name>")` plus a `window._*` handoff | `await ctx.join("<Name>", (c) => <name>(c, params))` with the handoff as a parameter |
   | `api.history?.undo/redo` (Cross Mode's `unrecordLine`) | `unrecordLastStep(view, lineId)` in `operation` |
   | workbench edits + commit (duplicates, backcross, Break Cross) | a pure plan returning patches, then `await ctx.commitPatches(patches, added)` |

5. **Hooks.** Test and interop globals go through `take` (read and clear) and `put` in `src/hooks.ts`, with the same names and shapes as the scripts. Inter-script handoffs `_tidySeed`, `_crossGenotypesParents`, `_genotypeDefaultGlyph` and `_flySelectResult` polling become function parameters and return values (the hooks tests set, `_genotypeCreateAt` and friends, are still read).
6. **Ids.** `crypto.randomUUID()` stays in EA-facing code. Pure modules take `newId: () => string = () => crypto.randomUUID()` so tests can inject a deterministic generator.
7. **Text accessors.** Keep each call site's accessor: Tidy reads `el.text` (Phase A, `reconstructShorthand`); Genotype, Cross Genotypes and Cross Mode read `originalText ?? rawText ?? text` (`textOf`).
8. **`using` and polling.** Tidy's `using _tidyDone` becomes `try { ... } finally { put("_tidyLastResult", (window._tidyLastResult ?? 0) + 1) }`.
9. **Types.** Strict TypeScript, no `any`: elements are `SceneElement` (`src/schema`), EA members are typed in `src/excalidraw/ea.ts`; narrow `unknown` where the scripts relied on optional chaining.
10. **Styles.** Static `style.cssText` declarations in the forms move to `styles.css` classes (prefix `fly-`) with identical declarations. Values computed at runtime (input widths, the flip button's `visibility`, `opacity` and `disabled`, the modal's `width: auto; max-width: 95vw`) stay as `el.style.<prop>` assignments exactly as the scripts set them.
11. **Errors.** A command that throws is logged with `console.error` and recorded in `plugin.testing.errors` as `"<Name>: <message>"` (the Script Engine showed nothing either). No new Notices.

---

## Task 1: Scaffold, Excalidraw check and gated command table

**Files:**
- Create: `package.json`, `tsconfig.json`, `esbuild.config.mjs`, `vitest.config.ts`, `manifest.json`, `versions.json`, `styles.css`, `src/main.ts`, `src/testing.ts`, `src/excalidraw/ea.ts`, `src/excalidraw/version.ts`, `src/commands/index.ts`, `tools/dev-install.sh`, `tests/unit/version.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `src/excalidraw/version.ts`: `export const EXCALIDRAW_ID = "obsidian-excalidraw-plugin"`, `export const EXCALIDRAW_MIN_VERSION = "2.20.2"`, `export function compareVersions(a: string, b: string): number`, `export type ExcalidrawCheck = { ok: true } | { ok: false; message: string }`, `export function excalidrawStatus(installed: string | null, enabled: boolean): ExcalidrawCheck`, `export function checkExcalidraw(app: App): ExcalidrawCheck`
  - `src/excalidraw/ea.ts`: `EA`, `ExcalidrawViewLike`, `ExcalidrawAPI`, `AppStateLike`, `SceneUpdate`, `export function newEA(view: ExcalidrawViewLike): EA`, `export function activeExcalidrawView(app: App): ExcalidrawViewLike | null`, `export interface AppInternals`
  - `src/testing.ts`: `export class TestingHooks { inflight: number; readonly errors: string[]; readonly modals: Set<Modal>; run(name: string, work: () => Promise<unknown>): Promise<void>; record(name: string, error: unknown): void; idle(ms?: number): Promise<void>; closeModals(): void }`
  - `src/commands/index.ts`: `export const COMMANDS` (id and display name of each command), `export const COMMAND_NAMES`, `export type CommandName`, `export type CommandId`, `export function commandId(name: CommandName): CommandId`, `export type CommandHandler = (plugin: FlyGeneticsPlugin, view: ExcalidrawViewLike) => Promise<void>`, `export function registerCommands(plugin: FlyGeneticsPlugin): void`
  - `src/main.ts`: `export default class FlyGeneticsPlugin extends Plugin { readonly testing: TestingHooks }`

- [ ] **Step 1: Write the failing unit test** `tests/unit/version.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { compareVersions, excalidrawStatus, EXCALIDRAW_MIN_VERSION } from "../../src/excalidraw/version";

describe("compareVersions", () => {
  it("orders by numeric parts", () => {
    expect(compareVersions("2.20.2", "2.20.2")).toBe(0);
    expect(compareVersions("2.27.3", "2.20.2")).toBe(1);
    expect(compareVersions("2.9.0", "2.20.2")).toBe(-1);
    expect(compareVersions("2.20", "2.20.0")).toBe(0);
    expect(compareVersions("2.20.2-beta-1", "2.20.2")).toBe(0);
  });
});

describe("excalidrawStatus", () => {
  it("accepts the minimum version, enabled", () => {
    expect(excalidrawStatus(EXCALIDRAW_MIN_VERSION, true)).toEqual({ ok: true });
    expect(excalidrawStatus("2.27.3", true)).toEqual({ ok: true });
  });
  it("explains what is missing", () => {
    const missing = excalidrawStatus(null, false);
    const off = excalidrawStatus("2.27.3", false);
    const old = excalidrawStatus("2.19.0", true);
    expect(missing.ok || off.ok || old.ok).toBe(false);
    if (!missing.ok) expect(missing.message).toContain("install");
    if (!off.ok) expect(off.message).toContain("enable");
    if (!old.ok) expect(old.message).toContain("2.19.0");
  });
});
```

- [ ] **Step 2: Create the build config and run the test to see it fail.**

`package.json`:

```json
{
  "name": "fly-genetics",
  "version": "0.0.0",
  "private": true,
  "description": "Draw Drosophila genotypes and crossing schemes in Excalidraw drawings.",
  "main": "main.js",
  "scripts": {
    "dev": "node esbuild.config.mjs",
    "build": "tsc -noEmit -skipLibCheck && node esbuild.config.mjs production",
    "test": "vitest run"
  },
  "license": "MIT",
  "devDependencies": {
    "@types/node": "^22.0.0",
    "esbuild": "^0.25.0",
    "obsidian": "latest",
    "tslib": "^2.8.0",
    "typescript": "^5.9.0",
    "vitest": "^3.2.0"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2021",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["DOM", "DOM.Iterable", "ES2022"],
    "strict": true,
    "noImplicitAny": true,
    "noImplicitReturns": true,
    "isolatedModules": true,
    "importHelpers": true,
    "inlineSourceMap": true,
    "inlineSources": true,
    "types": []
  },
  "include": ["src/**/*.ts"]
}
```

`esbuild.config.mjs`:

```js
import esbuild from "esbuild";
import process from "node:process";
import { builtinModules } from "node:module";

const prod = process.argv[2] === "production";

const context = await esbuild.context({
  banner: { js: "/* Fly Genetics. Bundled by esbuild from src/ (https://github.com/half-adder/excalidraw-genetics). */" },
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtinModules,
  ],
  format: "cjs",
  target: "es2021",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  minify: prod,
  outfile: "main.js",
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["tests/unit/**/*.test.ts"], environment: "node" },
});
```

Append to `.gitignore`:

```
node_modules/
main.js
```

Run: `cd $REPO && npm install && npm test -- tests/unit/version.test.ts`
Expected: FAIL, `Failed to resolve import "../../src/excalidraw/version"`.

- [ ] **Step 3: Implement `src/excalidraw/version.ts`.**

```ts
import type { App } from "obsidian";
import type { AppInternals } from "./ea";

export const EXCALIDRAW_ID = "obsidian-excalidraw-plugin";
export const EXCALIDRAW_MIN_VERSION = "2.20.2";

// Numeric comparison of dotted versions; a pre-release suffix ("-beta-1") is ignored.
export function compareVersions(a: string, b: string): number {
  const nums = (v: string) => v.split("-")[0].split(".").map((p) => Number.parseInt(p, 10) || 0);
  const x = nums(a), y = nums(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}

export type ExcalidrawCheck = { ok: true } | { ok: false; message: string };

export function excalidrawStatus(installed: string | null, enabled: boolean): ExcalidrawCheck {
  if (installed === null) {
    return { ok: false, message: `Fly Genetics needs the Excalidraw plugin (${EXCALIDRAW_MIN_VERSION} or newer). Please install it from Settings > Community plugins, then reload Fly Genetics.` };
  }
  if (compareVersions(installed, EXCALIDRAW_MIN_VERSION) < 0) {
    return { ok: false, message: `Fly Genetics needs Excalidraw ${EXCALIDRAW_MIN_VERSION} or newer (installed: ${installed}). Update it in Settings > Community plugins.` };
  }
  if (!enabled) {
    return { ok: false, message: "Fly Genetics needs the Excalidraw plugin: please enable it in Settings > Community plugins." };
  }
  return { ok: true };
}

export function checkExcalidraw(app: App): ExcalidrawCheck {
  const plugins = (app as AppInternals).plugins;
  const version = plugins.manifests[EXCALIDRAW_ID]?.version ?? null;
  const enabled = plugins.enabledPlugins.has(EXCALIDRAW_ID) && !!plugins.plugins[EXCALIDRAW_ID];
  return excalidrawStatus(version, enabled);
}
```

- [ ] **Step 4: Run the test.** `npm test -- tests/unit/version.test.ts`. Expected: PASS (2 suites).

- [ ] **Step 5: Write `src/excalidraw/ea.ts`** (types for exactly the members the scripts use; extend only when a later task needs a member the scripts use).

```ts
import { ItemView, type App, type TFile, type Plugin } from "obsidian";
import type { SceneElement } from "../schema";

export type CaptureUpdate = "IMMEDIATELY" | "NEVER" | "EVENTUALLY";

export interface AppStateLike {
  selectedElementIds: Record<string, boolean>;
  selectedGroupIds: Record<string, boolean>;
  activeTool: { type: string; locked?: boolean };
  currentItemStrokeColor: string;
  currentItemStrokeStyle: string;
  currentItemOpacity: number;
  multiElement: SceneElement | null;
  newElement?: SceneElement | null;
  draggingElement?: SceneElement | null;
  [key: string]: unknown;
}

export interface SceneUpdate {
  elements?: readonly SceneElement[];
  appState?: Partial<AppStateLike>;
  captureUpdate?: CaptureUpdate;
}

export interface ExcalidrawAPI {
  getSceneElements(): SceneElement[];
  getSceneElementsIncludingDeleted(): SceneElement[];
  getAppState(): AppStateLike;
  updateScene(scene: SceneUpdate): void;
  setActiveTool(tool: { type: string; locked?: boolean }): void;
  history?: { undo?(): void; redo?(): void; clear?(): void };
}

export interface ExcalidrawViewLike {
  file: TFile | null;
  excalidrawAPI: ExcalidrawAPI;
  updateScene(scene: SceneUpdate): void;
  contentEl: HTMLElement;
  containerEl: HTMLElement;
  getViewType(): string;
}

export interface EAStyle {
  strokeColor: string;
  backgroundColor: string;
  fillStyle: string;
  strokeWidth: number;
  strokeStyle: string;
  roughness: number;
  opacity: number;
  fontFamily: number;
  fontSize: number;
}

export interface EA {
  targetView: ExcalidrawViewLike | null;
  plugin: { settings: { experimentalEnableFourthFont?: boolean; scriptFolderPath?: string } };
  style: EAStyle;
  elementsDict: Record<string, SceneElement>;
  setView(view?: ExcalidrawViewLike | "first" | "active"): ExcalidrawViewLike | null;
  clear(): void;
  verifyMinimumPluginVersion(version: string): boolean;
  addText(x: number, y: number, text: string, opts?: Record<string, unknown>): string;
  addLine(points: Array<[number, number]>): string;
  addArrow(points: Array<[number, number]>, opts?: Record<string, unknown>): string;
  addRect(x: number, y: number, w: number, h: number): string;
  addToGroup(ids: string[]): string;
  addAppendUpdateCustomData(id: string, data: Record<string, unknown>): void;
  getElement(id: string): SceneElement | undefined;
  getElements(): SceneElement[];
  getViewElements(): SceneElement[];
  getViewSelectedElements(): SceneElement[];
  getBoundingBox(els: readonly SceneElement[]): { topX: number; topY: number; width: number; height: number };
  getViewCenterPosition(): { x: number; y: number } | null;
  copyViewElementsToEAforEditing(els: readonly SceneElement[]): void;
  addElementsToView(repositionToCursor?: boolean, save?: boolean, newElementsOnTop?: boolean, shouldRestoreElements?: boolean, captureUpdate?: CaptureUpdate): Promise<boolean>;
  selectElementsInView(els: readonly SceneElement[]): void;
}

// Obsidian internals the plugin reads (not in the public typings).
export interface AppInternals extends App {
  plugins: {
    manifests: Record<string, { version: string } | undefined>;
    enabledPlugins: Set<string>;
    plugins: Record<string, Plugin | undefined>;
  };
  commands: { executeCommandById(id: string): boolean };
}

// A fresh ExcalidrawAutomate instance (its own workbench) bound to `view`.
export function newEA(view: ExcalidrawViewLike): EA {
  const global = (window as unknown as { ExcalidrawAutomate?: { getAPI(view?: ExcalidrawViewLike): EA } }).ExcalidrawAutomate;
  if (!global) throw new Error("ExcalidrawAutomate is not available");
  const ea = global.getAPI(view);
  ea.setView(view);
  return ea;
}

// The active Excalidraw view, as the Script Engine runs scripts against it.
export function activeExcalidrawView(app: App): ExcalidrawViewLike | null {
  const view = app.workspace.getActiveViewOfType(ItemView);
  return view && view.getViewType() === "excalidraw" ? (view as unknown as ExcalidrawViewLike) : null;
}
```

Also create `src/schema/index.ts` with only `export interface SceneElement { id: string; type: string; x: number; y: number; width: number; height: number; [key: string]: unknown }` for now; Task 3 replaces it with the full schema.

- [ ] **Step 6: Write `src/testing.ts`.**

```ts
import type { Modal } from "obsidian";

// State the Obsidian-driven tests read through app.plugins.plugins["fly-genetics"].testing:
// commands in flight (so a test waits for a command and everything it runs),
// errors thrown by commands, and modals the plugin has open (closed when a test ends).
export class TestingHooks {
  inflight = 0;
  readonly errors: string[] = [];
  readonly modals = new Set<Modal>();

  async run(name: string, work: () => Promise<unknown>): Promise<void> {
    this.inflight++;
    try {
      await work();
    } catch (e) {
      this.record(name, e);
    } finally {
      this.inflight--;
    }
  }

  record(name: string, error: unknown): void {
    this.errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`Fly Genetics: ${name}:`, error);
  }

  // Resolves once no command has been running for 30 ms.
  async idle(ms = 20000): Promise<void> {
    const t0 = Date.now();
    let calm = 0;
    while (Date.now() - t0 < ms) {
      calm = this.inflight === 0 ? calm + 1 : 0;
      if (calm >= 3) return;
      await new Promise((r) => window.setTimeout(r, 10));
    }
    throw new Error(`commands still running after ${ms} ms`);
  }

  closeModals(): void {
    for (const m of [...this.modals]) m.close();
    this.modals.clear();
  }
}
```

- [ ] **Step 7: Write `src/commands/index.ts`** with the command table. Handlers start as `notPorted`; each command task replaces its entry.

```ts
import type FlyGeneticsPlugin from "../main";
import { activeExcalidrawView, type ExcalidrawViewLike } from "../excalidraw/ea";
import { checkExcalidraw } from "../excalidraw/version";

// Display names are the script names; ids are their kebab-case forms
// (full id "fly-genetics:<id>").
export const COMMANDS = [
  { id: "genotype", name: "Genotype" },
  { id: "cross-genotypes", name: "Cross Genotypes" },
  { id: "cross-mode", name: "Cross Mode" },
  { id: "tidy", name: "Tidy" },
  { id: "tidy-below", name: "Tidy Below" },
  { id: "select-below", name: "Select Below" },
  { id: "select-lineage", name: "Select Lineage" },
  { id: "break-cross", name: "Break Cross" },
] as const;
export type CommandName = (typeof COMMANDS)[number]["name"];
export type CommandId = (typeof COMMANDS)[number]["id"];
export const COMMAND_NAMES: readonly CommandName[] = COMMANDS.map((c) => c.name);
export function commandId(name: CommandName): CommandId {
  const c = COMMANDS.find((x) => x.name === name);
  if (!c) throw new Error(`unknown command ${name}`);
  return c.id;
}
export type CommandHandler = (plugin: FlyGeneticsPlugin, view: ExcalidrawViewLike) => Promise<void>;

const notPorted = (name: CommandName): CommandHandler => () => Promise.reject(new Error(`${name} is not ported yet`));

const HANDLERS: Record<CommandName, CommandHandler> = {
  "Genotype": notPorted("Genotype"),
  "Cross Genotypes": notPorted("Cross Genotypes"),
  "Cross Mode": notPorted("Cross Mode"),
  "Tidy": notPorted("Tidy"),
  "Tidy Below": notPorted("Tidy Below"),
  "Select Below": notPorted("Select Below"),
  "Select Lineage": notPorted("Select Lineage"),
  "Break Cross": notPorted("Break Cross"),
};

// Each command is available only with Excalidraw ready and an Excalidraw
// drawing active (as the Script Engine's commands were).
export function registerCommands(plugin: FlyGeneticsPlugin): void {
  for (const { id, name } of COMMANDS) {
    plugin.addCommand({
      id,
      name,
      checkCallback: (checking) => {
        if (!checkExcalidraw(plugin.app).ok) return false;
        const view = activeExcalidrawView(plugin.app);
        if (!view) return false;
        if (!checking) void plugin.testing.run(name, () => HANDLERS[name](plugin, view));
        return true;
      },
    });
  }
}
```

- [ ] **Step 8: Write `src/main.ts`.**

```ts
import { Notice, Plugin } from "obsidian";
import { registerCommands } from "./commands";
import { checkExcalidraw } from "./excalidraw/version";
import { TestingHooks } from "./testing";

export default class FlyGeneticsPlugin extends Plugin {
  readonly testing = new TestingHooks();

  async onload(): Promise<void> {
    registerCommands(this);
    this.app.workspace.onLayoutReady(() => {
      const check = checkExcalidraw(this.app);
      if (!check.ok) new Notice(check.message, 0);
    });
  }

  onunload(): void {
    this.testing.closeModals();
  }
}
```

- [ ] **Step 9: Manifest, versions, styles, dev install.**

Find the minimum Obsidian version Excalidraw 2.20.2 declares: `gh api 'repos/zsviczian/obsidian-excalidraw-plugin/contents/manifest.json?ref=2.20.2' --jq .content | base64 -d | grep minAppVersion`. Use that value as `<MIN_APP>` below. Use the scaffold day's version as `<VERSION>` (`YYYY.MDD.0`, e.g. `2026.930.0` on September 30; `node -e 'const d=new Date();console.log(`${d.getFullYear()}.${d.getMonth()+1}${String(d.getDate()).padStart(2,"0")}.0`)'`).

`manifest.json`:

```json
{
  "id": "fly-genetics",
  "name": "Fly Genetics",
  "version": "<VERSION>",
  "minAppVersion": "<MIN_APP>",
  "description": "Draw Drosophila genotypes and crossing schemes in Excalidraw drawings.",
  "author": "half-adder",
  "authorUrl": "https://github.com/half-adder",
  "isDesktopOnly": false
}
```

`versions.json`: `{ "<VERSION>": "<MIN_APP>" }`. `styles.css`: a single comment line `/* Fly Genetics form styles (see src/forms). */`.

`tools/dev-install.sh`:

```bash
#!/usr/bin/env bash
# Links the built plugin (main.js, manifest.json, styles.css of this checkout)
# into the development vault and enables it. Marks the script migration and
# the font setup offer as declined there (its font is already set up): that vault's scripts are symlinks into a clone of this repo
# and must never be offered for the trash. Usage: tools/dev-install.sh
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
[[ -z "${FLY_VAULT:-}" && -f "$HOME/.config/fly-genetics/env" ]] && source "$HOME/.config/fly-genetics/env"
[[ -n "${FLY_VAULT:-}" ]] || { echo "dev-install: set FLY_VAULT (or put it in ~/.config/fly-genetics/env)"; exit 2; }
DIR="$FLY_VAULT/.obsidian/plugins/fly-genetics"
mkdir -p "$DIR"
for f in main.js manifest.json styles.css; do ln -sfn "$REPO/$f" "$DIR/$f"; done
[[ -f "$DIR/data.json" ]] || printf '{\n  "migration": "declined",\n  "font": "declined"\n}\n' >"$DIR/data.json"
cd "$FLY_VAULT"
obsidian eval code="(async()=>{await app.plugins.loadManifests();await app.plugins.enablePluginAndSave('fly-genetics');return !!app.plugins.plugins['fly-genetics']})()"
```

- [ ] **Step 10: Build, install, verify in Obsidian.**

Run: `npm run build && chmod +x tools/dev-install.sh && tools/dev-install.sh`
Expected: build prints `main.js` size; dev-install prints `=> true`.

Verify the EA factory binds the view (the scripts relied on `ea.targetView`):
`cd "$FLY_VAULT" && obsidian eval code="(()=>{const l=app.workspace.getLeavesOfType('excalidraw')[0];if(!l)return 'no drawing open';const ea=ExcalidrawAutomate.getAPI(l.view);ea.setView(l.view);return ea.targetView===l.view})()"`
Expected: `=> true` (or `no drawing open`: open `Excalidraw/_test-scratch.md` read-only first with `obsidian open file="_test-scratch"`, and do not modify it).

Verify ids and gating: `obsidian eval code="Object.keys(app.commands.commands).filter(k=>k.startsWith('fly-genetics:')).sort().join()"` prints `fly-genetics:break-cross,fly-genetics:cross-genotypes,fly-genetics:cross-mode,fly-genetics:genotype,fly-genetics:select-below,fly-genetics:select-lineage,fly-genetics:tidy,fly-genetics:tidy-below`. `obsidian eval code="app.commands.commands['fly-genetics:tidy'].checkCallback(true)"` with a Markdown note active: `=> false`; with the scratch drawing active: `=> true`. Compare with the Script Engine: `obsidian eval code="String(app.commands.commands['obsidian-excalidraw-plugin:Tidy'].checkCallback ?? app.commands.commands['obsidian-excalidraw-plugin:Tidy'].callback).slice(0,400)"`; if the Script Engine gates differently (for example allows any view), match it in `registerCommands` and note it in the commit message.

- [ ] **Step 11: Commit.**

```bash
git add package.json package-lock.json tsconfig.json esbuild.config.mjs vitest.config.ts manifest.json versions.json styles.css .gitignore src tools/dev-install.sh tests/unit/version.test.ts
git commit -m "Scaffold the Fly Genetics plugin: build, Excalidraw check, gated commands

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Harness plugin engine

**Files:**
- Modify: `tests/harness.js`, `tests/lib.sh`, `tests/run-all.sh`, `tests/genotype-form-flip.sh`
- Create: `tests/plugin-smoke.sh`

**Interfaces:**
- Consumes: `plugin.testing` (`TestingHooks` from Task 1), commands `fly-genetics:<id>` with the kebab-case ids of Task 1.
- Produces (harness, used by every later Obsidian test):
  - env `FLY_ENGINE=scripts|plugin` (default `scripts` until Task 18), `FLY_FROZEN=1` (load fixtures without the staleness check).
  - `cid(name)`: the full command id of a display name (`'fly-genetics:' + name.toLowerCase().replace(/ /g, '-')`, matching Task 1's `COMMANDS`).
  - `T.run(name, { tolerate })` runs the script or the plugin command (by display name) and waits for it and everything it starts.
  - `T.launch(name)` starts it without waiting (for tests that drive a real form).
  - fixture hash: scripts engine as today; plugin engine over `main.js` text plus scenario and founders.
  - end of every test: `app.plugins.plugins['fly-genetics']?.testing?.closeModals()`.

- [ ] **Step 1: Write the failing smoke test** `tests/plugin-smoke.sh`:

```bash
#!/usr/bin/env bash
# The plugin engine of the test harness: the fly-genetics plugin is loaded
# from this checkout's main.js, its eight commands exist and are available in
# the harness drawing, a command's error reaches T.run, and a modal left open
# by the plugin is closed when the test ends. Run with FLY_ENGINE=plugin.
# Prints PASS/FAIL; exit 0 only if all pass.
source "$(dirname "$0")/lib.sh"
status=0
fly_test <<'JS' || status=$?
const P = app.plugins.plugins['fly-genetics'];
T.pass(!!P, 'plugin loaded', 'plugin not loaded');
const names = ['Genotype', 'Cross Genotypes', 'Cross Mode', 'Tidy', 'Tidy Below', 'Select Below', 'Select Lineage', 'Break Cross'];
const cid = n => 'fly-genetics:' + n.toLowerCase().replace(/ /g, '-');
const missing = names.filter(n => !app.commands.commands[cid(n)]);
T.pass(!missing.length, 'all eight commands registered', 'missing commands: ' + missing.join(', '));
const avail = names.filter(n => app.commands.commands[cid(n)].checkCallback(true));
T.pass(avail.length === names.length, 'commands available in an Excalidraw drawing', 'unavailable: ' + names.filter(n => !avail.includes(n)).join(', '));
const errs = await T.run('Select Lineage', { tolerate: true });
T.pass(errs.length === 1 && /Select Lineage/.test(errs[0]), 'a command error reaches T.run: ' + errs[0], 'errors: ' + JSON.stringify(errs));
// A stand-in for a form left open: the harness must close it when the test ends.
window.__flySmokeClosed = false;
P.testing.modals.add({ close() { window.__flySmokeClosed = true; } });
T.check('PASS: registered an open modal for the cleanup check');
JS
closed=$(ev "String(window.__flySmokeClosed)")
[[ "$closed" == "true" ]] && echo "PASS: the harness closed the plugin's open modal" || { echo "FAIL: the plugin's open modal was not closed"; status=1; }
exit $status
```

The error check expects Select Lineage to throw (`not ported yet` now). Task 14 Step 4 and Task 17 Step 2 move this probe as commands get ported.

- [ ] **Step 2: Run it to see it fail.** `FLY_ENGINE=plugin bash tests/plugin-smoke.sh`. Expected: exit 1 with `FAIL: errors: []` (the harness still runs the Select Lineage script, which throws nothing) and `FAIL: the plugin's open modal was not closed`.

- [ ] **Step 3: Implement the engine in `tests/harness.js`.** Changes (keep everything else):

At the top of the IIFE, after `FIXTURE_SCRIPTS`:

```js
  const COMMANDS = SCRIPTS.filter(n => n !== 'Update Fly Genetics');
  const fly = () => app.plugins.plugins['fly-genetics'];
  // Full command id of a display name: kebab-case, as in src/commands/index.ts.
  const cid = name => 'fly-genetics:' + name.toLowerCase().replace(/ /g, '-');
  // Reloads the fly-genetics plugin when this checkout's main.js changed since
  // the last load (disable/enable reads main.js again; Obsidian itself is
  // never reloaded), then waits for its commands.
  async function reloadPlugin(repo) {
    const text = fs.readFileSync(repo + '/main.js', 'utf8');
    if (window.__flyPluginText !== text || !fly()) {
      await app.plugins.disablePlugin('fly-genetics');
      await app.plugins.enablePlugin('fly-genetics');
      window.__flyPluginText = text;
    }
    for (let i = 0; i < 100 && !(fly() && COMMANDS.every(n => app.commands.commands[cid(n)])); i++) await sleep(20);
    if (!fly()) throw new Error('fly-genetics plugin did not load');
  }
```

Replace `T.run` with:

```js
    T.run = async (name, { tolerate = false } = {}) => {
      await selectionLanded(api()); // updateScene state lands on the next render
      let errs;
      if (opts.engine === 'plugin') {
        const P = fly(), e0 = P.testing.errors.length, cmd = app.commands.commands[cid(name)];
        if (!cmd) throw new Error('no command ' + name);
        if (!cmd.checkCallback(true)) throw new Error('command not available: ' + name);
        app.commands.executeCommandById(cid(name));
        await P.testing.idle();
        if (window.__flyGap) await sleep(window.__flyGap);
        errs = P.testing.errors.slice(e0);
      } else {
        const f = app.vault.getAbstractFileByPath('Excalidraw/Scripts/' + name + '.md');
        if (!f) throw new Error('no script ' + name);
        const e0 = errors.length;
        plugin().scriptEngine.executeScriptFile(view, f, name);
        await idle();
        if (window.__flyGap) await sleep(window.__flyGap);
        errs = errors.slice(e0);
      }
      if (errs.length && !tolerate) throw new Error('script error: ' + errs.join('; '));
      return errs;
    };
    // Starts a script or command without waiting for it (a test that drives a
    // real form polls its own result). The scripts engine calls the untracked
    // executeScriptFile, as genotype-form-flip.sh did.
    T.launch = async name => {
      await selectionLanded(api());
      if (opts.engine === 'plugin') {
        if (!app.commands.commands[cid(name)]?.checkCallback(true)) throw new Error('command not available: ' + name);
        app.commands.executeCommandById(cid(name));
        return;
      }
      const se = plugin().scriptEngine, f = app.vault.getAbstractFileByPath('Excalidraw/Scripts/' + name + '.md');
      if (!f) throw new Error('no script ' + name);
      (se.__flyOrig || se.executeScriptFile).call(se, view, f, name);
    };
```

Replace `fixtureHash` and the staleness check in `T.fixture`:

```js
    const engineText = () => opts.engine === 'plugin'
      ? fs.readFileSync(opts.repo + '/main.js', 'utf8')
      : FIXTURE_SCRIPTS.map(n => fs.readFileSync(opts.repo + '/scripts/' + n + '.md', 'utf8')).join('\u0000');
    const fixtureHash = s => sha(engineText() + window.__flyScenarios[s].toString() + JSON.stringify(window.__flyFounders));
```

and in `T.fixture`: `if (!fx || (!opts.frozen && fx.hash !== fixtureHash(s))) {`.

In `start(opts)`: replace `await reloadScripts();` with `if (opts.engine === 'plugin') await reloadPlugin(opts.repo); else await reloadScripts();`, and `track();` with `if (opts.engine !== 'plugin') track();`. In `finally`, before `untrack()`, add `try { fly()?.testing?.closeModals?.(); } catch (e) {}`.

- [ ] **Step 4: Pass the engine from `tests/lib.sh`.** After `cd "$VAULT"`:

```bash
ENGINE="${FLY_ENGINE:-scripts}"
# The plugin engine runs this checkout's main.js: build it once per shell.
if [[ "$ENGINE" == plugin && -z "${FLY_BUILT:-}" ]]; then
  (cd "$REPO" && npm run build --silent >/dev/null) || { echo "FAIL: npm run build"; exit 1; }
  export FLY_BUILT=1
fi
```

and in `fly_test`, the start call becomes:

```bash
  ev "(()=>{window.__flyT.start({out:'$dir/out',body:'$dir/body.js',repo:'$REPO',keep:${FLY_KEEP:-0},engine:'$ENGINE',frozen:${FLY_FROZEN:-0}});return 1})()" >/dev/null
```

Update the header comment: "Requires Obsidian running with a vault that has these scripts in Excalidraw/Scripts (FLY_ENGINE=scripts, the default) or the fly-genetics plugin linked by tools/dev-install.sh (FLY_ENGINE=plugin). FLY_FROZEN=1 loads fixtures as saved, without rebuilding stale ones."

In `tests/run-all.sh`, after `source "$TESTS/lib.sh"`, nothing else is needed (lib.sh builds once and exports `FLY_BUILT`). Skip the `plugin-smoke` test under the scripts engine: in the loop's `case`, add `plugin-smoke) [[ "${FLY_ENGINE:-scripts}" == plugin ]] || continue ;;`.

- [ ] **Step 5: Port `tests/genotype-form-flip.sh`'s start.** Replace its lines that find `se`/`genotypeFile`, wait for the selection, and call `(se.__flyOrig || se.executeScriptFile).call(...)` (lines 33 to 51 on `undo-safe@88155fb`) with `await T.launch('Genotype');`. Update its header paragraph: "starts Genotype with T.launch (not awaited) and polls window._genotypeLastResult". No assertion changes.

- [ ] **Step 6: Run.** `FLY_ENGINE=plugin bash tests/plugin-smoke.sh`. Expected: PASS lines for plugin loaded, eight commands, available, the error line `Select Lineage: Select Lineage is not ported yet`, and `PASS: the harness closed the plugin's open modal`; exit 0. Then the scripts engine still works: `FLY_ENGINE=scripts bash tests/genotype-form-flip.sh` and `FLY_ENGINE=scripts bash tests/tidy-sibling-order.sh`. Expected: PASS for both.

- [ ] **Step 7: Commit.**

```bash
git add tests/harness.js tests/lib.sh tests/run-all.sh tests/genotype-form-flip.sh tests/plugin-smoke.sh
git commit -m "Test harness: run tests against the plugin's commands (FLY_ENGINE=plugin)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: schema

**Files:**
- Modify: `src/schema/index.ts` (replaces the Task 1 placeholder)
- Create: `tests/unit/helpers/fixtures.ts`, `tests/unit/schema.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (`src/schema/index.ts`):
  - `export const SCHEMA_VERSION = 2`
  - `export const CHROMOSOME_ORDER = ["X", "II", "III", "IV"] as const`; `export type ChromosomeLabel = (typeof CHROMOSOME_ORDER)[number]`; `export const FORM_CHROMOSOMES = ["X", "II", "III"] as const`
  - `export type Side = "single" | "top" | "bottom"`
  - `export type GenotypeKind = "genotype-allele" | "genotype-fraction" | "genotype-separator" | "genotype-glyph" | "genotype-frame" | "genotype-label" | "genotype-label-box"`; `export type CrossKind = "cross-glyph" | "cross-lineage" | "cross-criterion"`; `export type Kind = GenotypeKind | CrossKind`
  - `export interface Parents { maternal: string; paternal: string }`
  - `export interface CustomData { schemaVersion?: number; kind?: string; genotypeId?: string; parents?: Parents; chromosome?: string; side?: string; after?: string; childGenotypeId?: string; text?: string; [key: string]: unknown }`
  - `export interface BoundRef { id: string; type: string }`; `export interface Binding { elementId: string; fixedPoint?: [number, number] | null; mode?: string; focus?: number; gap?: number }`
  - `export interface SceneElement { id: string; type: string; x: number; y: number; width: number; height: number; angle?: number; version?: number; versionNonce?: number; index?: string | null; isDeleted?: boolean; groupIds?: string[]; boundElements?: BoundRef[] | null; containerId?: string | null; points?: Array<[number, number]>; startBinding?: Binding | null; endBinding?: Binding | null; fixedSegments?: unknown; text?: string; originalText?: string; rawText?: string; customData?: CustomData; [key: string]: unknown }`
  - `export type Chromosome = { label: ChromosomeLabel; kind: "het"; alleles: { top: string; bottom: string } } | { label: ChromosomeLabel; kind: "single"; alleles: { single: string } }`
  - `export type ValidationResult = { ok: true } | { ok: false; error: string }`
  - `export function validateCustomData(cd: unknown): ValidationResult`
  - `export function kindOf(el: SceneElement | null | undefined): Kind | null`
  - `export function genotypeIdOf(el: SceneElement | null | undefined): string | null` (the scripts' `getGenotypeIdFromElement`)
  - `export function textOf(el: SceneElement): string` (`originalText ?? rawText ?? text ?? ""`)

- [ ] **Step 1: Write the fixture helper** `tests/unit/helpers/fixtures.ts`:

```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { SceneElement } from "../../../src/schema";

export const FIXTURE_DIR = join(__dirname, "..", "..", "fixtures");
export interface Fixture { hash: string; names: Record<string, string>; buildErrors: string[]; elements: SceneElement[] }
export const fixtureNames = (): string[] => readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
export const loadFixture = (name: string): Fixture => JSON.parse(readFileSync(join(FIXTURE_DIR, `${name}.json`), "utf8")) as Fixture;
export const gid = (fx: Fixture, name: string): string => {
  const g = fx.names[name];
  if (!g) throw new Error(`fixture has no genotype ${name}`);
  return g;
};
export const nameOf = (fx: Fixture, g: string): string => Object.entries(fx.names).find(([, v]) => v === g)?.[0] ?? g;
```

- [ ] **Step 2: Write the failing test** `tests/unit/schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fixtureNames, loadFixture } from "./helpers/fixtures";
import { genotypeIdOf, kindOf, SCHEMA_VERSION, textOf, validateCustomData } from "../../src/schema";

describe("validateCustomData", () => {
  it.each(fixtureNames())("accepts every tagged element of fixture %s", (name) => {
    const bad = loadFixture(name).elements
      .filter((e) => e.customData)
      .map((e) => [e.id, validateCustomData(e.customData)] as const)
      .filter(([, r]) => !r.ok);
    expect(bad).toEqual([]);
  });
  it("rejects malformed customData", () => {
    const base = { schemaVersion: SCHEMA_VERSION, genotypeId: "g" };
    expect(validateCustomData({ ...base, kind: "genotype-allele", chromosome: "V", side: "top" }).ok).toBe(false);
    expect(validateCustomData({ ...base, kind: "genotype-allele", chromosome: "II", side: "left" }).ok).toBe(false);
    expect(validateCustomData({ ...base, kind: "genotype-frame", parents: { maternal: "a" } }).ok).toBe(false);
    expect(validateCustomData({ schemaVersion: SCHEMA_VERSION, kind: "cross-glyph" }).ok).toBe(false);
    expect(validateCustomData({ schemaVersion: SCHEMA_VERSION, kind: "cross-lineage" }).ok).toBe(false);
    expect(validateCustomData({ ...base, kind: "genotype-nonsense" }).ok).toBe(false);
    expect(validateCustomData("x").ok).toBe(false);
  });
  it("allows keys it does not own (Genotype carries them through)", () => {
    expect(validateCustomData({ schemaVersion: 2, kind: "genotype-glyph", genotypeId: "g", note: 1 }).ok).toBe(true);
  });
});

describe("accessors", () => {
  const el = { id: "a", type: "text", x: 0, y: 0, width: 1, height: 1, text: "w\n", originalText: "w", customData: { schemaVersion: 2, kind: "genotype-allele", genotypeId: "g", chromosome: "X", side: "top" } };
  it("reads kind, genotype id and text", () => {
    expect(kindOf(el)).toBe("genotype-allele");
    expect(genotypeIdOf(el)).toBe("g");
    expect(genotypeIdOf(null)).toBe(null);
    expect(textOf(el)).toBe("w");
    expect(textOf({ ...el, originalText: undefined, rawText: undefined })).toBe("w\n");
  });
});
```

- [ ] **Step 3: Run.** `npm test -- tests/unit/schema.test.ts`. Expected: FAIL (`validateCustomData` is not exported).

- [ ] **Step 4: Implement `src/schema/index.ts`.** Types as listed under Produces. `validateCustomData` encodes what the scripts write (README "Data model (schema v2)" and the `tag`/`addAppendUpdateCustomData` calls in `scripts/Genotype.md` 991-995, `scripts/Cross Genotypes.md` 998-1005 and 1231-1235 and 1259-1263, `scripts/Tidy.md` 1068-1072 and 1561-1563, label/criterion `data` in `addLabelBox`/`addArrowLabel` callers):
  - not a plain object: `{ ok: false, error: "not an object" }`;
  - `schemaVersion` must be `2`;
  - `kind` must be one of the ten kinds;
  - genotype kinds require a string `genotypeId`; `parents`, when present, must have string `maternal` and `paternal`;
  - `genotype-allele`: `chromosome` in `CHROMOSOME_ORDER`, `side` in `single|top|bottom`; `genotype-fraction`: `chromosome` in `CHROMOSOME_ORDER`; `genotype-separator`: `after` in `CHROMOSOME_ORDER`;
  - `cross-glyph`: `parents` required; `cross-lineage` and `cross-criterion`: string `childGenotypeId`;
  - every other key is allowed.
  If a fixture element fails, the validator is wrong (the fixtures are what the scripts write): fix the rule, not the fixture.

- [ ] **Step 5: Run.** `npm test -- tests/unit/schema.test.ts`. Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/schema tests/unit/helpers/fixtures.ts tests/unit/schema.test.ts
git commit -m "schema: v2 customData types and validators

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: scene

**Files:**
- Create: `src/scene/graph.ts`, `src/scene/snapshot.ts`, `src/scene/geometry.ts`, `src/scene/index.ts`, `tests/unit/scene.test.ts`

**Interfaces:**
- Consumes: `SceneElement`, `Parents`, `Chromosome`, `CHROMOSOME_ORDER`, `kindOf` (Task 3).
- Produces:
  - `src/scene/geometry.ts`: `export interface Point { x: number; y: number }`; `export interface Box { topX: number; topY: number; width: number; height: number }`; `export function boundingBox(els: readonly SceneElement[]): Box`; `export function lineagePoints(x1: number, y1: number, x2: number, y2: number): Array<[number, number]>`; `export function pathMidpoint(arrow: SceneElement): [number, number]`
  - `src/scene/graph.ts`: `export function genotypeElements(gid: string, all: readonly SceneElement[]): SceneElement[]`; `export function parentsOfGenotype(gid: string, all: readonly SceneElement[]): Parents | null`; `export function reconstructShorthand(gid: string, all: readonly SceneElement[]): string`; `export function walkAncestors(gid: string, all: readonly SceneElement[], visited?: Set<string>): Set<string>`; `export function walkDescendants(seeds: Iterable<string>, all: readonly SceneElement[]): Set<string>`; `export function collectLineage(gid: string, all: readonly SceneElement[]): Set<string>`; `export function extendWithOrphanGlyphs(lineage: Set<string>, all: readonly SceneElement[]): void`; `export function topDownDepths(lineage: ReadonlySet<string>, all: readonly SceneElement[]): Map<string, number>`; `export function computeDepths(lineage: ReadonlySet<string>, all: readonly SceneElement[]): Map<string, number>`; `export type SelectMode = "below" | "lineage"`; `export interface SelectionSet { genotypeIds: Set<string>; elements: SceneElement[] }`; `export function selectionSet(all: readonly SceneElement[], seed: string, mode: SelectMode): SelectionSet`
  - `src/scene/snapshot.ts`: `export interface GenotypeSnapshot { gid: string; members: SceneElement[]; parents: Parents | null; chromosomes: Chromosome[]; glyphChar: string | null; center: Point; originalCenter: Point; width: number; height: number; labelText: string | null; criterionText: string | null; boundary: boolean }`; `export interface SnapshotResult { snapshot: GenotypeSnapshot | null; furniture: SceneElement[]; notice: string | null }`; `export function snapshotGenotype(gid: string, all: readonly SceneElement[], lineage: ReadonlySet<string>, subsetMode: boolean): SnapshotResult`
  - `src/scene/index.ts`: re-exports all of the above.

- [ ] **Step 1: Write the failing test** `tests/unit/scene.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { gid, loadFixture, nameOf } from "./helpers/fixtures";
import { boundingBox, collectLineage, computeDepths, lineagePoints, pathMidpoint, selectionSet, snapshotGenotype } from "../../src/scene";

const names = (fx: ReturnType<typeof loadFixture>, ids: Iterable<string>) => [...ids].map((g) => nameOf(fx, g)).sort();

describe("lineage", () => {
  it("collects a whole connected family (joined-families)", () => {
    const fx = loadFixture("joined-families");
    expect(names(fx, collectLineage(gid(fx, "P1"), fx.elements))).toEqual(["A", "B", "C", "D", "E", "F", "P1", "P2", "P3", "Q1", "Q2"]);
  });
  it("places a genotype on the row where it is used (below)", () => {
    const fx = loadFixture("below");
    const lineage = collectLineage(gid(fx, "P1"), fx.elements);
    const d = computeDepths(lineage, fx.elements);
    const byName = Object.fromEntries([...d].map(([g, v]) => [nameOf(fx, g), v]));
    expect(byName).toEqual({ P1: 0, P2: 0, A: 1, B: 1, P3: 1, C: 2, D: 2, P4: 2, E: 3 });
  });
});

describe("selectionSet", () => {
  const fx = loadFixture("below");
  it("below: the genotype, its descendants and their mates", () => {
    expect(names(fx, selectionSet(fx.elements, gid(fx, "C"), "below").genotypeIds)).toEqual(["C", "E", "P4"]);
  });
  it("below: leaves out the arrow into the seed", () => {
    const s = selectionSet(fx.elements, gid(fx, "C"), "below");
    const arrowIntoC = fx.elements.find((e) => e.customData?.kind === "cross-lineage" && e.customData.childGenotypeId === gid(fx, "C"));
    expect(arrowIntoC && s.elements.includes(arrowIntoC)).toBe(false);
  });
  it("lineage: everything connected", () => {
    expect(names(fx, selectionSet(fx.elements, gid(fx, "C"), "lineage").genotypeIds)).toEqual(["A", "B", "C", "D", "E", "P1", "P2", "P3", "P4"]);
  });
});

describe("snapshotGenotype", () => {
  it("reads chromosomes, label and criterion (label-criterion)", () => {
    const fx = loadFixture("label-criterion");
    const lineage = collectLineage(gid(fx, "F"), fx.elements);
    const r = snapshotGenotype(gid(fx, "F"), fx.elements, lineage, false);
    expect(r.notice).toBe(null);
    expect(r.snapshot?.labelText).toBe("F1-a");
    expect(r.snapshot?.criterionText).toBe("non-Cy");
    expect(r.snapshot?.chromosomes.map((c) => c.label)).toEqual(["X", "II", "III"]);
    expect(r.furniture.some((e) => e.customData?.kind === "genotype-frame")).toBe(true);
  });
});

describe("geometry", () => {
  it("routes an elbow or a straight drop", () => {
    expect(lineagePoints(0, 0, 0.2, 100)).toEqual([[0, 0], [0, 100]]);
    expect(lineagePoints(0, 0, 50, 100)).toEqual([[0, 0], [0, 50], [50, 50], [50, 100]]);
  });
  it("finds the middle of a path", () => {
    const arrow = { id: "a", type: "arrow", x: 10, y: 10, width: 50, height: 100, points: [[0, 0], [0, 50], [50, 50], [50, 100]] as Array<[number, number]> };
    expect(pathMidpoint(arrow)).toEqual([35, 60]);
  });
  it("bounds text boxes and lines", () => {
    const t = { id: "t", type: "text", x: 0, y: 0, width: 10, height: 20 };
    const l = { id: "l", type: "line", x: 5, y: 30, width: 40, height: 0, points: [[0, 0], [40, 0]] as Array<[number, number]> };
    expect(boundingBox([t, l])).toEqual({ topX: 0, topY: 0, width: 45, height: 30 });
  });
});
```

- [ ] **Step 2: Run.** `npm test -- tests/unit/scene.test.ts`. Expected: FAIL (cannot resolve `../../src/scene`).

- [ ] **Step 3: Port.** Source `scripts/Tidy.md` on `undo-safe@88155fb`, pure functions with `ea` removed:
  - `genotypeElements` = `getGenotypeElements` (310-312); `parentsOfGenotype` = `getParentsFromGenotype` (314-323); `reconstructShorthand` (325-343, reads `el.text`); `walkAncestors`, `walkDescendants`, `collectLineage` (345-407); `topDownDepths`, `computeDepths` (411-467).
  - `extendWithOrphanGlyphs`: Tidy 877-891 (the `while (added)` loop), mutating `lineage`.
  - `selectionSet`: `scripts/Select Below.md` 440-500 (identical in `Select Lineage.md` 439-499 but for `MODE`): `seed` is a parameter, the elements are `all.filter(el => !el.isDeleted)`, returns the set and the `pick` list instead of selecting.
  - `snapshotGenotype`: Tidy 902-1003 (one iteration of the Phase A loop, with `below` = `subsetMode`). Returns `{ snapshot: null, notice }` where the loop `continue`s after a Notice (no allele elements: `Genotype ${gid.slice(0, 8)} has no allele elements; skipping.`; incomplete chromosome), `{ snapshot: null, notice: null }` where it `continue`s silently, and in `furniture` the label, frames, label boxes and (unless `boundary`) the criterion it pushes to `furnitureToDelete`, in the same order.
  - `lineagePoints`: Tidy 284-288. `pathMidpoint`: Tidy 253-267.
  - `boundingBox`: new, the pure equivalent of `ea.getBoundingBox` for unrotated elements: for elements with `points`, extent is `x + min(px)` to `x + max(px)` (same for y); otherwise `x` to `x + width`, `y` to `y + height`. Returns `{ topX, topY, width, height }`.

- [ ] **Step 4: Run.** `npm test -- tests/unit/scene.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/scene tests/unit/scene.test.ts
git commit -m "scene: lineages, depths, selection sets and genotype snapshots as pure functions

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: operation, hooks and the write guard

**Files:**
- Create: `src/operation/index.ts`, `src/operation/pure.ts`, `src/hooks.ts`, `tests/unit/operation.test.ts`, `tests/unit/write-guard.test.ts`
- Modify: `src/commands/index.ts` (add `operationEnv`)

**Interfaces:**
- Consumes: `EA`, `ExcalidrawViewLike`, `AppStateLike`, `newEA` (Task 1), `SceneElement` (Task 3), `TestingHooks.record` (Task 1).
- Produces:
  - `src/hooks.ts`: `export interface HookMap { _genotypeAuto: GenotypeAuto; _genotypeFormProbe: boolean; _genotypeFormState: unknown; _genotypeCreateAt: { x: number; y: number }; _genotypeDefaultGlyph: string | null; _genotypeLastResult: string | null; _genotypeFormModal: unknown; _crossGenotypesAuto: CrossAuto; _crossGenotypesLastResult: string | null; _crossGenotypesModal: unknown; _crossGenotypesOptions: unknown; _tidyLastResult: number; _flySelectResult: { mode: string; genotypes: number; genotypeIds: string[]; elements: number }; _flyCrossMode: { stop(message?: string): void; view: unknown }; _flyOperations: unknown; _flyMigrationAuto: { scriptFolder?: string; confirm: boolean }; _flyMigrationResult: { trashed: string[]; declined: boolean } }`, `export interface GenotypeAuto { glyph: string | null; X: { top: string; bottom: string }; II: { top: string; bottom: string }; III: { top: string; bottom: string } }`, `export interface CrossAuto { offspringGlyph: string | null; pick?: Partial<Record<"X" | "II" | "III", number>>; labelText?: string; criterionText?: string }`, `export function take<K extends keyof HookMap>(key: K): HookMap[K] | undefined`, `export function peek<K extends keyof HookMap>(key: K): HookMap[K] | undefined`, `export function put<K extends keyof HookMap>(key: K, value: HookMap[K] | undefined): void`
  - `src/operation/pure.ts`: `export function sameDrawn(a: SceneElement | undefined, b: SceneElement | undefined): boolean` (flySame); `export function raise(el: SceneElement, current: SceneElement | undefined, by: number, nonce?: () => number): SceneElement` (flyRaise); `export type FinishPlan = { changed: false } | { changed: true; first: SceneElement[]; second: SceneElement[]; third(index: ReadonlyMap<string, string | null | undefined>): SceneElement[] }`; `export function planFinish(before: readonly SceneElement[] | null, now: readonly SceneElement[], nonce?: () => number): FinishPlan`
  - `src/operation/index.ts`: `export interface OperationEnv { newEA(view: ExcalidrawViewLike): EA; reportError(name: string, error: unknown): void }`; `export type ElementPatch = Partial<SceneElement>`; `export interface OperationContext { readonly name: string; readonly app: App; readonly view: ExcalidrawViewLike; readonly ea: EA; commit(): Promise<void>; commitPatches(patches: ReadonlyMap<string, ElementPatch>, added?: readonly SceneElement[]): Promise<void>; deleteElements(elements: readonly SceneElement[]): void; setAppState(appState: Partial<AppStateLike>): void; selectElements(elements: readonly SceneElement[]): void; join<T>(name: string, body: (ctx: OperationContext) => Promise<T>): Promise<T> }`; `export function runOperation<T>(app: App, env: OperationEnv, view: ExcalidrawViewLike, name: string, body: (ctx: OperationContext) => Promise<T>): Promise<T | undefined>`; `export function setAppState(view: ExcalidrawViewLike, appState: Partial<AppStateLike>): void`; `export function unrecordLastStep(view: ExcalidrawViewLike, elementId: string): Promise<boolean>`; `export function openOperation(view: ExcalidrawViewLike): unknown` (the registry entry, for Cross Mode's and the tests' checks)
  - `src/commands/index.ts`: `export function operationEnv(plugin: FlyGeneticsPlugin): OperationEnv`

- [ ] **Step 1: Write the failing tests.**

`tests/unit/operation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { planFinish, raise, sameDrawn } from "../../src/operation/pure";
import type { SceneElement } from "../../src/schema";

const el = (id: string, patch: Partial<SceneElement> = {}): SceneElement =>
  ({ id, type: "text", x: 0, y: 0, width: 10, height: 10, version: 1, versionNonce: 1, index: "a0", ...patch });

describe("sameDrawn", () => {
  it("ignores version, versionNonce and updated", () => {
    expect(sameDrawn(el("a"), el("a", { version: 5, versionNonce: 9, updated: 3 }))).toBe(true);
  });
  it("treats absent and deleted alike", () => {
    expect(sameDrawn(undefined, el("a", { isDeleted: true }))).toBe(true);
    expect(sameDrawn(undefined, el("a"))).toBe(false);
  });
  it("sees a moved element and ignores undefined keys", () => {
    expect(sameDrawn(el("a"), el("a", { x: 1 }))).toBe(false);
    expect(sameDrawn(el("a", { link: undefined }), el("a"))).toBe(true);
  });
});

describe("raise", () => {
  it("keeps the scene's copy when versions match", () => {
    const cur = el("a", { version: 4 });
    expect(raise(el("a", { version: 4 }), cur, 1)).toBe(cur);
  });
  it("raises past the scene's version", () => {
    expect(raise(el("a", { version: 2 }), el("a", { version: 7 }), 1, () => 42)).toMatchObject({ version: 8, versionNonce: 42 });
  });
});

describe("planFinish", () => {
  it("records nothing when no element changed", () => {
    expect(planFinish([el("a")], [el("a", { version: 3 })]).changed).toBe(false);
    expect(planFinish(null, [el("a")]).changed).toBe(false);
  });
  it("puts removed elements back as deleted and new ones on top", () => {
    const before = [el("a"), el("b", { index: "a1" })];
    const now = [el("a", { x: 5, version: 2 }), el("c", { index: "a2", version: 1 })];
    const p = planFinish(before, now, () => 7);
    if (!p.changed) throw new Error("expected a change");
    expect(p.first.map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(p.first.find((e) => e.id === "b")?.isDeleted).toBe(true);
    expect(p.first.find((e) => e.id === "c")?.index).toBe(null);
    expect(p.second.map((e) => e.id)).toEqual(["a", "b"]);
    const third = p.third(new Map([["c", "a5"]]));
    expect(third.find((e) => e.id === "c")?.index).toBe("a5");
    expect(third.find((e) => e.id === "a")?.x).toBe(5);
  });
});
```

`tests/unit/write-guard.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

// Every scene write goes through src/operation (the undo-safe transaction):
// no other source file may call these.
const ROOT = join(__dirname, "..", "..");
const SRC = join(ROOT, "src");
const OPERATION = join(SRC, "operation") + sep;
const FORBIDDEN: Array<[string, RegExp]> = [
  ["updateScene", /\bupdateScene\s*\(/],
  ["addElementsToView", /\baddElementsToView\s*\(/],
  ["deleteViewElements", /\bdeleteViewElements\s*\(/],
  ["history API", /\.history\s*(\?\.|\.)/],
];
const stripComments = (ts: string) => ts.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
const violations = (ts: string) => FORBIDDEN.filter(([, re]) => re.test(stripComments(ts))).map(([n]) => n);
const tsFiles = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? tsFiles(p) : p.endsWith(".ts") ? [p] : [];
});

describe("write guard", () => {
  it("detects each forbidden call and ignores comments", () => {
    expect(violations("view.updateScene({ appState: {} })")).toEqual(["updateScene"]);
    expect(violations("await ea.addElementsToView(false, false, true)")).toEqual(["addElementsToView"]);
    expect(violations("ea.deleteViewElements(els)")).toEqual(["deleteViewElements"]);
    expect(violations("api.history?.undo?.()")).toEqual(["history API"]);
    expect(violations("api.history.clear()")).toEqual(["history API"]);
    expect(violations("// ea.addElementsToView()\n/* updateScene( */ const url = 'https://x';")).toEqual([]);
  });
  it("finds no scene write or history call outside src/operation", () => {
    const bad = tsFiles(SRC)
      .filter((f) => !f.startsWith(OPERATION))
      .flatMap((f) => violations(readFileSync(f, "utf8")).map((v) => `${relative(ROOT, f)}: ${v}`));
    expect(bad).toEqual([]);
  });
});
```

- [ ] **Step 2: Run.** `npm test -- tests/unit/operation.test.ts tests/unit/write-guard.test.ts`. Expected: `operation.test.ts` FAILS (cannot resolve `src/operation/pure`); `write-guard.test.ts` PASSES already (it must stay green from now on; its sample test proves it can fail).

- [ ] **Step 3: Port the pure parts** into `src/operation/pure.ts` from the undo-safe block on the merged `main` (on `undo-safe@88155fb`: `scripts/Tidy.md` 148-167 `flyRaise`, `flySame`; 196-207 the body of `flyFinish` after the `changed` test). `planFinish` returns `{ changed: false }` when `before` is null or every id is `sameDrawn`; otherwise `first` = `[...kept.map(el => at(final(el), 1)), ...added.map(el => at(el, 1, { index: null }))]`, `second` = `kept.map(el => at(el, 2))`, `third(index)` = `[...kept.map(el => at(final(el), 3)), ...added.map(el => at(el, 3, { index: index.get(el.id) }))]`, with `kept`, `added`, `final`, `at`, `base`, `untouched` exactly as in the script and `nonce` injectable (default `Math.floor(Math.random() * 2 ** 31)`). If the merged block changed these lines, port the merged lines and adjust the test's expectations only where the merged design doc says the behavior changed.

- [ ] **Step 4: Port the transaction** into `src/operation/index.ts`. Source: the whole undo-safe block on the merged `main` (on `undo-safe@88155fb`: `scripts/Tidy.md` 64-208) plus Cross Mode's `unrecordLine` (`scripts/Cross Mode.md` 268-278). Mapping:

  | Script | `src/operation/index.ts` |
  |---|---|
  | `window._flyOperations` (WeakMap keyed by view; on merged `main`, keyed by the drawing's file per the review fix) | a module-level registry of the same type and key, also stored on `window._flyOperations` via `put` so the tests' `window._flyOperations?.get(...)` keeps working; `openOperation(view)` returns the open entry or `undefined` |
  | `flyOperation(name, body)` | `runOperation(app, env, view, name, body)` for a top-level command and `ctx.join(name, body)` for a nested one; both create a fresh `EA` with `env.newEA(view)` (its own workbench and savepoint key, as each script had its own `ea`); the Excalidraw 2.20.2 guard stays as in the block (`ea.verifyMinimumPluginVersion?.("2.20.2")`, same Notice); on error, roll back that context's own changes (the merged block's rollback: savepoint or touched ids) with `NEVER`, call `env.reportError(name, e)` and re-throw; `runOperation` resolves to `undefined` after a reported error so the command wrapper does not record it twice |
  | `flyStart(name)` with its `expected` reservation and 15 s timer | not needed: `ctx.join` awaits the nested body inside the open operation, so the operation cannot end between parent and child. If the merged `main` gives `expected` any other role (for example Cross Mode child-failure handling), port that behavior onto `join` and describe it in the commit message |
  | `flyChanging()` | private `changing(op, ctx)`: takes `before` on the operation's first change and the context's savepoint on its first change |
  | `flyAddElementsToView()` | `ctx.commit()`: `changing`, then `ctx.ea.addElementsToView(false, false, true, false, "NEVER")` |
  | `flyDeleteViewElements(els)` | `ctx.deleteElements(els)` (same `updateScene` with `NEVER`) |
  | `flyRaise`, `flySame`, `flyFinish` | `raise`, `sameDrawn`, `planFinish` from `pure.ts`, applied by a private `finish(op)` that keeps the one-frame wait, the `done`/`running` guards and the three `view.updateScene` calls with the selections exactly as `flyFinish` |
  | selection `updateScene({ appState })` | `ctx.setAppState(appState)` and exported `setAppState(view, appState)` (plain `view.excalidrawAPI.updateScene({ appState })`, no elements, no `captureUpdate`, as the scripts did) |
  | `ea.selectElementsInView(els)` | `ctx.selectElements(els)` = `ctx.ea.selectElementsInView(els)` |
  | Cross Mode `unrecordLine(line)` | `unrecordLastStep(view, lineId)`: same body, `api.history?.undo?.()`, one frame, compare, `redo` when needed |
  | workbench edit then commit | `ctx.commitPatches(patches, added)`: `ctx.ea.clear()`; `ctx.ea.elementsDict[el.id] = structuredClone(el)` for each `added` (in order); for each patch, `copyViewElementsToEAforEditing([viewEl])` (skipping ids already in the workbench) and `Object.assign(ctx.ea.getElement(id), patch)`; then `ctx.commit()` and `ctx.ea.clear()` |

  Write the module header comment from the block's own comment (design summary and rules), pointing to `docs/plans/2026-09-29-undo-safe-design.md`.

- [ ] **Step 5: Add `src/hooks.ts`** (types as in Produces; `take` reads `window[key]`, sets it to `undefined`, returns the value; `peek` reads; `put` writes; `declare global { interface Window extends Partial<HookMap> {} }`). Add to `src/commands/index.ts`:

```ts
export function operationEnv(plugin: FlyGeneticsPlugin): OperationEnv {
  return { newEA, reportError: (name, error) => plugin.testing.record(name, error) };
}
```

- [ ] **Step 6: Run.** `npm test`. Expected: all unit tests PASS (version, schema, scene, operation, write guard). `npm run build`. Expected: no type errors.

- [ ] **Step 7: Commit.**

```bash
git add src/operation src/hooks.ts src/commands/index.ts tests/unit/operation.test.ts tests/unit/write-guard.test.ts
git commit -m "operation: port the undo-safe transaction; guard scene writes to it

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

Operation's Obsidian behavior (one undo step, rollback, nested joins) is proven by `tests/undo.sh` once the commands exist (Tasks 11 to 18).

---

## Task 6: duplicates

**Files:**
- Create: `src/duplicates/plan.ts`, `src/duplicates/index.ts`, `tests/unit/duplicates.test.ts`

**Interfaces:**
- Consumes: `SceneElement`, `Parents` (Task 3), `boundingBox` (Task 4), `OperationContext.commitPatches` (Task 5), `DUPLICATE_TIE_PX = 25`, `DUPLICATE_SHIFT_PX = 2` (put in `src/constants.ts`, created here).
- Produces:
  - `src/duplicates/plan.ts`: `export interface DuplicateSplitPlan { patches: Map<string, Partial<SceneElement>> }`; `export function planDuplicateSplit(all: readonly SceneElement[], newId?: () => string): DuplicateSplitPlan | null`
  - `src/duplicates/index.ts`: `export async function splitDuplicateGenotypes(ctx: OperationContext): Promise<boolean>`

- [ ] **Step 1: Write the failing test** `tests/unit/duplicates.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { gid, loadFixture } from "./helpers/fixtures";
import { planDuplicateSplit } from "../../src/duplicates/plan";
import type { SceneElement } from "../../src/schema";

const counter = () => { let n = 0; return () => `new-${++n}`; };

// Excalidraw's Cmd+D / copy-paste: same customData, new ids, a new group, moved by (dx, dy).
function copy(els: SceneElement[], dx: number, dy: number, tag: string): SceneElement[] {
  const ids = new Map(els.map((e) => [e.id, `${e.id}-${tag}`]));
  const groups = new Map<string, string>();
  const g = (id: string) => groups.get(id) ?? groups.set(id, `${id}-${tag}`).get(id)!;
  return els.map((e) => ({
    ...structuredClone(e),
    id: ids.get(e.id)!,
    x: e.x + dx, y: e.y + dy,
    groupIds: (e.groupIds ?? []).map(g),
    boundElements: (e.boundElements ?? []).filter((b) => ids.has(b.id)).map((b) => ({ ...b, id: ids.get(b.id)! })),
    containerId: e.containerId && ids.has(e.containerId) ? ids.get(e.containerId)! : e.containerId ?? null,
    startBinding: e.startBinding && ids.has(e.startBinding.elementId) ? { ...e.startBinding, elementId: ids.get(e.startBinding.elementId)! } : null,
    endBinding: e.endBinding && ids.has(e.endBinding.elementId) ? { ...e.endBinding, elementId: ids.get(e.endBinding.elementId)! } : null,
  }));
}
const cd = (plan: ReturnType<typeof planDuplicateSplit>, id: string) => plan?.patches.get(id)?.customData;

describe("planDuplicateSplit", () => {
  const fx = loadFixture("backcross");
  const of = (name: string) => fx.elements.filter((e) => e.customData?.genotypeId === gid(fx, name));

  it("does nothing without duplicates", () => {
    expect(planDuplicateSplit(fx.elements, counter())).toBe(null);
  });

  it("gives a copied founder a fresh genotypeId", () => {
    const dup = copy(of("P2"), 10, 10, "c");
    const plan = planDuplicateSplit([...fx.elements, ...dup], counter());
    const fresh = new Set(dup.map((e) => cd(plan, e.id)?.genotypeId));
    expect(fresh.size).toBe(1);
    expect([...fresh][0]).toMatch(/^new-/);
    for (const e of of("P2")) expect(plan?.patches.has(e.id) && cd(plan, e.id)?.genotypeId !== gid(fx, "P2")).toBe(false);
  });

  it("makes a lone copied offspring a founder", () => {
    const dup = copy(of("A"), 10, 10, "c");
    const plan = planDuplicateSplit([...fx.elements, ...dup], counter());
    for (const e of dup) {
      expect(cd(plan, e.id)?.genotypeId).toMatch(/^new-/);
      expect(cd(plan, e.id)?.parents).toBeUndefined();
    }
  });

  it("keeps a copied family a family", () => {
    const glyph = fx.elements.filter((e) => e.customData?.kind === "cross-glyph");
    const arrow = fx.elements.filter((e) => e.customData?.kind === "cross-lineage" || e.customData?.kind === "cross-criterion");
    const dup = copy([...of("P1"), ...of("P2"), ...of("A"), ...glyph, ...arrow], 400, 0, "c");
    const plan = planDuplicateSplit([...fx.elements, ...dup], counter());
    const newGid = (name: string) => cd(plan, `${of(name)[0].id}-c`)?.genotypeId;
    const [p1, p2, a] = [newGid("P1"), newGid("P2"), newGid("A")];
    expect(new Set([p1, p2, a]).size).toBe(3);
    expect(cd(plan, `${of("A")[0].id}-c`)?.parents).toEqual({ maternal: p1, paternal: p2 });
    expect(cd(plan, `${glyph[0].id}-c`)?.parents).toEqual({ maternal: p1, paternal: p2 });
    const arrowCopy = dup.find((e) => e.customData?.kind === "cross-lineage")!;
    expect(cd(plan, arrowCopy.id)?.childGenotypeId).toBe(a);
  });
});
```

- [ ] **Step 2: Run.** `npm test -- tests/unit/duplicates.test.ts`. Expected: FAIL (cannot resolve `src/duplicates/plan`).

- [ ] **Step 3: Port.** Source: the "Duplicated genotypes (same in every script; keep in sync)" block, `splitDuplicateGenotypes` (on `undo-safe@88155fb`: `scripts/Tidy.md` 574-813; byte-identical in the other six scripts). `planDuplicateSplit`:
  - replaces `ea.getViewElements().filter(el => !el.isDeleted)` with `all.filter(el => !el.isDeleted)`, `ea.getBoundingBox` with `boundingBox`, `crypto.randomUUID()` with `newId()`;
  - replaces the workbench loop (from `ea.clear();` after `newlyBound` to the end) with the same decisions recorded as patches: `edit(el).isDeleted = true` becomes `patches.set(id, { ...patches.get(id), isDeleted: true })`, and likewise for `customData`, `startBinding` and `boundElements`;
  - returns `null` where the script returns `false` (`!dup.size`), else `{ patches }`.
  `splitDuplicateGenotypes(ctx)` = `const plan = planDuplicateSplit(ctx.ea.getViewElements()); if (!plan) return false; await ctx.commitPatches(plan.patches); return true;`. Keep the block's long comment as the module comment.

- [ ] **Step 4: Run.** `npm test -- tests/unit/duplicates.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/duplicates src/constants.ts tests/unit/duplicates.test.ts
git commit -m "duplicates: copied genotypes become their own, copied families stay families

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: backcross

**Files:**
- Create: `src/backcross/plan.ts`, `src/backcross/index.ts`, `tests/unit/backcross.test.ts`

**Interfaces:**
- Consumes: `topDownDepths` (Task 4), `SceneElement`, `Parents` (Task 3), `OperationContext.commitPatches` (Task 5).
- Produces:
  - `src/backcross/plan.ts`: `export interface MultiRowPlan { copies: string[]; added: SceneElement[]; patches: Map<string, Partial<SceneElement>> }`; `export function planMultiRowSplit(all: readonly SceneElement[], lineage: ReadonlySet<string>, subset: Set<string> | null, newId?: () => string): MultiRowPlan | null` (mutates `subset` exactly as the script does)
  - `src/backcross/index.ts`: `export async function splitMultiRowParents(ctx: OperationContext, lineage: ReadonlySet<string>, subset?: Set<string> | null): Promise<string[]>`

- [ ] **Step 1: Write the failing test** `tests/unit/backcross.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { planMultiRowSplit } from "../../src/backcross/plan";
import type { Parents, SceneElement } from "../../src/schema";

const counter = () => { let n = 0; return () => `new-${++n}`; };
let seq = 0;
const allele = (g: string, parents?: Parents): SceneElement => ({
  id: `e${++seq}`, type: "text", x: 0, y: 0, width: 10, height: 10, groupIds: [`grp-${g}`], boundElements: [],
  text: "w", customData: { schemaVersion: 2, kind: "genotype-allele", genotypeId: g, chromosome: "X", side: "top", ...(parents ? { parents } : {}) },
});
const frame = (g: string): SceneElement => ({ ...allele(g), type: "rectangle", customData: { schemaVersion: 2, kind: "genotype-frame", genotypeId: g } });
const glyph = (m: string, p: string): SceneElement => ({ id: `x-${m}-${p}`, type: "text", x: 0, y: 0, width: 10, height: 10, customData: { schemaVersion: 2, kind: "cross-glyph", parents: { maternal: m, paternal: p } } });

// P1 x P2 -> A; A x P2 -> B (a backcross to the father).
const scene = () => [allele("P1"), allele("P2"), frame("P2"), allele("A", { maternal: "P1", paternal: "P2" }), glyph("P1", "P2"),
  allele("B", { maternal: "A", paternal: "P2" }), glyph("A", "P2")];

describe("planMultiRowSplit", () => {
  it("copies a parent crossed on two rows for the lower cross", () => {
    const all = scene();
    const plan = planMultiRowSplit(all, new Set(["P1", "P2", "A", "B"]), null, counter())!;
    expect(plan.copies).toEqual(["new-1"]);
    const copyEls = plan.added.filter((e) => e.customData?.genotypeId === "new-1");
    expect(copyEls.map((e) => e.customData?.kind)).toEqual(["genotype-allele"]); // frames are regenerated by Tidy
    expect(copyEls[0].customData?.parents).toBeUndefined();
    expect(copyEls[0].boundElements).toEqual([]);
    const b = all.find((e) => e.customData?.genotypeId === "B")!;
    expect(plan.patches.get(b.id)?.customData?.parents).toEqual({ maternal: "A", paternal: "new-1" });
    expect(plan.patches.get("x-A-P2")?.customData?.parents).toEqual({ maternal: "A", paternal: "new-1" });
    expect(plan.patches.has("x-P1-P2")).toBe(false);
  });
  it("does nothing when every parent is used on one row", () => {
    expect(planMultiRowSplit(scene().slice(0, 5), new Set(["P1", "P2", "A"]), null, counter())).toBe(null);
  });
  it("subset mode: the copy joins the subset, the original leaves it", () => {
    const subset = new Set(["A", "P2", "B"]);
    planMultiRowSplit(scene(), new Set(["P1", "P2", "A", "B"]), subset, counter());
    expect([...subset].sort()).toEqual(["A", "B", "new-1"]);
  });
});
```

- [ ] **Step 2: Run.** `npm test -- tests/unit/backcross.test.ts`. Expected: FAIL (cannot resolve `src/backcross/plan`).

- [ ] **Step 3: Port.** Source: `splitMultiRowParents` (on `undo-safe@88155fb`: `scripts/Tidy.md` 469-572, with its comment 469-490). `planMultiRowSplit` takes `all` (the script's `ea.getViewElements().filter(el => !el.isDeleted)`), keeps the crosses, `inSubset`, `parentsInSubset`, `swap`, `copyOf` and subset updates unchanged, and returns `null` where the script returns `[]`. The copy loop pushes each `structuredClone`d element (new id `newId()`, `groupIds: [group]`, `boundElements: []`, `containerId: null`, `customData` without `parents` and with `genotypeId: copy`) to `added` instead of `ea.elementsDict`; the rewire loop records `{ customData: { ...el.customData, parents: {...} } }` in `patches`. `splitMultiRowParents(ctx, lineage, subset)` = plan with `ctx.ea.getViewElements().filter(el => !el.isDeleted)`, then `await ctx.commitPatches(plan.patches, plan.added)`, return `plan.copies` (or `[]`). `commitPatches` puts `added` in the workbench first, as the script did.

- [ ] **Step 4: Run.** `npm test -- tests/unit/backcross.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/backcross tests/unit/backcross.test.ts
git commit -m "backcross: a parent crossed on two rows gets a copy per lower cross

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: layout (pure), driven by fixture goldens

**Files:**
- Create: `src/layout/index.ts`, `tests/capture-layout-golden.sh`, `tests/unit/golden/tidy-<fixture>.json` (8 files, captured), `tests/unit/helpers/layout-input.ts`, `tests/unit/layout.test.ts`
- Modify: `src/constants.ts` (layout constants)

**Interfaces:**
- Consumes: `Point`, `boundingBox`, `collectLineage`, `extendWithOrphanGlyphs`, `computeDepths`, `snapshotGenotype`, `lineagePoints` (Task 4), `SceneElement`, `Parents` (Task 3).
- Produces (`src/layout/index.ts`, no Excalidraw calls):
  - constants in `src/constants.ts`: `GENERATION_GAP_Y = 140`, `SIBLING_GAP_X = 60`, `FRAME_PAD = 4`, `FRAME_GAP = SIBLING_GAP_X - 2 * FRAME_PAD`, `GLYPH_PAD = 8`
  - `export interface LayoutNode { gid: string; parents: Parents | null; width: number; height: number; half: number; originalCenter: Point; boundary: boolean }`
  - `export interface LayoutInput { nodes: LayoutNode[]; depths: ReadonlyMap<string, number>; crossPairs: Array<[string, string]>; crossW: number; subset: boolean }`
  - `export interface RowBands { sortedDepths: number[]; rowTop: Map<number, number>; rowBottom: Map<number, number> }`
  - `export interface LayoutResult { centers: Map<string, Point>; glyphX: Map<string, number>; unitOf: Map<string, string[]>; anchors: string[]; rows: RowBands }`
  - `export function parentPairKey(node: Pick<LayoutNode, "parents">, known: ReadonlySet<string>): string | null`
  - `export function collectCrossPairs(nodes: readonly LayoutNode[], all: readonly SceneElement[]): Array<[string, string]>`
  - `export function layoutLineage(input: LayoutInput): LayoutResult`
  - `export function linearize(...)`, `export function layoutUnit(...)`, `export function resolveRow(...)` (exported for tests; signatures as in the script with `snapshotByGid`, `ox` and `CROSS_W` passed in a `RowContext` argument: `export interface RowContext { half(gid: string): number; ox(gid: string): number; crossW: number }`)
  - `export interface ArrowObstacle { depth: number; left: number; right: number }`
  - `export function childArrowPoints(from: { x: number; y: number; depth: number }, to: { x: number; y: number; depth: number }, rows: RowBands, obstacles: readonly ArrowObstacle[]): Array<[number, number]>`
  - `export interface ClearBox { x: number; y: number; w: number; h: number; gid?: string; parents?: Array<string | undefined> }`
  - `export function lineageBoxes(els: readonly SceneElement[]): ClearBox[]`; `export function segmentBoxes(els: readonly SceneElement[], lookup: { get(id: string): SceneElement | undefined }): ClearBox[]`; `export function clearance(mine: readonly ClearBox[], others: readonly ClearBox[]): { ok(shift: number): boolean; candidates: number[] }`; `export function clearingShift(mine: readonly ClearBox[], others: readonly ClearBox[]): number`; `export function boundLineagePoints(arrow: SceneElement, lookup: { get(id: string): SceneElement | undefined }): Array<[number, number]> | null`

- [ ] **Step 1: Capture the goldens with the scripts.** Create `tests/capture-layout-golden.sh`:

```bash
#!/usr/bin/env bash
# Captures what the Tidy SCRIPT makes of each single-lineage fixture, for the
# layout unit tests (tests/unit/layout.test.ts): loads the fixture, runs Tidy
# with nothing selected, and writes the live elements to
# tests/unit/golden/tidy-<fixture>.json. Run with the scripts engine (the
# reference), before the scripts are retired: FLY_ENGINE=scripts FLY_FROZEN=1.
source "$(dirname "$0")/lib.sh"
fly_test <<'JS'
const fs = require('fs');
const list = ['below', 'joined-families', 'three-partners', 'sibling-chain', 'sibling-cross', 'sibling-order', 'select-move', 'label-criterion'];
fs.mkdirSync(T.repo + '/tests/unit/golden', { recursive: true });
for (const s of list) {
  await T.fixture(s);
  const before = new Set(F.live().filter(e => e.customData?.genotypeId).map(e => e.customData.genotypeId));
  await T.tidyAll();
  const after = F.live();
  const now = new Set(after.filter(e => e.customData?.genotypeId).map(e => e.customData.genotypeId));
  if (now.size !== before.size) { T.check('FAIL: ' + s + ': Tidy changed the set of genotypes; not a layout golden'); continue; }
  fs.writeFileSync(T.repo + '/tests/unit/golden/tidy-' + s + '.json', JSON.stringify({ fixture: s, names: window.__t, elements: after }) + '\n');
  T.check('PASS: captured ' + s + ' (' + after.length + ' elements)');
}
JS
```

Run: `FLY_ENGINE=scripts FLY_FROZEN=1 bash tests/capture-layout-golden.sh`. Expected: eight `PASS: captured` lines. (Confirm the "Before you start" dev-vault check first.)

- [ ] **Step 2: Write the input helper** `tests/unit/helpers/layout-input.ts`:

```ts
import { boundingBox, collectLineage, computeDepths, extendWithOrphanGlyphs, snapshotGenotype, type Point } from "../../../src/scene";
import { collectCrossPairs, type LayoutInput, type LayoutNode } from "../../../src/layout";
import { FRAME_PAD } from "../../../src/constants";
import type { SceneElement } from "../../../src/schema";

const RENDERED = new Set(["genotype-allele", "genotype-fraction", "genotype-separator", "genotype-glyph"]);

// The layout input Tidy builds from `before` (the fixture), with the sizes it
// measured taken from `after` (the Tidy script's result, which has the same
// rendered sizes), and where the script put each genotype and x glyph.
export function layoutInputFromScenes(before: SceneElement[], after: SceneElement[]) {
  const live = before.filter((e) => !e.isDeleted);
  const founder = live.find((e) => e.customData?.genotypeId && !e.customData.parents)!.customData!.genotypeId!;
  const lineage = collectLineage(founder, live);
  extendWithOrphanGlyphs(lineage, live);
  const depths = computeDepths(lineage, live);
  const nodes: LayoutNode[] = [];
  const centers = new Map<string, Point>();
  for (const gid of lineage) {
    const snap = snapshotGenotype(gid, live, lineage, false).snapshot;
    if (!snap) continue;
    const drawn = after.filter((e) => e.customData?.genotypeId === gid && RENDERED.has(String(e.customData.kind)));
    const b = boundingBox(drawn);
    centers.set(gid, { x: b.topX + b.width / 2, y: b.topY + b.height / 2 });
    const labelBox = after.find((e) => e.customData?.genotypeId === gid && e.customData.kind === "genotype-label-box");
    const hasPair = !!snap.parents && lineage.has(snap.parents.maternal) && lineage.has(snap.parents.paternal);
    const lw = snap.labelText && hasPair && labelBox ? labelBox.width : 0;
    nodes.push({ gid, parents: snap.parents, width: b.width, height: b.height, half: Math.max(b.width / 2 + FRAME_PAD, lw / 2), originalCenter: snap.originalCenter, boundary: false });
  }
  const glyphs = after.filter((e) => e.customData?.kind === "cross-glyph");
  const glyphX = new Map(glyphs.map((g) => [`${g.customData!.parents!.maternal}|${g.customData!.parents!.paternal}`, g.x + g.width / 2]));
  const input: LayoutInput = { nodes, depths, crossPairs: collectCrossPairs(nodes, live), crossW: glyphs[0]?.width ?? 0, subset: false };
  return { input, expected: { centers, glyphX } };
}
```

- [ ] **Step 3: Write the failing test** `tests/unit/layout.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadFixture } from "./helpers/fixtures";
import { layoutInputFromScenes } from "./helpers/layout-input";
import { childArrowPoints, clearingShift, layoutLineage } from "../../src/layout";

const GOLDEN = ["below", "joined-families", "three-partners", "sibling-chain", "sibling-cross", "sibling-order", "select-move", "label-criterion"];

describe.each(GOLDEN)("layoutLineage reproduces the Tidy script: %s", (name) => {
  const fx = loadFixture(name);
  const golden = JSON.parse(readFileSync(join(__dirname, "golden", `tidy-${name}.json`), "utf8"));
  const { input, expected } = layoutInputFromScenes(fx.elements, golden.elements);
  const out = layoutLineage(input);
  it("places every genotype where Tidy did (0.5 px)", () => {
    for (const [gid, c] of expected.centers) {
      const got = out.centers.get(gid);
      expect(got, gid).toBeDefined();
      expect(Math.abs(got!.x - c.x)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(got!.y - c.y)).toBeLessThanOrEqual(0.5);
    }
  });
  it("places every x glyph where Tidy did (0.5 px)", () => {
    for (const [key, x] of expected.glyphX) expect(Math.abs((out.glyphX.get(key) ?? NaN) - x), key).toBeLessThanOrEqual(0.5);
  });
});

describe("childArrowPoints", () => {
  const rows = { sortedDepths: [0, 1, 2], rowTop: new Map([[0, 0], [1, 150], [2, 300]]), rowBottom: new Map([[0, 50], [1, 200], [2, 350]]) };
  it("uses a plain elbow into the next row", () => {
    expect(childArrowPoints({ x: 0, y: 40, depth: 0 }, { x: 100, y: 146, depth: 1 }, rows, [])).toEqual([[0, 40], [0, 93], [100, 93], [100, 146]]);
  });
  it("takes a clear lane past the rows in between", () => {
    const pts = childArrowPoints({ x: 0, y: 40, depth: 0 }, { x: 100, y: 296, depth: 2 }, rows, [{ depth: 1, left: -20, right: 20 }]);
    expect(pts).toEqual([[0, 40], [0, 100], [46, 100], [46, 250], [100, 250], [100, 296]]);
  });
});

describe("clearingShift", () => {
  it("does not move a clear lineage and moves an overlapping one the least", () => {
    expect(clearingShift([{ x: 0, y: 0, w: 10, h: 10 }], [{ x: 200, y: 0, w: 10, h: 10 }])).toBe(0);
    expect(clearingShift([{ x: 0, y: 0, w: 10, h: 10 }], [{ x: 5, y: 0, w: 10, h: 10 }])).toBe(-57);
  });
});
```

(Arithmetic for the last two: `FRAME_GAP` = 52; into the next row `midY = (40 + 146) / 2 = 93`. Lane case: obstacles clear by `FRAME_GAP / 4 = 13`, so 0 is blocked; candidates 0, 100, -46, 46; 100 and 46 tie on distance 100, the lower wins; `yTop = (50 + 150) / 2 = 100`, `yLow = min((200 + 300) / 2, 296 - 4) = 250`. Clearing: gap 52, bad interval `[5 - 10 - 52, 5 + 10 - 0 + 52] = [-57, 67]`; candidates sorted by size (rightward only breaks equal sizes): 0 is inside the interval, then -57 (size 57) clears before 67 is tried. If the port disagrees, re-derive by hand from `clearance` (Tidy 1909-1923) before changing the test.)

- [ ] **Step 4: Run.** `npm test -- tests/unit/layout.test.ts`. Expected: FAIL (cannot resolve `src/layout`).

- [ ] **Step 5: Port the layout** into `src/layout/index.ts`. Source `scripts/Tidy.md` on `undo-safe@88155fb`, inside `tidyLineage`:
  - `layoutLineage`: 1203-1226 (buckets, `rowHeights`, `depthY`), 1243-1246, 1313-1334 (`placeAt`, `gapMidX`), 1322-1325 helpers, 1470-1523 (row loop and `glyphPos` fill), 1525-1548 (median translation, with `anchors` as in 1538-1540), then 1632-1638 (`rowTop`/`rowBottom`) into `rows`. It works on `LayoutNode`s and never touches elements: `snapshotByGid.get(g).half` and `.originalCenter` come from the nodes, `snap.center` becomes `centers`.
  - `parentPairKey`: `getParentPairKey` (1273-1280) with `snapshotByGid.has` replaced by `known.has`. `collectCrossPairs`: 1290-1311.
  - `linearize` (1348-1392), `layoutUnit` (1400-1433), `resolveRow` (1441-1468) with `snapshotByGid`, `ox` and `CROSS_W` taken from a `RowContext`.
  - `childArrowPoints`: 1646-1691; the spans loop (1651-1662) is replaced by filtering `obstacles` by depth in `between`; the caller (render/Tidy) builds obstacles from frames (after labels grow them) and glyph spans exactly as 1651-1662 did.
  - `lineageBoxes`, `clearingShift`, `clearance`, `segmentBoxes`, `boundLineagePoints`: 1878-1962 (`boundLineagePoints` uses `lineagePoints` from `scene`).
  Keep every comment that explains a rule.

- [ ] **Step 6: Run.** `npm test -- tests/unit/layout.test.ts`. Expected: PASS for all eight goldens and the three pure cases.

- [ ] **Step 7: Commit.**

```bash
git add src/layout src/constants.ts tests/capture-layout-golden.sh tests/unit/golden tests/unit/helpers/layout-input.ts tests/unit/layout.test.ts
git commit -m "layout: the Tidy engine as pure functions, checked against the script's results

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: render

**Files:**
- Create: `src/render/index.ts`, `tests/unit/helpers/fake-ea.ts`, `tests/unit/render.test.ts`
- Modify: `src/constants.ts` (drawing constants)

**Interfaces:**
- Consumes: `EA` (Task 1), `Chromosome`, `SceneElement`, `SCHEMA_VERSION` (Task 3), `pathMidpoint`, `lineagePoints` (Task 4), `boundLineagePoints` (Task 8). Writes only to the EA workbench; commits happen in commands through `ctx.commit()`.
- Produces:
  - constants in `src/constants.ts`: `FONT_SIZE = 20`, `LOCAL_FONT_FAMILY = 4`, `FALLBACK_FONT_FAMILY = 2`, `GLYPH_FONT_FAMILY = 2`, `GLYPH_SIZE = 24`, `CHROMOSOME_GAP = 14`, `FRACTION_PADDING = 4`, `FRACTION_GAP = 5`, `GLYPH_GAP = 12`, `STROKE_WIDTH = 1.5`, `LABEL_GAP = 8`, `LABEL_BOX_BG = "#a5d8ff"`, `LABEL_BOX_PAD = 6`, `CROSS_GLYPH_CHAR = "x"`, `CROSS_GLYPH_FONT_FAMILY = 1`, `LINEAGE_DROP = 60`
  - `export type TagFn = (id: string, data: Record<string, unknown>) => void`
  - `export interface Slot { label: string; kind: "het" | "single"; slotWidth: number; slotHeight: number; top?: string; bottom?: string; line?: string; single?: string }`
  - `export interface DrawnGenotype { slots: Slot[]; separatorIds: string[]; glyphId: string | null; ids: string[]; totalWidth: number; halfHeight: number; slotMaxHeight: number }`
  - `export function genotypeFontFamily(ea: EA): number`
  - `export function withGenotypeStyle<T>(ea: EA, fontFamily: number, body: () => T): T`
  - `export function drawGenotype(ea: EA, chromosomes: readonly Chromosome[], glyph: string | null, tag: TagFn, fontFamily: number): DrawnGenotype`
  - `export function placeGenotype(ea: EA, drawn: DrawnGenotype, left: number, midlineY: number): void`
  - `export function addFrame(ea: EA, ids: readonly string[], tag: TagFn): string`
  - `export function addLabelBox(ea: EA, text: string, centerX: number, bottomY: number, data: Record<string, unknown>): { boxId: string; textId: string }`
  - `export function addArrowLabel(ea: EA, arrowId: string, text: string, data: Record<string, unknown>): string`
  - `export function addCrossGlyph(ea: EA, maternalId: string, paternalId: string, center: { x: number; y: number }, fontFamily: number): SceneElement`
  - `export function addLineageArrow(ea: EA, points: Array<[number, number]>, startId: string, endId: string, childGenotypeId: string): string`
  - `export function measureTextWidth(ea: EA, text: string, fontSize: number, fontFamily: number): number`
  - `export function labelBoxWidth(ea: EA, text: string): number`
  - `export function routeLineageArrow(ea: EA, arrow: SceneElement, lookup: { get(id: string): SceneElement | undefined }): void`

- [ ] **Step 1: Write the fake EA** `tests/unit/helpers/fake-ea.ts` (deterministic sizes: text width = characters x fontSize / 2, height = fontSize x 1.25):

```ts
import type { EA } from "../../../src/excalidraw/ea";
import type { SceneElement } from "../../../src/schema";

export function fakeEA(): EA & { order: string[] } {
  let n = 0;
  const order: string[] = [];
  const dict: Record<string, SceneElement> = {};
  const style = { strokeColor: "#000000", backgroundColor: "transparent", fillStyle: "hachure", strokeWidth: 1, strokeStyle: "solid", roughness: 1, opacity: 100, fontFamily: 1, fontSize: 20 };
  const add = (el: SceneElement) => { dict[el.id] = el; order.push(el.id); return el.id; };
  const base = (type: string, x: number, y: number, w: number, h: number): SceneElement =>
    ({ id: `el${++n}`, type, x, y, width: w, height: h, groupIds: [], boundElements: [], strokeColor: style.strokeColor, fontSize: style.fontSize, fontFamily: style.fontFamily });
  const ea = {
    order, style, elementsDict: dict, targetView: null,
    plugin: { settings: { experimentalEnableFourthFont: true } },
    setView: () => null, clear: () => { for (const k of Object.keys(dict)) delete dict[k]; order.length = 0; },
    verifyMinimumPluginVersion: () => true,
    addText: (x: number, y: number, text: string) => add({ ...base("text", x, y, text.length * style.fontSize / 2, style.fontSize * 1.25), text, originalText: text }),
    addLine: (pts: Array<[number, number]>) => add({ ...base("line", 0, 0, Math.max(...pts.map((p) => p[0])), 0), points: pts }),
    addArrow: (pts: Array<[number, number]>) => add({ ...base("arrow", pts[0][0], pts[0][1], 0, 0), points: pts.map(([x, y]) => [x - pts[0][0], y - pts[0][1]] as [number, number]) }),
    addRect: (x: number, y: number, w: number, h: number) => add(base("rectangle", x, y, w, h)),
    addToGroup: (ids: string[]) => { const g = `g${++n}`; for (const id of ids) dict[id].groupIds = [g]; return g; },
    addAppendUpdateCustomData: (id: string, data: Record<string, unknown>) => { dict[id].customData = { ...(dict[id].customData ?? {}), ...data }; },
    getElement: (id: string) => dict[id],
    getElements: () => order.map((id) => dict[id]),
  };
  return ea as unknown as EA & { order: string[] };
}
```

- [ ] **Step 2: Write the failing test** `tests/unit/render.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fakeEA } from "./helpers/fake-ea";
import { drawGenotype, placeGenotype } from "../../src/render";
import type { Chromosome } from "../../src/schema";

const chromosomes: Chromosome[] = [
  { label: "X", kind: "het", alleles: { top: "w", bottom: "Y" } },
  { label: "II", kind: "het", alleles: { top: "Sp", bottom: "CyO" } },
  { label: "III", kind: "single", alleles: { single: "+" } },
];

describe("drawGenotype + placeGenotype", () => {
  it("lays out glyph, fractions and separators as the scripts do", () => {
    const ea = fakeEA();
    const tags: Array<[string, Record<string, unknown>]> = [];
    const d = drawGenotype(ea, chromosomes, "♂", (id, data) => tags.push([id, data]), 2);
    // Creation order (z-order): per chromosome top, bottom, line (or single), then separators, then glyph.
    expect(ea.order.map((id) => ea.getElement(id)!.text ?? ea.getElement(id)!.type)).toEqual(["w", "Y", "line", "Sp", "CyO", "line", "+", ";", ";", "♂"]);
    expect(d.totalWidth).toBe(166);
    expect(d.halfHeight).toBe(30);
    placeGenotype(ea, d, 100, 50);
    const at = (id: string | null | undefined) => { const e = ea.getElement(id!)!; return [e.x, e.y]; };
    expect(at(d.glyphId)).toEqual([100, 35]);
    expect(at(d.slots[0].top)).toEqual([128, 20]);
    expect(at(d.slots[0].line)).toEqual([124, 50]);
    expect(at(d.slots[0].bottom)).toEqual([128, 55]);
    expect(at(d.separatorIds[0])).toEqual([156, 37.5]);
    expect(at(d.slots[1].top)).toEqual([189, 20]);
    expect(at(d.slots[1].bottom)).toEqual([184, 55]);
    expect(at(d.separatorIds[1])).toEqual([232, 37.5]);
    expect(at(d.slots[2].single)).toEqual([256, 37.5]);
    expect(d.ids).toEqual([d.glyphId, d.slots[0].top, d.slots[0].bottom, d.slots[0].line, d.slots[1].top, d.slots[1].bottom, d.slots[1].line, d.slots[2].single, ...d.separatorIds]);
    expect(tags.find(([id]) => id === d.slots[0].top)?.[1]).toEqual({ kind: "genotype-allele", chromosome: "X", side: "top" });
  });
});
```

(Arithmetic: fontSize 20 gives width 10 per character, height 25; the glyph at 24 is 12 by 30. Slot widths X 18, II 38, III 10; separators 10 each with 14 either side; total 12 + 12 + 18 + 38 + 38 + 38 + 10 = 166.)

- [ ] **Step 3: Run.** `npm test -- tests/unit/render.test.ts`. Expected: FAIL (cannot resolve `src/render`).

- [ ] **Step 4: Port.** Sources on `undo-safe@88155fb`:
  - `drawGenotype`: the slot loop, separators and glyph of `scripts/Genotype.md` 997-1040 (identical in `Cross Genotypes.md` 1007-1050 and Tidy's `reflowGenotypeFromSnapshot` 1074-1117), with `tag` passed in and `totalWidth` (1044-1051), `halfHeight` (1054-1063) and `slotMaxHeight` (`Cross Genotypes.md` 1054) computed; the glyph is drawn when `glyph` is truthy (callers keep their own condition: Genotype passes `state.glyph && chromosomeLayouts.length ? state.glyph : null`). `ids` in the order of `allIds` (1143-1149).
  - `placeGenotype`: 1103-1139 (`left` = cursor start, `midlineY`).
  - `withGenotypeStyle`: the `prev` save (977-989), body, and restore (1237-1242). `genotypeFontFamily`: 567-568 (`LOCAL_FONT_FAMILY` if `ea.plugin?.settings?.experimentalEnableFourthFont`, else `FALLBACK_FONT_FAMILY`); the Genotype-only Notice (569) stays in the Genotype command.
  - `addFrame`: Tidy 1174-1183 (transparent stroke and background, `addRect` padded by `FRAME_PAD`, tag `genotype-frame`, stroke back to `#000000`).
  - `addLabelBox`: Genotype 277-296. `addArrowLabel`: Tidy 268-279 (uses `pathMidpoint`).
  - `addCrossGlyph`: Tidy 1577-1589 without the layout lookups (center passed in), returning the workbench element; Cross Genotypes' new-glyph branch (1228-1240) calls it with its own center.
  - `addLineageArrow`: Tidy 1702-1722 (arrow options, `cross-lineage` tag via `schemaVersion`, `fixedSegments` when more than 4 points).
  - `measureTextWidth` (Tidy 1252-1262), `labelBoxWidth` (1265-1271), `routeLineageArrow` (1966-1982, uses `boundLineagePoints` and `pathMidpoint`).

- [ ] **Step 5: Run.** `npm test -- tests/unit/render.test.ts`. Expected: PASS. Then `npm test` (all) PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/render src/constants.ts tests/unit/helpers/fake-ea.ts tests/unit/render.test.ts
git commit -m "render: draw genotypes, labels, criteria, x glyphs and lineage arrows on an EA workbench

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: picker options (pure part of forms)

**Files:**
- Create: `src/forms/picker-options.ts`, `tests/unit/picker-options.test.ts`

**Interfaces:**
- Consumes: `Chromosome`, `CHROMOSOME_ORDER` (Task 3).
- Produces (`src/forms/picker-options.ts`):
  - `export const PICK_CHROMOSOMES = ["X", "II", "III"] as const`; `export type PickChromosome = (typeof PICK_CHROMOSOMES)[number]`
  - `export type CardSex = "female" | "male" | "both"`; `export interface CardOption { top: string; bottom: string; sex?: CardSex }`; `export interface PickerOptions { X: CardOption[]; II: CardOption[]; III: CardOption[] }`
  - `export interface AlleleText { chromosome: string; side: string; text: string }`
  - `export type ParentHomologs = Record<"X" | "II" | "III" | "IV", [string, string]> & { present: Set<string> }`
  - `export function homologsOf(alleles: readonly AlleleText[], isFather: boolean): ParentHomologs`
  - `export function pairs(maternal: readonly string[], paternal: readonly string[]): CardOption[]`
  - `export function optionsFor(mat: ParentHomologs, pat: ParentHomologs): PickerOptions`
  - `export function canFlip(opt: CardOption): boolean`
  - `export function sexFromX(options: PickerOptions, pickX: number, sex: string | null): string | null`
  - `export function xFromSex(options: PickerOptions, pickX: number, sex: string | null): number`
  - `export function flippedOption(options: PickerOptions, flip: Record<PickChromosome, Record<number, boolean>>, chr: PickChromosome, idx: number): CardOption`
  - `export function assignParents(a: { id: string; glyph: string | null; centroidX: number }, b: { id: string; glyph: string | null; centroidX: number }): { maternalId: string; paternalId: string }`
  - `export function offspringChromosomes(options: PickerOptions, pick: Record<PickChromosome, number>, flip: Partial<Record<PickChromosome, Record<number, boolean>>> | undefined, mat: ParentHomologs, pat: ParentHomologs): Chromosome[] | { missing: PickChromosome; index: number }`

- [ ] **Step 1: Write the failing test** `tests/unit/picker-options.test.ts` (the first four cases are `tests/cross-picker-dedup.sh`'s expectations):

```ts
import { describe, expect, it } from "vitest";
import { assignParents, canFlip, homologsOf, offspringChromosomes, optionsFor, sexFromX, xFromSex, type AlleleText } from "../../src/forms/picker-options";

type G = { X: [string, string]; II: [string, string]; III: [string, string] };
const alleles = (g: G): AlleleText[] => (["X", "II", "III"] as const).flatMap((c) => [
  { chromosome: c, side: "top", text: g[c][0] }, { chromosome: c, side: "bottom", text: g[c][1] }]);
const cards = (list: Array<{ top: string; bottom: string; sex?: string }>) => list.map((o) => o.top + "/" + o.bottom + (o.sex ? " " + o.sex : ""));
const options = (m: G, f: G) => optionsFor(homologsOf(alleles(m), false), homologsOf(alleles(f), true));

describe("optionsFor (cross-picker-dedup cases)", () => {
  it("homozygous mother", () => {
    const o = options({ X: ["w", "w"], II: ["+", "+"], III: ["+", "+"] }, { X: ["w", "Y"], II: ["CyO", "Gla"], III: ["MKRS", "TM6B"] });
    expect(cards(o.II)).toEqual(["+/CyO", "+/Gla"]);
    expect(cards(o.III)).toEqual(["+/MKRS", "+/TM6B"]);
    expect(cards(o.X)).toEqual(["w/w female", "w/Y male", "w/w or Y both"]);
  });
  it("homozygous father", () => {
    const o = options({ X: ["w", "+"], II: ["Sp", "CyO"], III: ["+", "+"] }, { X: ["w", "Y"], II: ["Gla", "Gla"], III: ["+", "+"] });
    expect(cards(o.II)).toEqual(["Sp/Gla", "CyO/Gla"]);
    expect(cards(o.III)).toEqual(["+/+"]);
    expect(cards(o.X)).toEqual(["w/w female", "+/w female", "w/Y male", "+/Y male", "w/w or Y both", "+/w or Y both"]);
  });
  it("flipped pairs are one card", () => {
    const o = options({ X: ["w", "w"], II: ["CyO", "+"], III: ["TM3", "+"] }, { X: ["w", "Y"], II: ["CyO", "+"], III: ["+", "TM3"] });
    expect(cards(o.II)).toEqual(["CyO/CyO", "CyO/+", "+/+"]);
    expect(cards(o.III)).toEqual(["TM3/+", "TM3/TM3", "+/+"]);
  });
  it("nothing to merge", () => {
    const o = options({ X: ["w", "y"], II: ["Sp", "CyO"], III: ["+", "+"] }, { X: ["w", "Y"], II: ["Gla", "Bc"], III: ["+", "+"] });
    expect(cards(o.II)).toEqual(["Sp/Gla", "Sp/Bc", "CyO/Gla", "CyO/Bc"]);
  });
});

describe("homologsOf", () => {
  it("fills missing chromosomes and a bare father X", () => {
    const h = homologsOf([{ chromosome: "X", side: "single", text: "w" }], true);
    expect(h.X).toEqual(["w", "Y"]);
    expect(h.II).toEqual(["+", "+"]);
    expect([...h.present]).toEqual(["X"]);
  });
});

describe("flip and sex rules", () => {
  const o = options({ X: ["w", "y"], II: ["Sp", "CyO"], III: ["TM3", "+"] }, { X: ["w", "Y"], II: ["Gla", "Gla"], III: ["+", "TM6B"] });
  it("never flips an X card carrying a Y", () => {
    expect(o.X.map(canFlip)).toEqual(o.X.map((c) => c.sex === "female"));
    expect(canFlip(o.II[0])).toBe(true);
  });
  it("sex follows the X card, keeping a virgin female", () => {
    const son = o.X.findIndex((c) => c.sex === "male");
    expect(sexFromX(o, son, null)).toBe("♂");
    expect(sexFromX(o, 0, "☿")).toBe("☿");
    expect(sexFromX(o, 0, "♂")).toBe("♀");
    expect(xFromSex(o, 0, "♂")).toBe(son);
    expect(xFromSex(o, 0, "♀")).toBe(0);
  });
  it("applies flips to the offspring", () => {
    const h = [homologsOf(alleles({ X: ["w", "y"], II: ["Sp", "CyO"], III: ["TM3", "+"] }), false), homologsOf(alleles({ X: ["w", "Y"], II: ["Gla", "Gla"], III: ["+", "TM6B"] }), true)] as const;
    const got = offspringChromosomes(o, { X: 1, II: 0, III: 0 }, { X: { 1: true }, II: { 0: true }, III: {} }, h[0], h[1]);
    expect(got).toEqual([
      { label: "X", kind: "het", alleles: { top: "w", bottom: "y" } },
      { label: "II", kind: "het", alleles: { top: "Gla", bottom: "Sp" } },
      { label: "III", kind: "het", alleles: { top: "TM3", bottom: "+" } },
    ]);
  });
});

describe("assignParents", () => {
  it("uses glyphs, then left to right", () => {
    expect(assignParents({ id: "a", glyph: "♂", centroidX: 0 }, { id: "b", glyph: "♀", centroidX: 9 })).toEqual({ maternalId: "b", paternalId: "a" });
    expect(assignParents({ id: "a", glyph: null, centroidX: 9 }, { id: "b", glyph: null, centroidX: 0 })).toEqual({ maternalId: "b", paternalId: "a" });
  });
});
```

- [ ] **Step 2: Run.** `npm test -- tests/unit/picker-options.test.ts`. Expected: FAIL (cannot resolve `src/forms/picker-options`).

- [ ] **Step 3: Port.** Sources on `undo-safe@88155fb`, `scripts/Cross Genotypes.md`: `homologsOf` 579-601 (takes the allele texts, already `textOf(el).trim()`, instead of reading elements); `pairs` 610-624; `optionsFor` 630-641 (takes `mat`, `pat`); `canFlip` 669; `flippedOption` 670-673; `sexFromX` 674-679 and `xFromSex` 680-685 as functions returning the new sex / new X index instead of mutating `state`; `assignParents` 545-571 (with `centroidX` computed by the caller as in 535-539); `offspringChromosomes` 938-951 (returns `{ missing, index }` where the script shows `No option ${index} for chromosome ${label}.` and returns).

- [ ] **Step 4: Run.** `npm test -- tests/unit/picker-options.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/forms/picker-options.ts tests/unit/picker-options.test.ts
git commit -m "forms: cross picker options, dedup, flip and sex rules as pure functions

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Genotype command and form

**Files:**
- Create: `src/commands/genotype.ts`, `src/forms/genotype-form.ts`
- Modify: `src/commands/index.ts` (handler), `styles.css`

**Interfaces:**
- Consumes: `runOperation`, `OperationContext` (Task 5), `take`/`put` (Task 5), `splitDuplicateGenotypes` (Task 6), `drawGenotype`, `placeGenotype`, `withGenotypeStyle`, `genotypeFontFamily`, `addFrame`, `addLabelBox`, `addArrowLabel` (Task 9), `boundingBox`, `lineagePoints` (Task 4), `textOf`, `FORM_CHROMOSOMES`, `CHROMOSOME_ORDER` (Task 3), `TestingHooks.modals` (Task 1).
- Produces:
  - `src/forms/genotype-form.ts`: `export interface Homologs { top: string; bottom: string }`; `export interface GenotypeFormState { glyph: string | null; X: Homologs; II: Homologs; III: Homologs; IV: Homologs; label?: string; criterion?: string }`; `export interface GenotypeFormOptions { editMode: boolean; offspring: boolean; focusKey: string }`; `export function openGenotypeForm(app: App, init: GenotypeFormState, opts: GenotypeFormOptions, modals: Set<Modal>): Promise<GenotypeFormState | null>` (exposes `window._genotypeFormModal = { modal, inputs, focusKey, labelInput, critInput, chromosomes, flipButtons }` while open)
  - `src/commands/genotype.ts`: `export interface GenotypeParams { createAt?: { x: number; y: number }; defaultGlyph?: string | null }`; `export async function genotype(ctx: OperationContext, params?: GenotypeParams, modals?: Set<Modal>): Promise<string | null>` (returns and sets `_genotypeLastResult`)

- [ ] **Step 1: Confirm the gating tests pass on the scripts and fail on the plugin.**
  `FLY_ENGINE=scripts FLY_FROZEN=1 bash tests/genotype-label-criterion.sh` and `FLY_ENGINE=scripts bash tests/genotype-form-flip.sh`: PASS.
  `FLY_ENGINE=plugin FLY_FROZEN=1 bash tests/genotype-label-criterion.sh`: FAIL with `script error: Genotype: Genotype is not ported yet`. `FLY_ENGINE=plugin bash tests/genotype-form-flip.sh`: FAIL (`Genotype G made no genotype`).

- [ ] **Step 2: Port the form** into `src/forms/genotype-form.ts`: `openForm` (on `undo-safe@88155fb`, `scripts/Genotype.md` 666-921) with `GLYPHS` (263-269), `FIELD_MIN_WIDTH`, `FIELD_PADDING` (252-253). `editMode`, `offspring.is` and `focusKey` come from `opts`. Register the modal in `modals` on open and delete it on close. Move each static `style.cssText` to a class in `styles.css`:

  | Element | Class |
  |---|---|
  | body row (679) | `fly-genotype-body` |
  | glyph column (682), its buttons (685) | `fly-glyph-column`, `fly-glyph-button` (plus `fly-glyph-symbol` for `font-size:16px`) |
  | grid (699-700) | `fly-genotype-grid` |
  | chromosome wrapper (733-734, `grid-column` stays inline since it is computed) | `fly-chromosome` |
  | header (742), flip button (745-746) | `fly-chromosome-header`, `fly-flip-button` |
  | separator (752-753, `grid-column` inline) | `fly-chromosome-separator` |
  | fraction bar (756) | `fly-fraction-bar` |
  | offspring row (788), label input width, criterion textarea (795) | `fly-offspring-row`, `fly-label-input`, `fly-criterion-input` |
  | warning (800), buttons row (803) | `fly-form-warning`, `fly-form-buttons` |

  Keep inline: `input.style.gridRow`, `input.style.textAlign`, `input.style.width` (computed), the flip button's `visibility`/`opacity`/`disabled`, `modal.modalEl.style.width/maxWidth`. `document.createElement("canvas")` becomes `activeDocument.createElement("canvas")`; `document.activeElement` becomes `activeDocument.activeElement`; `setTimeout` becomes `window.setTimeout`.

- [ ] **Step 3: Port the command** into `src/commands/genotype.ts`, body of `scripts/Genotype.md` 238-1246 without the form:
  - hooks 571-584: `take("_genotypeAuto")`, `take("_genotypeFormProbe")`, `take("_genotypeCreateAt")` (unless `params.createAt` is given), `take("_genotypeDefaultGlyph")` (unless `params.defaultGlyph` is given), `put("_genotypeLastResult", undefined)`;
  - font Notice 567-569; `await splitDuplicateGenotypes(ctx)` unless creating at a point (596);
  - mode and read back 586-662 (probe writes `put("_genotypeFormState", ...)` and returns);
  - `state` 923-926 via `openGenotypeForm` or the auto hook;
  - build with `withGenotypeStyle`, `drawGenotype` (glyph only when `state.glyph && chromosomes.length`), placement 1099-1102 (`findFreeSpot` 1068-1090 ported as a local function over `boundingBox` of each live view element; `anchor` 945-952), `placeGenotype`;
  - group and commit 1141-1244 (label rebuild, frame kept by id, re-aim arrows with `lineagePoints`, criterion rebuild, deletions) with `await ctx.commit()`, then `ctx.selectElements(ids)` and `put("_genotypeLastResult", ...)`.
  In `src/commands/index.ts`: `"Genotype": (plugin, view) => runOperation(plugin.app, operationEnv(plugin), view, "Genotype", (ctx) => genotype(ctx, {}, plugin.testing.modals)).then(() => undefined)`.

- [ ] **Step 4: Run.** `npm test` (write guard included): PASS. `FLY_ENGINE=plugin FLY_FROZEN=1 bash tests/genotype-label-criterion.sh`: PASS. `FLY_ENGINE=plugin bash tests/genotype-form-flip.sh`: PASS. Confirm no modal is left: `cd "$FLY_VAULT" && obsidian eval code="document.querySelectorAll('.modal-container').length"` prints `=> 0`.

- [ ] **Step 5: Commit.**

```bash
git add src/commands/genotype.ts src/forms/genotype-form.ts src/commands/index.ts styles.css
git commit -m "Genotype command and form

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Tidy command

**Files:**
- Create: `src/commands/tidy.ts`
- Modify: `src/commands/index.ts`

**Interfaces:**
- Consumes: `OperationContext` (Task 5), `put` (Task 5), `splitDuplicateGenotypes` (Task 6), `splitMultiRowParents` (Task 7), `collectLineage`, `extendWithOrphanGlyphs`, `computeDepths`, `snapshotGenotype` (Task 4), `layoutLineage`, `collectCrossPairs`, `childArrowPoints`, `lineageBoxes`, `segmentBoxes`, `clearance`, `clearingShift` (Task 8), `drawGenotype`, `placeGenotype`, `addFrame`, `addLabelBox`, `addArrowLabel`, `addCrossGlyph`, `addLineageArrow`, `measureTextWidth`, `labelBoxWidth`, `routeLineageArrow`, `withGenotypeStyle`, `genotypeFontFamily` (Task 9).
- Produces: `src/commands/tidy.ts`: `export interface TidyParams { seed?: string[] }`; `export async function tidy(ctx: OperationContext, params?: TidyParams): Promise<void>` (bumps `window._tidyLastResult` on every exit); `export async function tidyLineage(ctx: OperationContext, seedGid: string | null, avoid: ReadonlySet<string> | null, subset: Set<string> | null): Promise<Set<string>>`.

- [ ] **Step 1: Confirm the gating tests.** On the scripts, `FLY_ENGINE=scripts FLY_FROZEN=1 bash tests/<t>.sh` PASS, and on the plugin, `FLY_ENGINE=plugin FLY_FROZEN=1 bash tests/<t>.sh` FAIL (`Tidy is not ported yet`), for `<t>` in `tidy-sibling-order`, `tidy-sibling-cross-overlap`, `tidy-sibling-cross-chain`, `tidy-three-partners`, `tidy-joined-families`, `three-chromosomes`. `tests/tidy-invariants.sh` copies `Excalidraw/_test-scratch.md` read-only; run it only if that drawing exists (`ls "$FLY_VAULT/Excalidraw/_test-scratch.md"`), and never modify it.

- [ ] **Step 2: Port.** Source: `scripts/Tidy.md` on `undo-safe@88155fb` (merged `main`: same function names).
  - `tidy(ctx, params)`: wrap in `try { ... } finally { put("_tidyLastResult", (peek("_tidyLastResult") ?? 0) + 1) }` (line 30); `await splitDuplicateGenotypes(ctx)` (816); seed selection 818-839 with `params.seed` in place of `window._tidySeed` (the freshness check is not needed: the seed is passed directly); dispatch 1984-2013.
  - `tidyLineage(ctx, seed, avoid, subset)`: 848-1876, composed from the modules:
    - 855-860: `splitMultiRowParents(ctx, lineage, below ? subset : null)`;
    - 865-896: `collectLineage`, `extendWithOrphanGlyphs`, the empty-lineage Notice;
    - 898-1028: `snapshotGenotype` per lineage member (show each returned `notice` with `new Notice`), the furniture sweep 1006-1023, the no-snapshots Notice;
    - 1037-1038: `computeDepths`;
    - 1040-1043: `ctx.deleteElements([...members, ...furniture])`;
    - 1045-1201: `withGenotypeStyle` around the rest; each snapshot drawn with `drawGenotype`, `placeGenotype` at origin, `addFrame`, `addToGroup`, then recentered (1190-1201);
    - 1248-1288: `CROSS_W = measureTextWidth(ea, "x", GLYPH_SIZE, CROSS_GLYPH_FONT_FAMILY)`, `half` with `labelBoxWidth`;
    - 1290-1548: `collectCrossPairs` and `layoutLineage({ nodes, depths, crossPairs, crossW, subset: below })`;
    - 1550-1557: move each drawn genotype by its laid-out center;
    - 1559-1772: `addCrossGlyph` at `{ x: result.glyphX.get(key), y: leftParentCenter.y }`, labels first (`addChildLabel` ported locally with `addLabelBox`), then arrows with `childArrowPoints` (obstacles from the grown frames and glyph spans of the rows in between) and `addLineageArrow`, criteria with `addArrowLabel`, boundary arrows 1742-1765 (`routeLineageArrow`), orphan glyphs 1767-1772;
    - 1781-1872: Phase E with `segmentBoxes`/`clearance`/`clearingShift`/`lineageBoxes`, moving workbench elements and re-routing with `routeLineageArrow` as in the script;
    - 1874: `await ctx.commit()`.
  Wire `"Tidy"` in `src/commands/index.ts` as in Task 11.

- [ ] **Step 3: Run.** `npm test`: PASS. Each of the six tests from Step 1 with `FLY_ENGINE=plugin FLY_FROZEN=1`: PASS. (`tidy-invariants` too, if the drawing exists.)

- [ ] **Step 4: Commit.**

```bash
git add src/commands/tidy.ts src/commands/index.ts
git commit -m "Tidy command: lineage, subset and whole-drawing tidy through layout and render

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Cross Genotypes command and picker

**Files:**
- Create: `src/commands/cross-genotypes.ts`, `src/forms/cross-picker.ts`
- Modify: `src/commands/index.ts`, `styles.css`

**Interfaces:**
- Consumes: Task 5 (`OperationContext`, `take`, `put`), Task 6, Task 9 (`drawGenotype`, `placeGenotype`, `withGenotypeStyle`, `genotypeFontFamily`, `addLabelBox`, `addArrowLabel`, `addCrossGlyph`, `addLineageArrow`), Task 10 (all picker options), Task 12 (`tidy`), `genotypeElements`, `lineagePoints`, `boundingBox` (Task 4), `textOf` (Task 3).
- Produces:
  - `src/forms/cross-picker.ts`: `export interface ParentDrawing { glyph: string | null; chroms: Array<{ top: string; bottom: string } | { single: string }> }`; `export interface PickerResult { sex: string | null; pick: Record<PickChromosome, number>; label: string; criterion: string; flip: Record<PickChromosome, Record<number, boolean>>; options: PickerOptions }`; `export function openCrossPicker(app: App, input: { maternal: ParentDrawing; paternal: ParentDrawing; mat: ParentHomologs; pat: ParentHomologs; options: PickerOptions }, modals: Set<Modal>): Promise<PickerResult | null>` (exposes `window._crossGenotypesModal = { modal, state, columns, labelInput, critInput }` and `window._crossGenotypesOptions` on render)
  - `src/commands/cross-genotypes.ts`: `export interface CrossParams { parents?: [string, string] }`; `export async function crossGenotypes(ctx: OperationContext, params?: CrossParams, modals?: Set<Modal>): Promise<string | null>` (returns and sets `_crossGenotypesLastResult`)

- [ ] **Step 1: Confirm the gating tests** on the scripts (PASS) and the plugin (FAIL, `Cross Genotypes is not ported yet`): `tests/cross-picker-dedup.sh`, `tests/cross-picker-flip.sh`, `tests/cross-then-genotype.sh`, `FLY_FROZEN=1 tests/duplicate-genotype.sh`.

- [ ] **Step 2: Port the picker** into `src/forms/cross-picker.ts`: `openPicker` (on `undo-safe@88155fb`, `scripts/Cross Genotypes.md` 659-916) and `GLYPHS` (645-651). Its `state` keeps the same shape (`sex`, `pick`, `label`, `criterion`, `flip`) because `tests/cross-picker-flip.sh` reads it; `sexFromX`/`xFromSex`/`canFlip`/`flippedOption` come from Task 10 and update `state` in place. Register the modal in `modals`. Static styles to `styles.css`: header (719-720) `fly-picker-header`, preview (743-747) `fly-picker-preview` and `fly-picker-preview-title`, body (758) `fly-picker-body`, sex column (762) `fly-picker-sex`, grid (777) `fly-picker-grid`, column wrapper (781) `fly-picker-column`, column header (783) `fly-picker-column-header`, column (785) `fly-picker-cards`, separator (791) `fly-picker-separator`, extras (796, 798) `fly-picker-extras`, buttons (812) `fly-form-buttons`, card (823-826) `fly-card` plus `is-selected` for the selected background and color, card bar (829) `fly-card-bar`, mini genotype (700, 705, 707) `fly-mini`, `fly-mini-fraction`, `fly-mini-bar`. The column focus ring (`boxShadow` on focus/blur) stays inline.

- [ ] **Step 3: Port the command** into `src/commands/cross-genotypes.ts`: `scripts/Cross Genotypes.md` 212-1311 without the picker: `put("_crossGenotypesLastResult", undefined)`; `await splitDuplicateGenotypes(ctx)`; parents from `params.parents` or the selection (505-530, Notice and `null` result unchanged); `assignParents`; `homologsOf` from each parent's allele texts; `take("_crossGenotypesAuto")` (653-657) or `openCrossPicker`; `put("_crossGenotypesOptions", options)` when the picker is skipped (921); `offspringChromosomes`; drawing and placement 953-1101 (`centerX = midX`, `centerY = lowerParentBottomY + LINEAGE_DROP * 2`, `placeGenotype(ea, d, centerX - d.totalWidth / 2, centerY)`); label, frame, group 1103-1187; x glyph reused (`copyViewElementsToEAforEditing`) or created with `addCrossGlyph` (1199-1241); `addLineageArrow` with `lineagePoints` (1243-1263); criterion 1265-1272; `await ctx.commit()`; the Notice `Created offspring genotype ${genotypeId.slice(0, 8)}…` (1283, the ellipsis character is kept); `put("_crossGenotypesLastResult", genotypeId)`; then (1287-1311) `ctx.setAppState({ selectedElementIds: { [anchor.id]: true } })` and `try { await ctx.join("Tidy", (c) => tidy(c, { seed: [genotypeId] })) } catch (e) { console.warn("Cross: auto-tidy failed:", e) }`.

- [ ] **Step 4: Run.** `npm test`: PASS. On the plugin: `tests/cross-picker-dedup.sh`, `tests/cross-picker-flip.sh`, `tests/cross-then-genotype.sh`, `FLY_FROZEN=1 tests/duplicate-genotype.sh`: PASS. No modal left open (`=> 0` as in Task 11).

- [ ] **Step 5: Commit.**

```bash
git add src/commands/cross-genotypes.ts src/forms/cross-picker.ts src/commands/index.ts styles.css
git commit -m "Cross Genotypes command and picker; its Tidy joins the operation

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Select Below and Select Lineage

**Files:**
- Create: `src/commands/select.ts`, `tests/select.sh`
- Modify: `src/commands/index.ts`, `tests/plugin-smoke.sh` (one line)

**Interfaces:**
- Consumes: `selectionSet`, `SelectMode` (Task 4), `splitDuplicateGenotypes` (Task 6), `OperationContext`, `put` (Task 5).
- Produces: `src/commands/select.ts`: `export interface SelectResult { mode: SelectMode; genotypes: number; genotypeIds: string[]; elements: number }`; `export async function select(ctx: OperationContext, mode: SelectMode): Promise<SelectResult | null>` (also `put("_flySelectResult", result)`).

- [ ] **Step 1: Write the test** `tests/select.sh` (no existing test covers these two commands; expectations follow their documented rules and must pass on the scripts first):

```bash
#!/usr/bin/env bash
# Select Below and Select Lineage. Fixture below: P1 x P2 -> A, B; A x P3 ->
# C, D; C x P4 -> E. With C selected:
#   1. Select Below selects C, E and P4 (C, its descendants and their mates),
#      with the x of C x P4, the arrow into E and nothing of C's own parents'
#      cross (the arrow into C stays behind);
#   2. Select Lineage selects every genotype of the lineage and all of its
#      crosses' x glyphs, arrows and criteria.
# Prints PASS/FAIL; exit 0 only if all pass.
source "$(dirname "$0")/lib.sh"
fly_test <<'JS'
const sel = () => { const s = F.view().targetView.excalidrawAPI.getAppState().selectedElementIds; return F.live().filter(e => s[e.id]); };
const names = els => [...new Set(els.filter(e => e.customData?.genotypeId).map(e => F.name(e.customData.genotypeId)))].sort().join(',');
const until = async f => { for (let i = 0; i < 60 && !f(); i++) await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0))); };

await T.fixture('below');
F.select(['C']);
await T.run('Select Below');
await until(() => sel().length > 1);
let s = sel();
T.pass(names(s) === 'C,E,P4', 'Select Below: C, E, P4', 'Select Below selected ' + names(s));
const intoC = F.live().find(e => e.customData?.kind === 'cross-lineage' && e.customData.childGenotypeId === window.__t.C);
const intoE = F.live().find(e => e.customData?.kind === 'cross-lineage' && e.customData.childGenotypeId === window.__t.E);
T.pass(!s.includes(intoC) && s.includes(intoE), 'Select Below: arrow into E, not into C', 'arrows: into C ' + s.includes(intoC) + ', into E ' + s.includes(intoE));

await T.fixture('below');
F.select(['C']);
await T.run('Select Lineage');
await until(() => sel().length > 1);
s = sel();
const tagged = F.live().filter(e => e.customData?.genotypeId || ['cross-glyph', 'cross-lineage', 'cross-criterion'].includes(e.customData?.kind));
T.pass(names(s) === 'A,B,C,D,E,P1,P2,P3,P4' && tagged.every(e => s.includes(e)), 'Select Lineage: the whole lineage', 'Select Lineage selected ' + names(s) + ', ' + tagged.filter(e => !s.includes(e)).length + ' tagged elements left out');
JS
```

- [ ] **Step 2: Run.** `FLY_ENGINE=scripts FLY_FROZEN=1 bash tests/select.sh`: PASS (if it fails, the expectation is wrong: fix the test to match the scripts' documented behavior, not the other way round). `FLY_ENGINE=plugin FLY_FROZEN=1 bash tests/select.sh`: FAIL (`Select Below is not ported yet`).

- [ ] **Step 3: Port.** `select(ctx, mode)`: on `undo-safe@88155fb`, `scripts/Select Below.md` 437-501 (identical in `Select Lineage.md` but for `MODE`, line 8): `await splitDuplicateGenotypes(ctx)`, seed from the selection (Notice `Select a genotype first.` unchanged), `selectionSet(live, seed, mode)`, `ctx.selectElements(set.elements)`, `put("_flySelectResult", ...)`. Wire both commands in `src/commands/index.ts`.

- [ ] **Step 4: Update the smoke test's error probe.** In `tests/plugin-smoke.sh`, replace the `Select Lineage` error check (Select Lineage now works) with a command that is still a stub until Task 17: `const errs = await T.run('Cross Mode', { tolerate: true });` and its message check `/Cross Mode/`. Task 17 removes the error probe (see there).

- [ ] **Step 5: Run.** `npm test`: PASS. `FLY_ENGINE=plugin FLY_FROZEN=1 bash tests/select.sh`: PASS. `FLY_ENGINE=plugin bash tests/plugin-smoke.sh`: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/commands/select.ts src/commands/index.ts tests/select.sh tests/plugin-smoke.sh
git commit -m "Select Below and Select Lineage commands, with a test for both

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: Tidy Below

**Files:**
- Create: `src/commands/tidy-below.ts`
- Modify: `src/commands/index.ts`

**Interfaces:**
- Consumes: `select` (Task 14), `tidy` (Task 12), `OperationContext.join` (Task 5).
- Produces: `src/commands/tidy-below.ts`: `export async function tidyBelow(ctx: OperationContext): Promise<void>`.

- [ ] **Step 1: Confirm the gating tests.** `FLY_FROZEN=1` `tests/tidy-below.sh` and `tests/tidy-backcross.sh`: PASS on the scripts, FAIL on the plugin (`Tidy Below is not ported yet`).

- [ ] **Step 2: Port.** On `undo-safe@88155fb`, `scripts/Tidy Below.md` 192-217: the selection check and Notice; `let result; try { result = await ctx.join("Select Below", (c) => select(c, "below")); } catch { result = null; }`; `if (!result) { new Notice("Tidy Below: Select Below did not finish."); return; }`; the `< 2` Notice; `await ctx.join("Tidy", (c) => tidy(c, { seed: result.genotypeIds }))`. Wire it.

- [ ] **Step 3: Run.** `npm test`: PASS. `FLY_ENGINE=plugin FLY_FROZEN=1 bash tests/tidy-below.sh` and `... tests/tidy-backcross.sh`: PASS.

- [ ] **Step 4: Commit.**

```bash
git add src/commands/tidy-below.ts src/commands/index.ts
git commit -m "Tidy Below command: Select Below and Tidy in one operation

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Task 16: Break Cross

**Files:**
- Create: `src/commands/break-cross.ts`
- Modify: `src/commands/index.ts`

**Interfaces:**
- Consumes: `splitDuplicateGenotypes` (Task 6), `OperationContext.commitPatches` (Task 5).
- Produces: `src/commands/break-cross.ts`: `export interface BreakPlan { crosses: Map<string, Parents>; detach: Set<string>; patches: Map<string, Partial<SceneElement>> }`; `export function planBreakCross(all: readonly SceneElement[], selected: readonly SceneElement[]): BreakPlan | null` (pure); `export async function breakCross(ctx: OperationContext): Promise<void>`.

- [ ] **Step 1: Confirm the gating test.** `FLY_FROZEN=1 tests/break-cross.sh`: PASS on the scripts, FAIL on the plugin.

- [ ] **Step 2: Port.** On `undo-safe@88155fb`, `scripts/Break Cross.md` 445-536: `await splitDuplicateGenotypes(ctx)`; `planBreakCross` = 447-526 with `edit(el).x = ...` recorded as patches (`customData` without `parents`, `boundElements` filtered, `isDeleted: true`), returning `null` where the script shows `Select the x of a cross, both of its parents, or an offspring to detach.`; `breakCross` shows that Notice on `null`, else `await ctx.commitPatches(plan.patches)` and the result Notice (531-536) unchanged. Wire it.

- [ ] **Step 3: Run.** `npm test`: PASS. `FLY_ENGINE=plugin FLY_FROZEN=1 bash tests/break-cross.sh`: PASS.

- [ ] **Step 4: Commit.**

```bash
git add src/commands/break-cross.ts src/commands/index.ts
git commit -m "Break Cross command

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Task 17: Cross Mode

**Files:**
- Create: `src/commands/cross-mode.ts`
- Modify: `src/commands/index.ts` (last handler; remove `notPorted`), `src/main.ts` (stop the mode on unload), `tests/plugin-smoke.sh`

**Interfaces:**
- Consumes: `runOperation`, `setAppState`, `unrecordLastStep`, `openOperation` (Task 5), `take`, `put`, `peek` (Task 5), `splitDuplicateGenotypes` (Task 6), `genotype` (Task 11), `crossGenotypes` (Task 13), `boundingBox` (Task 4), `newEA` (Task 1).
- Produces: `src/commands/cross-mode.ts`: `export function toggleCrossMode(plugin: FlyGeneticsPlugin, view: ExcalidrawViewLike): void` (sets `window._flyCrossMode = { stop, view }`).

- [ ] **Step 1: Confirm the gating tests.** `tests/cross-mode-esc.sh`, `tests/cross-mode-one-shot.sh`: PASS on the scripts, FAIL on the plugin.

- [ ] **Step 2: Port.** On `undo-safe@88155fb`, `scripts/Cross Mode.md` 195-640 (take the merged `main` version, which has the child-failure handling from the review):
  - toggle 199-203 (`peek("_flyCrossMode")?.stop("Cross mode off.")`);
  - `api` from `view.excalidrawAPI`; `saved`, `arm` (220-229, `setAppState(view, ...)` plus `api.setActiveTool(...)`), `isCrossLine`, `genotypeAt` (with `boundingBox` for `ea.getBoundingBox`), `alleleOf`, `glyphOf`;
  - `unrecordLine` becomes `unrecordLastStep(view, line.id)`; `deleteElement` becomes `ctx.commitPatches(new Map([[line.id, { isDeleted: true }]]))`;
  - `runAndWait`, `cross`, `createAt` become `ctx.join("Cross Genotypes", (c) => crossGenotypes(c, { parents: [a, b] }, plugin.testing.modals))` (after `ctx.selectElements([alleleOf(a), alleleOf(b)])`) and `ctx.join("Genotype", (c) => genotype(c, { createAt: point, defaultGlyph: opposite(mateGlyph) }, plugin.testing.modals))` (after `ctx.setAppState({ selectedElementIds: {}, selectedGroupIds: {} })`); a join that throws counts as cancelled, as the merged script handles a child failure;
  - `handle` 555-580 inside `runOperation(plugin.app, operationEnv(plugin), view, "Cross Mode", (ctx) => handle(ctx, line, unrecorded))`;
  - the timer 621-627 with `plugin.registerInterval(window.setInterval(...))`, the synthetic Escape (`activeDocument`-independent: dispatch on `view.contentEl`'s canvas as the script does);
  - `stop` 629-636 (`window.clearInterval`, `put("_flyCrossMode", undefined)`, `notice.hide()`, `setAppState(view, saved)`, `api.setActiveTool({ type: "selection", locked: !!before.activeTool?.locked })`, Notice);
  - `put("_flyCrossMode", { stop, view })`; `arm()`.
  In `src/commands/index.ts`, `"Cross Mode": async (plugin, view) => toggleCrossMode(plugin, view)`, and delete `notPorted`. In `FlyGeneticsPlugin.onunload`, add `peek("_flyCrossMode")?.stop();`.
  Update `tests/plugin-smoke.sh`: every command is ported, so replace the error probe with a real one: `const errs = await T.run('Tidy', { tolerate: true }); T.pass(Array.isArray(errs), 'T.run returns the command errors (' + errs.length + ')', 'T.run did not return errors');` (the harness still fails on a thrown error in non-tolerant runs; Task 2 already proved errors propagate).

- [ ] **Step 3: Run.** `npm test`: PASS. On the plugin: `tests/cross-mode-esc.sh`, `tests/cross-mode-one-shot.sh`, `tests/plugin-smoke.sh`: PASS. Leave Cross Mode off afterwards: `cd "$FLY_VAULT" && obsidian eval code="window._flyCrossMode?.stop?.(); 'off'"`.

- [ ] **Step 4: Commit.**

```bash
git add src/commands/cross-mode.ts src/commands/index.ts src/main.ts tests/plugin-smoke.sh
git commit -m "Cross Mode command; every command is now ported

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Task 18: Parity: the plugin engine by default, undo, rebuilt fixtures

**Files:**
- Modify: `tests/lib.sh` (default engine), `tests/run-all.sh`, `tests/fixtures/*.json` (rebuilt by the plugin), `CLAUDE.md` (test loop section)

**Interfaces:**
- Consumes: all commands (Tasks 11 to 17), the harness engine (Task 2).
- Produces: `FLY_ENGINE` defaults to `plugin`; `tests/run-all.sh` runs `npm test` first and reports it as `unit-tests`.

- [ ] **Step 1: Run the undo test on the plugin with the script-built fixtures.** `FLY_ENGINE=plugin FLY_FROZEN=1 bash tests/undo.sh`. Expected: every `PASS:` line (one undo restores, no undo step loses a genotype, one redo re-applies, cancels record nothing) for every operation. A failure here is a port bug in `operation` or a command: fix it (use superpowers:systematic-debugging; compare with `FLY_ENGINE=scripts FLY_FROZEN=1 bash tests/undo.sh`).

- [ ] **Step 2: Full parity on the script-built fixtures.** `FLY_ENGINE=plugin FLY_FROZEN=1 tests/run-all.sh`. Expected: every line `PASS` (installer and updater still test the scripts' installer and pass unchanged; `duplicate-helper-sync` and `undo-safe-discipline` still check the scripts).

- [ ] **Step 3: Make the plugin the default and add the unit tests to run-all.** In `tests/lib.sh`: `ENGINE="${FLY_ENGINE:-plugin}"`, and update the header comment. In `tests/run-all.sh`, before the `for t in` loop:

```bash
t0=$(now)
if (cd "$TESTS/.." && npm test --silent >/tmp/fly-unit.$$ 2>&1); then
  printf 'PASS  %-30s %5ss\n' "unit-tests" "$(perl -e "printf '%.1f', $(now) - $t0")"
else
  printf 'FAIL  %-30s %5ss\n' "unit-tests" "$(perl -e "printf '%.1f', $(now) - $t0")"; failed=1
  sed 's/^/      /' /tmp/fly-unit.$$
fi
rm -f /tmp/fly-unit.$$
```

  (Use `mktemp` instead of `/tmp/fly-unit.$$` if preferred; keep it outside the repo.) The `plugin-smoke` skip condition becomes `[[ "${FLY_ENGINE:-plugin}" == plugin ]] || continue`.

- [ ] **Step 4: Rebuild the fixtures with the plugin and run everything.** `tests/make-fixtures.sh` (plugin engine: rebuilds every scenario through the plugin's Genotype, Cross Genotypes and Tidy). Then `tests/run-all.sh`. Expected: every line `PASS`. Then run `tests/run-all.sh` once more and confirm no fixture rebuilt (`git status --short tests/fixtures` unchanged between the two runs) and all `PASS`.

- [ ] **Step 5: Update `CLAUDE.md`'s test sections** for the plugin: the test loop (`npm run build`, `tools/dev-install.sh`, `obsidian plugin:reload id=fly-genetics`, `obsidian dev:errors`), `FLY_ENGINE`/`FLY_FROZEN`, hooks now defined in `src/hooks.ts`, and the rule "every scene write goes through `src/operation`; `tests/unit/write-guard.test.ts` enforces it". Keep the scripts sections until Task 22.

- [ ] **Step 6: Commit.**

```bash
git add tests/lib.sh tests/run-all.sh tests/fixtures CLAUDE.md
git commit -m "Parity: tests run the plugin by default; fixtures rebuilt by the plugin

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Task 19: Migration prompt

**Files:**
- Create: `src/migration.ts`, `src/settings.ts`, `tests/unit/migration.test.ts`, `tests/migration.sh`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `take`, `put` (Task 5), `TestingHooks.modals` (Task 1), `EXCALIDRAW_ID`, `AppInternals` (Task 1).
- Produces:
  - `src/settings.ts`: `export interface FlyGeneticsSettings { migration: "pending" | "done" | "declined" }`; `export const DEFAULT_SETTINGS: FlyGeneticsSettings = { migration: "pending" }`
  - `src/migration.ts`: `export const INSTALLED_SCRIPTS = ["Genotype", "Cross Genotypes", "Cross Mode", "Tidy", "Tidy Below", "Select Lineage", "Select Below", "Break Cross", "Update Fly Genetics", "Install Fly Genetics"] as const`; `export const INSTALLER_MANIFEST = ".fly-genetics.json"`; `export function trimFolder(folder: string): string`; `export function installedScriptPaths(folder: string): string[]`; `export async function offerMigration(plugin: FlyGeneticsPlugin): Promise<void>`
  - `FlyGeneticsPlugin`: `settings: FlyGeneticsSettings`, `saveSettings(): Promise<void>`, `offerMigration(): Promise<void>` (for the test)

- [ ] **Step 1: Write the failing unit test** `tests/unit/migration.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { installedScriptPaths, trimFolder } from "../../src/migration";

describe("installedScriptPaths", () => {
  it("lists the installer's files in the script folder", () => {
    expect(trimFolder("Excalidraw/Scripts//")).toBe("Excalidraw/Scripts");
    const p = installedScriptPaths("Excalidraw/Scripts/");
    expect(p).toContain("Excalidraw/Scripts/Cross Genotypes.md");
    expect(p).toContain("Excalidraw/Scripts/Update Fly Genetics.md");
    expect(p).toContain("Excalidraw/Scripts/Install Fly Genetics.md");
    expect(p).toHaveLength(10);
  });
});
```

Run: `npm test -- tests/unit/migration.test.ts`. Expected: FAIL (cannot resolve `src/migration`).

- [ ] **Step 2: Implement `src/settings.ts` and `src/migration.ts`.**

```ts
// src/migration.ts
import { Modal, Setting, TFile, type App } from "obsidian";
import type FlyGeneticsPlugin from "./main";
import { take, put } from "./hooks";
import { EXCALIDRAW_ID } from "./excalidraw/version";
import type { AppInternals } from "./excalidraw/ea";

// File names the scripts installer (installer/build.py) wrote into the
// Excalidraw script folder, plus the installer itself and its manifest.
export const INSTALLED_SCRIPTS = ["Genotype", "Cross Genotypes", "Cross Mode", "Tidy", "Tidy Below", "Select Lineage", "Select Below", "Break Cross", "Update Fly Genetics", "Install Fly Genetics"] as const;
export const INSTALLER_MANIFEST = ".fly-genetics.json";

export const trimFolder = (folder: string): string => folder.trim().replace(/\/+$/, "");
export const installedScriptPaths = (folder: string): string[] => INSTALLED_SCRIPTS.map((n) => `${trimFolder(folder)}/${n}.md`);

function scriptFolder(app: App): string {
  const excalidraw = (app as AppInternals).plugins.plugins[EXCALIDRAW_ID] as unknown as { settings?: { scriptFolderPath?: string } } | undefined;
  return excalidraw?.settings?.scriptFolderPath || "Excalidraw/Scripts";
}

class MigrationModal extends Modal {
  private answered = false;
  constructor(app: App, private readonly paths: string[], private readonly resolve: (yes: boolean) => void) { super(app); }
  onOpen(): void {
    this.titleEl.setText("Fly Genetics is now a plugin");
    this.contentEl.createEl("p", { text: "These Fly Genetics scripts are still in your Excalidraw script folder, so each command would appear twice. Move them to the trash? Your drawings are not changed." });
    const list = this.contentEl.createEl("ul");
    for (const p of this.paths) list.createEl("li", { text: p });
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText("Keep them").onClick(() => this.answer(false)))
      .addButton((b) => b.setButtonText("Move to trash").setCta().onClick(() => this.answer(true)));
  }
  private answer(yes: boolean): void { this.answered = true; this.resolve(yes); this.close(); }
  onClose(): void { this.contentEl.empty(); if (!this.answered) this.resolve(false); }
}

// First load: offers to move the installer's Fly Genetics scripts to the
// trash. Never deletes without confirmation; asks once (the answer is saved).
export async function offerMigration(plugin: FlyGeneticsPlugin): Promise<void> {
  const auto = take("_flyMigrationAuto");
  if (!auto && plugin.settings.migration !== "pending") return;
  const { app } = plugin;
  const folder = auto?.scriptFolder ?? scriptFolder(app);
  const files = installedScriptPaths(folder).map((p) => app.vault.getAbstractFileByPath(p)).filter((f): f is TFile => f instanceof TFile);
  const manifest = `${trimFolder(folder)}/${INSTALLER_MANIFEST}`;
  const hasManifest = await app.vault.adapter.exists(manifest);
  if (!files.length && !hasManifest) {
    plugin.settings.migration = "done";
    await plugin.saveSettings();
    return;
  }
  const paths = [...files.map((f) => f.path), ...(hasManifest ? [manifest] : [])];
  const yes = auto ? auto.confirm : await new Promise<boolean>((resolve) => {
    const m = new MigrationModal(app, paths, resolve);
    plugin.testing.modals.add(m);
    m.open();
  });
  if (yes) {
    for (const f of files) await app.fileManager.trashFile(f);
    if (hasManifest && !(await app.vault.adapter.trashSystem(manifest))) await app.vault.adapter.trashLocal(manifest);
  }
  plugin.settings.migration = yes ? "done" : "declined";
  await plugin.saveSettings();
  put("_flyMigrationResult", { trashed: yes ? paths : [], declined: !yes });
}
```

In `src/main.ts`: load settings first (`this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<FlyGeneticsSettings> | null)`), add `async saveSettings() { await this.saveData(this.settings); }` and `offerMigration() { return offerMigration(this); }`, and in `onLayoutReady`, when the Excalidraw check passes, `void this.offerMigration();`.

- [ ] **Step 3: Run the unit test.** `npm test -- tests/unit/migration.test.ts`. Expected: PASS.

- [ ] **Step 4: Write and run the Obsidian test** `tests/migration.sh`:

```bash
#!/usr/bin/env bash
# The migration offer, in a throwaway script folder (_flygen-test/Scripts):
#   1. confirm: the installer's files there (and its manifest) go to the
#      trash, nothing else in the folder is touched;
#   2. decline: nothing is trashed;
#   3. the prompt itself: it lists the files and "Keep them" trashes nothing
#      and closes it.
# The plugin's saved answer is restored afterwards. Prints PASS/FAIL.
source "$(dirname "$0")/lib.sh"
fly_test <<'JS'
const P = app.plugins.plugins['fly-genetics'], vault = app.vault, DIR = '_flygen-test/Scripts';
const saved = P.settings.migration;
const has = p => !!vault.getAbstractFileByPath(p);
async function seed() {
  for (const p of ['_flygen-test', DIR]) if (!has(p)) await vault.createFolder(p);
  for (const n of ['Tidy', 'Cross Genotypes', 'Install Fly Genetics', 'My own script']) if (!has(DIR + '/' + n + '.md')) await vault.create(DIR + '/' + n + '.md', '// test');
}
try {
  await seed();
  window._flyMigrationAuto = { scriptFolder: DIR, confirm: true };
  await P.offerMigration();
  T.pass(!has(DIR + '/Tidy.md') && !has(DIR + '/Install Fly Genetics.md') && has(DIR + '/My own script.md'),
    'confirm: installer files trashed, others kept', 'confirm: ' + JSON.stringify(window._flyMigrationResult));
  await seed();
  window._flyMigrationAuto = { scriptFolder: DIR, confirm: false };
  await P.offerMigration();
  T.pass(has(DIR + '/Tidy.md') && window._flyMigrationResult.declined, 'decline: nothing trashed', 'decline: ' + JSON.stringify(window._flyMigrationResult));
  P.settings.migration = 'pending';
  const ex = app.plugins.plugins['obsidian-excalidraw-plugin'].settings, folder = ex.scriptFolderPath;
  ex.scriptFolderPath = DIR;
  const run = P.offerMigration();
  let keep = null;
  for (let i = 0; i < 100 && !(keep = [...document.querySelectorAll('.modal-container .modal button')].find(b => b.textContent === 'Keep them')); i++) await new Promise(r => setTimeout(r, 50));
  const listed = [...document.querySelectorAll('.modal-container .modal li')].map(li => li.textContent);
  ex.scriptFolderPath = folder;
  if (!keep) throw new Error('the migration prompt did not open');
  keep.click();
  await run;
  T.pass(listed.includes(DIR + '/Tidy.md') && has(DIR + '/Tidy.md'), 'prompt lists the files; Keep trashes nothing', 'prompt listed ' + JSON.stringify(listed));
} finally {
  P.testing.closeModals();
  P.settings.migration = saved;
  await P.saveSettings();
  const root = vault.getAbstractFileByPath('_flygen-test');
  if (root) await app.fileManager.trashFile(root);
}
JS
```

Run: `bash tests/migration.sh`. Expected: three PASS lines; `obsidian eval code="document.querySelectorAll('.modal-container').length"` prints `=> 0`; `cat "$FLY_VAULT/.obsidian/plugins/fly-genetics/data.json"` still shows `"migration": "declined"`.

- [ ] **Step 5: Commit.**

```bash
git add src/migration.ts src/settings.ts src/main.ts tests/unit/migration.test.ts tests/migration.sh
git commit -m "Offer to move the old Fly Genetics scripts to the trash on first load

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Task 20: Offer the Computer Modern font setup

The scripts installer writes the Computer Modern font and its license to `Excalidraw/Fonts/` and points Excalidraw's local font at it. With the installer retired, the plugin does the same on first load when that setup is missing (Sean's decision), reusing the installer's logic and the repository's font assets, and never without confirmation.

**Files:**
- Create: `src/font/plan.ts`, `src/font/index.ts`, `src/font/assets.ts`, `src/assets.d.ts`, `tests/unit/font.test.ts`, `tests/font-setup.sh`
- Modify: `esbuild.config.mjs` (loaders), `src/settings.ts` (`font`), `src/main.ts`, `src/hooks.ts` (`_flyFontAuto`, `_flyFontResult`), `tools/dev-install.sh` (`"font": "declined"` in the dev vault's `data.json`)

**Interfaces:**
- Consumes: `take`, `put` (Task 5), `TestingHooks.modals` (Task 1), `EXCALIDRAW_ID`, `AppInternals` (Task 1), `FlyGeneticsSettings`, `saveSettings` (Task 19), `fonts/cmu-serif-500-roman.ttf`, `fonts/CMU-OFL.txt`.
- Produces:
  - `src/settings.ts`: `FlyGeneticsSettings` gains `font: "pending" | "done" | "declined"`; `DEFAULT_SETTINGS.font = "pending"`
  - `src/hooks.ts`: `_flyFontAuto: { fontFolder?: string; skipSettings?: boolean; confirm: boolean; replaceOther?: boolean }`, `_flyFontResult: { fontPath: string; wroteFont: boolean; note: string; declined: boolean }`
  - `src/font/plan.ts` (pure): `export const FONT_NAME = "cmu-serif-500-roman.ttf"`; `export const LICENSE_NAME = "CMU-OFL.txt"`; `export const DEFAULT_FONT_FOLDER = "Excalidraw/Fonts"`; `export interface FontState { fontSize: number | null; expectedSize: number; enabled: boolean; currentFont: string | null; fontPath: string }`; `export interface FontPlan { writeFont: boolean; settings: "ours" | "set" | "ask-replace" }`; `export function planFontSetup(st: FontState): FontPlan`; `export function needsFontSetup(plan: FontPlan): boolean`
  - `src/font/assets.ts`: `export const FONT_BYTES: Uint8Array` (the bundled ttf), `export const LICENSE_TEXT: string`
  - `src/font/index.ts`: `export async function offerFontSetup(plugin: FlyGeneticsPlugin): Promise<void>`
  - `FlyGeneticsPlugin.offerFontSetup(): Promise<void>` (for the test)

- [ ] **Step 1: Write the failing unit test** `tests/unit/font.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { needsFontSetup, planFontSetup } from "../../src/font/plan";

const ours = "Excalidraw/Fonts/cmu-serif-500-roman.ttf";
const st = (patch = {}) => ({ fontSize: 639132, expectedSize: 639132, enabled: true, currentFont: ours, fontPath: ours, ...patch });

describe("planFontSetup (the installer's rules)", () => {
  it("nothing to do when the font is there and set", () => {
    const p = planFontSetup(st());
    expect(p).toEqual({ writeFont: false, settings: "ours" });
    expect(needsFontSetup(p)).toBe(false);
  });
  it("writes a missing or different-size font", () => {
    expect(planFontSetup(st({ fontSize: null })).writeFont).toBe(true);
    expect(planFontSetup(st({ fontSize: 12 })).writeFont).toBe(true);
  });
  it("sets the local font when it is off, asks when it is another font", () => {
    expect(planFontSetup(st({ enabled: false })).settings).toBe("set");
    expect(planFontSetup(st({ currentFont: "Excalidraw/Fonts/other.ttf" })).settings).toBe("ask-replace");
    expect(needsFontSetup(planFontSetup(st({ enabled: false })))).toBe(true);
  });
});
```

Run: `npm test -- tests/unit/font.test.ts`. Expected: FAIL (cannot resolve `src/font/plan`).

- [ ] **Step 2: Implement `src/font/plan.ts`.** Port of the installer's decisions (on `undo-safe@88155fb`, `installer/installer.template.md`, sections "2. Font" (lines 119-126: write the font if absent or its size differs) and "3. Excalidraw local font setting" (128-148: `alreadyOurs` = local font enabled and set to our path; `otherFont` = enabled and not ours; otherwise set)):

```ts
export const FONT_NAME = "cmu-serif-500-roman.ttf";
export const LICENSE_NAME = "CMU-OFL.txt";
export const DEFAULT_FONT_FOLDER = "Excalidraw/Fonts";

export interface FontState { fontSize: number | null; expectedSize: number; enabled: boolean; currentFont: string | null; fontPath: string }
export interface FontPlan { writeFont: boolean; settings: "ours" | "set" | "ask-replace" }

// The scripts installer's rules: write the font if it is absent or its size
// differs; leave Excalidraw's local font alone if it is already ours, ask
// before replacing another local font, otherwise point it at ours.
export function planFontSetup(st: FontState): FontPlan {
  const writeFont = st.fontSize === null || st.fontSize !== st.expectedSize;
  const alreadyOurs = st.enabled && st.currentFont === st.fontPath;
  const otherFont = st.enabled && !alreadyOurs;
  return { writeFont, settings: alreadyOurs ? "ours" : otherFont ? "ask-replace" : "set" };
}

export const needsFontSetup = (p: FontPlan): boolean => p.writeFont || p.settings !== "ours";
```

Run: `npm test -- tests/unit/font.test.ts`. Expected: PASS.

- [ ] **Step 3: Bundle the assets.** In `esbuild.config.mjs`, add `loader: { ".ttf": "binary", ".txt": "text" },` to the context options. Create `src/assets.d.ts`:

```ts
declare module "*.ttf" { const bytes: Uint8Array; export default bytes; }
declare module "*.txt" { const text: string; export default text; }
```

and `src/font/assets.ts`:

```ts
// The font and license the scripts installer embedded, from fonts/ in this repository.
import fontBytes from "../../fonts/cmu-serif-500-roman.ttf";
import licenseText from "../../fonts/CMU-OFL.txt";

export const FONT_BYTES: Uint8Array = fontBytes;
export const LICENSE_TEXT: string = licenseText;
```

(`main.js` grows by about 850 KB of base64; only `src/font/index.ts` imports `assets.ts`, so unit tests never load it.)

- [ ] **Step 4: Implement `src/font/index.ts`.** Port of the installer's steps 2 and 3 with the prompt in front (and its two questions, `utils.suggester` replaced by a two-button modal registered in `plugin.testing.modals`):
  - skip unless `plugin.settings.font === "pending"` or `_flyFontAuto` is set (`take`);
  - state: `fontFolder` = auto's or `DEFAULT_FONT_FOLDER`; `fontPath = ${fontFolder}/${FONT_NAME}`; `fontSize` from `app.vault.getAbstractFileByPath(fontPath)` (`TFile.stat.size`, or null); `settings` = the Excalidraw plugin's `settings` (`app.plugins.plugins["obsidian-excalidraw-plugin"].settings`: `experimentalEnableFourthFont`, `experimantalFourthFont`, spelled as Excalidraw spells it); `plan = planFontSetup(...)`;
  - nothing needed: `font = "done"`, save, return;
  - first question (modal title "Set up the Computer Modern font", text "Fly Genetics draws genotypes in Computer Modern, like LaTeX. Write the font (SIL Open Font License) to <fontFolder> and use it as Excalidraw's local font?", buttons "Not now" and "Set up"); `_flyFontAuto.confirm` answers it in tests; "Not now" or closing: `font = "declined"`, save, `put("_flyFontResult", { ..., declined: true })`, return;
  - on yes, as the installer: create the folder path segment by segment (`ensureFolder`), write the font with `vault.createBinary`/`vault.modifyBinary` from `FONT_BYTES.buffer` when `plan.writeFont`, write the license (`vault.create`/`vault.modify`) always; unless `skipSettings`: `"ours"` gives the note "Local font was already set to Computer Modern."; `"ask-replace"` asks the installer's second question (`Excalidraw's local font is set to "<current>". Replace it with Computer Modern?`, buttons "Use Computer Modern" / "Keep my font"; `_flyFontAuto.replaceOther` answers it) and on "Keep my font" notes "Kept your local font; genotypes will be drawn in it."; `"set"` (or a yes to replace) sets `experimentalEnableFourthFont = true`, `experimantalFourthFont = fontPath`, `await excalidraw.saveSettings()`, `await excalidraw.initializeFonts?.()`, note "Local font set to Computer Modern. Reopen open drawings to see it.";
  - `font = "done"`, save, `new Notice(note)` when there is one, `put("_flyFontResult", { fontPath, wroteFont: plan.writeFont, note, declined: false })`.
  In `src/main.ts`, add `offerFontSetup() { return offerFontSetup(this); }` and make the layout-ready hook run both offers in order, font first: `void (async () => { await this.offerFontSetup(); await this.offerMigration(); })();`. In `tools/dev-install.sh`, the `data.json` it writes becomes `{"migration": "declined", "font": "declined"}` (and if `data.json` exists without `font`, leave it: `font` defaults to `pending`, so add the key with `node -e` merging JSON, not by overwriting).

- [ ] **Step 5: Write and run the Obsidian test** `tests/font-setup.sh` (the font goes to a throwaway folder and Excalidraw's settings are never touched):

```bash
#!/usr/bin/env bash
# The font setup offer, writing to a throwaway folder (_flygen-test/Fonts),
# Excalidraw's local-font setting skipped (skipSettings):
#   1. confirm: the font is written byte-identical to fonts/ in this repo,
#      with its license;
#   2. decline: nothing is written;
#   3. the prompt itself: "Not now" writes nothing and closes it.
# The plugin's saved answer is restored. Prints PASS/FAIL.
source "$(dirname "$0")/lib.sh"
fly_test <<'JS'
const fs = require('fs'), P = app.plugins.plugins['fly-genetics'], vault = app.vault, DIR = '_flygen-test/Fonts';
const saved = P.settings.font;
const has = p => !!vault.getAbstractFileByPath(p);
const clear = async () => { const r = vault.getAbstractFileByPath('_flygen-test'); if (r) await app.fileManager.trashFile(r); };
try {
  await clear();
  window._flyFontAuto = { fontFolder: DIR, skipSettings: true, confirm: true };
  await P.offerFontSetup();
  const f = vault.getAbstractFileByPath(DIR + '/cmu-serif-500-roman.ttf');
  const bytes = f ? Buffer.from(await vault.readBinary(f)) : null;
  T.pass(!!bytes && bytes.equals(fs.readFileSync(T.repo + '/fonts/cmu-serif-500-roman.ttf')) && has(DIR + '/CMU-OFL.txt'),
    'confirm: font byte-identical to fonts/, license written', 'confirm: ' + JSON.stringify(window._flyFontResult));
  await clear();
  window._flyFontAuto = { fontFolder: DIR, skipSettings: true, confirm: false };
  await P.offerFontSetup();
  T.pass(!has(DIR + '/cmu-serif-500-roman.ttf') && window._flyFontResult.declined, 'decline: nothing written', 'decline: ' + JSON.stringify(window._flyFontResult));
  // The prompt: with the dev vault's font already set up, point it at the
  // throwaway folder through the hook without an answer.
  window._flyFontAuto = undefined;
  P.settings.font = 'pending';
  const ex = app.plugins.plugins['obsidian-excalidraw-plugin'].settings, was = { on: ex.experimentalEnableFourthFont, f: ex.experimantalFourthFont };
  ex.experimentalEnableFourthFont = false;          // makes the setup "needed" without writing anything
  const run = P.offerFontSetup();
  let notNow = null;
  for (let i = 0; i < 100 && !(notNow = [...document.querySelectorAll('.modal-container .modal button')].find(b => b.textContent === 'Not now')); i++) await new Promise(r => setTimeout(r, 50));
  Object.assign(ex, { experimentalEnableFourthFont: was.on, experimantalFourthFont: was.f });
  if (!notNow) throw new Error('the font prompt did not open');
  notNow.click();
  await run;
  T.pass(window._flyFontResult?.declined === true && ex.experimentalEnableFourthFont === was.on, 'prompt: Not now changes nothing', 'prompt: ' + JSON.stringify(window._flyFontResult));
} finally {
  P.testing.closeModals();
  P.settings.font = saved;
  await P.saveSettings();
  await clear();
}
JS
```

(The in-memory Excalidraw setting is flipped only while the prompt is open and restored before the click; the plugin saves Excalidraw's settings only on "Set up", which the test never clicks.)

Run: `bash tests/font-setup.sh`. Expected: three PASS lines; `obsidian eval code="document.querySelectorAll('.modal-container').length"` prints `=> 0`; `obsidian eval code="app.plugins.plugins['obsidian-excalidraw-plugin'].settings.experimantalFourthFont"` prints the same value as before the test.

- [ ] **Step 6: Run the unit tests and build.** `npm test`: PASS. `npm run build`: no type errors.

- [ ] **Step 7: Commit.**

```bash
git add src/font src/assets.d.ts src/settings.ts src/main.ts src/hooks.ts esbuild.config.mjs tools/dev-install.sh tests/unit/font.test.ts tests/font-setup.sh
git commit -m "Offer the Computer Modern font setup on first load, as the installer did

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Task 21: Distribution (BRAT)

**Files:**
- Create: `tools/set-version.mjs`, `tests/unit/set-version.test.ts`
- Modify: `tools/scan.sh`, `CLAUDE.md` (Publishing), `README.md` (install), `CHANGELOG.md`, `VERSION`, `installer/installer.template.md` only if the What's-new text needs the plugin link (the What's new comes from `CHANGELOG.md`)

**Interfaces:**
- Consumes: `manifest.json`, `versions.json`, `package.json` (Task 1).
- Produces: `tools/set-version.mjs` exporting `export function dateVersion(date: Date, existing: Iterable<string>): string` (`YYYY.MDD.N`, N one past the highest release already listed for that date, from 0) and `export function setVersion(root: string, version: string): void` (writes `version` into `manifest.json` and `package.json`, adds `"<version>": "<manifest.minAppVersion>"` to `versions.json`, writes `VERSION` while it still exists); runnable as `node tools/set-version.mjs` (today's next version from `versions.json`) or `node tools/set-version.mjs <version>`; refuses a version that is not `YYYY.MDD.N` with a real month (1 to 12) and day (01 to 31).

- [ ] **Step 1: Write the failing test** `tests/unit/set-version.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dateVersion, setVersion } from "../../tools/set-version.mjs";

describe("dateVersion", () => {
  it("is YYYY.MDD.N, counting releases the same day", () => {
    expect(dateVersion(new Date(2026, 8, 29), [])).toBe("2026.929.0");
    expect(dateVersion(new Date(2026, 8, 29), ["2026.929.0"])).toBe("2026.929.1");
    expect(dateVersion(new Date(2026, 9, 1), ["2026.929.0", "2026.929.1"])).toBe("2026.1001.0");
    expect(dateVersion(new Date(2026, 11, 5), ["2026.1205.0", "2026.1205.3"])).toBe("2026.1205.4");
  });
});

describe("setVersion", () => {
  const root = () => {
    const d = mkdtempSync(join(tmpdir(), "fly-version-"));
    writeFileSync(join(d, "manifest.json"), JSON.stringify({ id: "fly-genetics", version: "2026.929.0", minAppVersion: "1.5.0" }));
    writeFileSync(join(d, "package.json"), JSON.stringify({ name: "fly-genetics", version: "2026.929.0" }));
    writeFileSync(join(d, "versions.json"), JSON.stringify({ "2026.929.0": "1.5.0" }));
    return d;
  };
  it("writes the version everywhere", () => {
    const d = root();
    setVersion(d, "2026.1001.0");
    expect(JSON.parse(readFileSync(join(d, "manifest.json"), "utf8")).version).toBe("2026.1001.0");
    expect(JSON.parse(readFileSync(join(d, "package.json"), "utf8")).version).toBe("2026.1001.0");
    expect(JSON.parse(readFileSync(join(d, "versions.json"), "utf8"))).toEqual({ "2026.929.0": "1.5.0", "2026.1001.0": "1.5.0" });
  });
  it("refuses a version that is not YYYY.MDD.N", () => {
    for (const v of ["2026.9.29", "2026.929", "2026.1332.0", "2026.1300.0", "2026.929.0.1", "1.2.3"]) expect(() => setVersion(root(), v)).toThrow();
  });
});
```

Run: `npm test -- tests/unit/set-version.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 2: Implement `tools/set-version.mjs`.**

```js
// Release versions are dates: YYYY.MDD.N (year, month, two-digit day, then a
// release counter from 0), e.g. 2026.929.0, 2026.929.1, 2026.1001.0. Writes a
// version into manifest.json, package.json, versions.json and VERSION.
// Usage: node tools/set-version.mjs [version]   (default: today's next version)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DATE_VERSION = /^(\d{4})\.(\d{1,2})(\d{2})\.(\d+)$/;
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const writeJson = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + "\n");

function check(version) {
  const m = DATE_VERSION.exec(version);
  const month = m ? Number(m[2]) : 0, day = m ? Number(m[3]) : 0;
  if (!m || month < 1 || month > 12 || day < 1 || day > 31) throw new Error(`not a YYYY.MDD.N version: ${version}`);
}

export function dateVersion(date, existing) {
  const stem = `${date.getFullYear()}.${date.getMonth() + 1}${String(date.getDate()).padStart(2, "0")}`;
  const used = [...existing].filter((v) => v.startsWith(stem + ".")).map((v) => Number(v.slice(stem.length + 1)));
  return `${stem}.${used.length ? Math.max(...used) + 1 : 0}`;
}

export function setVersion(root, version) {
  check(version);
  const manifest = readJson(join(root, "manifest.json"));
  manifest.version = version;
  writeJson(join(root, "manifest.json"), manifest);
  const pkg = readJson(join(root, "package.json"));
  pkg.version = version;
  writeJson(join(root, "package.json"), pkg);
  const versions = readJson(join(root, "versions.json"));
  versions[version] = manifest.minAppVersion;
  writeJson(join(root, "versions.json"), versions);
  if (existsSync(join(root, "VERSION"))) writeFileSync(join(root, "VERSION"), version + "\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(import.meta.url), "..", "..");
  const version = process.argv[2] ?? dateVersion(new Date(), Object.keys(readJson(join(root, "versions.json"))));
  setVersion(root, version);
  console.log(version);
}
```

Run: `npm test -- tests/unit/set-version.test.ts`. Expected: PASS.

- [ ] **Step 3: Scan the built plugin.** In `tools/scan.sh`, after the installer check, add a scan of `main.js` (built by `npm run build`; not tracked, so `git ls-files` misses it), with the embedded font's base64 removed first (a short blocklist term could match inside it by chance; the installer scan also skipped the font):

```bash
[[ -f main.js ]] || { echo "scan: build main.js first (npm run build)"; exit 2; }
plugin=$(perl -pe 's{[A-Za-z0-9+/=]{200,}}{}g' main.js | grep -i -o -E ".{0,20}($pattern).{0,20}" || true)
```

and include `$plugin` in the FAIL condition and report (`[[ -n "$plugin" ]] && echo "main.js: $plugin"`). The PASS line becomes `scan: PASS (<n> tracked files + installer text + main.js)`.

- [ ] **Step 4: Document the release in `CLAUDE.md` (Publishing).** Replace the versioning paragraph and the numbered release steps with:

  Versions are release dates in the form `YYYY.MDD.N`: year, month and two-digit day, then a release counter from 0 (`2026.929.0`, `2026.929.1` later the same day, `2026.1001.0` on October 1). `node tools/set-version.mjs` computes today's next one from `versions.json`.

  1. On `main`: `node tools/set-version.mjs` (prints the version), add a `## <version>` section at the top of `CHANGELOG.md`, commit.
  2. `npm test` and `tests/run-all.sh` must pass; `npm run build`; while the scripts still ship, `uv run installer/build.py` and commit `dist/`.
  3. `git status` must be clean. Then `tools/scan.sh` must PASS.
  4. `git switch public && git rm -rq . && git checkout main -- . && git commit -m "Release <version>" && git push public public:main`, then `git tag v<version> && git push public v<version>` and `gh release create v<version> --repo half-adder/excalidraw-genetics --title <version> --notes "<that CHANGELOG section>" main.js manifest.json styles.css`; `git switch main`.

  and state: labmates install and update through BRAT from the releases (`main.js`, `manifest.json`, `styles.css` assets); `manifest.json` and `versions.json` are at the repository root. Older `CHANGELOG.md` headings keep their `YYYY.M.D` form.

- [ ] **Step 5: README install section.** Replace "Install (labmates)" with BRAT steps:

  1. In Obsidian, install and enable the **Excalidraw** community plugin (2.20.2 or newer) and the **BRAT** community plugin.
  2. Settings > BRAT > Beta plugin list > **Add beta plugin**, enter `half-adder/excalidraw-genetics`, and add it. Enable **Fly Genetics** in Settings > Community plugins.
  3. On first start Fly Genetics offers to set up the Computer Modern font (it writes the font and its SIL Open Font License to `Excalidraw/Fonts/` and turns on Excalidraw's local font with it, asking before replacing a different local font), and, if you used the scripts, offers to move them to the trash so each command does not appear twice. Drawings need no conversion.
  4. Updates: BRAT checks for new versions at startup (its "Auto-update plugins at startup" setting) or when you run "BRAT: Check for updates to all beta plugins".

  Keep the notes on the local-font slot and on drawings without the font. "Install (development)" becomes: `npm install`, `npm run build` (or `npm run dev`), `tools/dev-install.sh`, and `obsidian plugin:reload id=fly-genetics` after a rebuild. Hotkeys: the plugin's commands have new ids, so hotkeys set on the old script commands must be assigned again (Settings > Hotkeys, search "Fly Genetics").

- [ ] **Step 6: The release that announces the plugin.** With Sean's go-ahead (pushing to the public repository is his call): `node tools/set-version.mjs`, and write the `CHANGELOG.md` section as the last scripts release's "What's new": Fly Genetics is now an Obsidian plugin; install BRAT and add `half-adder/excalidraw-genetics` (the steps from the README); on first start the plugin offers the font setup (already done for anyone who ran the installer) and offers to trash the old scripts; hotkeys need assigning again; drawings are unchanged. Build both (`npm run build`, `uv run installer/build.py`), run `tests/run-all.sh` and `tools/scan.sh`, then follow the release steps. Verify with BRAT in a vault other than the dev vault (ask Sean which) that the plugin installs from the release, loads, and offers the font setup there.

- [ ] **Step 7: Commit** (before the release step pushes anything):

```bash
git add tools/set-version.mjs tests/unit/set-version.test.ts tools/scan.sh CLAUDE.md README.md
git commit -m "Distribution: BRAT releases with main.js, manifest.json and styles.css; YYYY.MDD.N versions

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

and, for Step 6, `git add manifest.json package.json versions.json VERSION CHANGELOG.md dist && git commit -m "Release <version>" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"`.

---

## Task 22: Retire the scripts, installer and updater

Gate: only after Task 18's full parity and Task 21's release, and after Sean confirms labmates have moved to the plugin (un-migrated "Update Fly Genetics" copies fetch `dist/Install Fly Genetics.md` from the public `main`, which this task removes).

**Files:**
- Delete: `scripts/` (all nine), `installer/`, `dist/`, `tests/installer.sh`, `tests/updater.sh`, `VERSION` (keep `fonts/`: the plugin bundles the font from there, Task 20)
- Modify: `tests/harness.js`, `tests/lib.sh`, `tests/run-all.sh`, `tests/scenarios.js` (comment), `tests/make-fixtures.sh` (comment), `tests/genotype-form-flip.sh` (comment), `tests/capture-layout-golden.sh` (comment: the goldens are frozen), `tools/scan.sh`, `tools/set-version.mjs` (VERSION branch), `docs/media/make-media.sh` and `docs/media/media.js` (comments and any Script Engine calls), `README.md`, `CLAUDE.md`, `CHANGELOG.md`

**Interfaces:**
- Consumes: everything above.
- Produces: a repository where the plugin is the only implementation; `tests/run-all.sh` = unit tests + every Obsidian test on the plugin.

- [ ] **Step 1: Delete** the files listed above with `git rm -r`.

- [ ] **Step 2: Harness.** In `tests/harness.js`, remove `SCRIPTS`, `FIXTURE_SCRIPTS`, `track`, `untrack`, `reloadScripts`, `inflight`/`errors`/`idle` of the Script Engine, and the scripts branches of `T.run`, `T.launch` and `engineText`; keep `COMMANDS` as its own list. In `tests/lib.sh`, drop `ENGINE`/`FLY_ENGINE` (always the plugin) and update the header. In `tests/run-all.sh`, remove the `duplicate-helper-sync` and `undo-safe-discipline` checks (replaced by the module structure and `tests/unit/write-guard.test.ts`) and the `plugin-smoke` skip. `tests/genotype-form-flip.sh`: drop the paragraph about the Script Engine gap.

- [ ] **Step 3: Tools.** `tools/scan.sh`: remove the installer section. `tools/set-version.mjs`: remove the `VERSION` line (and from its test's expectations nothing changes, since the test has no VERSION file).

- [ ] **Step 4: Docs.** `README.md`: intro ("an Obsidian plugin for drawing *Drosophila* genotypes and crossing schemes in Excalidraw"), "Scripts" table becomes "Commands" (same rows, without "Update Fly Genetics"), development and test sections for the plugin, License "Code: MIT". `CLAUDE.md`: Context (plugin in `src/`, dev vault via `tools/dev-install.sh`, reload with `obsidian plugin:reload id=fly-genetics`), remove the Script Engine reload and "Undo-safe operations (rule for every scene change)" script rules in favor of the `src/operation` rule, keep the test canvas and gotchas, Publishing without the installer. `CHANGELOG.md`: a section for the next release noting the scripts, installer and updater are gone.

- [ ] **Step 5: Dev vault.** Ask Sean before touching the dev vault's script symlinks; with his go-ahead, remove the symlinks in `$FLY_VAULT/Excalidraw/Scripts` that point into the repository (only symlinks: `find "$FLY_VAULT/Excalidraw/Scripts" -maxdepth 1 -type l -lname '*excalidraw-genetics*' -print`, review, then `-delete`).

- [ ] **Step 6: Run everything.** `npm test` and `tests/run-all.sh`. Expected: every line PASS. `grep -rn "Script Engine\|executeScriptFile\|Excalidraw/Scripts" --include='*.sh' --include='*.js' --include='*.md' --include='*.ts' . | grep -v node_modules | grep -v docs/plans` prints nothing unexpected (migration's `Excalidraw/Scripts` default and `tests/migration.sh` are expected). `tools/scan.sh`: PASS.

- [ ] **Step 7: Commit.**

```bash
git add -A
git commit -m "Retire the scripts, installer and updater; the plugin is Fly Genetics

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Self-review against the spec

Coverage:

| Spec item | Where |
|---|---|
| Plugin id `fly-genetics`, name "Fly Genetics", sample layout, esbuild, TypeScript | Task 1 |
| Excalidraw 2.20.2+ check on load, Notice, commands unavailable | Task 1 (`excalidrawStatus`, `checkCallback`) |
| No Node-only APIs, `isDesktopOnly: false` | Global Constraints; Task 1 manifest; `src/` uses only Obsidian and DOM APIs (`vault.adapter` trash methods exist on mobile adapters too) |
| Modules schema, scene, operation, duplicates, backcross, layout, render, forms, commands | Tasks 3 to 17 (one module per task; forms split into pure options, Task 10, and the two modals, Tasks 11 and 13) |
| Command names match the script names; ids kebab-case (Sean's decision) | Task 1 `COMMANDS`, `commandId`; harness `cid` (Task 2) |
| operation ported from `undo-safe` (on `main` after the merge), nested commands join, one undo step, rollback | Before you start; Task 5; proven by `tests/undo.sh` in Task 18 |
| Parity suite: existing tests ported to plugin commands, unchanged, `undo.sh` included; fixtures unchanged | Task 2 (engine switch, only invocation plumbing changes), Tasks 11 to 17 (per command), Task 18 (all, on script-built then plugin-built fixtures) |
| Vitest unit tests for layout, picker options, duplicates and backcross on plain arrays, schema | Tasks 3, 6, 7, 8, 10 |
| Write-guard unit test (`updateScene`, `addElementsToView`, `deleteViewElements`, history API outside `operation`) | Task 5 |
| Run-all sync and discipline checks replaced | Task 22 Step 2 |
| `manifest.json`, `versions.json` at root; releases with `main.js`, `manifest.json`, `styles.css`; BRAT | Tasks 1, 20 |
| Release flow: private `main`, orphan `public`, `tools/scan.sh`, date versions (`YYYY.MDD.N`, Sean's decision) | Task 21 Steps 2 and 4 |
| Font setup the installer did, offered on first load with confirmation (Sean's decision) | Task 20 |
| Installer note and "Update Fly Genetics" retired after migration | Task 22 (gated) |
| Migration: What's new in the last scripts release; first-load offer by installer file names; never deletes without confirmation; drawings unchanged | Task 21 Step 6; Task 19 |
| Scripts retired only after parity | Task 22 gate |
| Non-goals: no new features, drawing format unchanged | Porting rules 6 to 11; schema validator built from fixtures (Task 3) |

Placeholder scan: no "TBD", no "similar to Task N". Two values are looked up at execution time with exact commands, not left open: `<MIN_APP>` (Task 1 Step 9, from Excalidraw 2.20.2's manifest) and `<VERSION>` (the scaffold day as `YYYY.MDD.0`). Line ranges are on `undo-safe@88155fb` and paired with function names, per rule 1.

Name consistency (checked across tasks): `runOperation(app, env, view, name, body)`, `OperationContext.{commit, commitPatches, deleteElements, setAppState, selectElements, join}`, `operationEnv(plugin)`, `take`/`peek`/`put`, `splitDuplicateGenotypes(ctx)`, `splitMultiRowParents(ctx, lineage, subset)`, `layoutLineage(input)`, `childArrowPoints(from, to, rows, obstacles)`, `drawGenotype`/`placeGenotype`, `genotype(ctx, params, modals)`, `crossGenotypes(ctx, params, modals)`, `tidy(ctx, params)`, `select(ctx, mode)`, `tidyBelow(ctx)`, `breakCross(ctx)`, `toggleCrossMode(plugin, view)`, `offerMigration(plugin)`, `offerFontSetup(plugin)`, `planFontSetup`/`needsFontSetup`, `COMMANDS`/`commandId(name)` (plugin) and `cid(name)` (harness, same kebab-case rule), `dateVersion`/`setVersion`, `TestingHooks.{run, record, idle, closeModals, modals, errors}`.

Fixed during review: `peek` added to `hooks.ts` (Tidy's `_tidyLastResult` bump and Cross Mode's toggle read without clearing); `tests/plugin-smoke.sh`'s error probe moved off each command as it gets ported (Tasks 14 and 17) so it never tests a stub that no longer exists; Cross Mode's history call routed into `operation` (`unrecordLastStep`) and its appState updates into `setAppState`, since the write guard forbids both outside `operation`; Select Lineage had no test, so Task 14 adds `tests/select.sh`, validated on the scripts before the port.

## Open questions and spec gaps (for Sean)

Decided by Sean (applied above): versions `YYYY.MDD.N`; the plugin offers the font setup the installer did; kebab-case command ids with the script names as display names.

1. **Tag format.** The current flow tags `v<version>`; BRAT accepts it (it coerces tags), but Obsidian's community store requires the tag to equal the version exactly. Fine for BRAT; only relevant if the plugin is ever submitted to the store.
2. **Retirement timing.** Un-migrated labmates' "Update Fly Genetics" fetches `dist/Install Fly Genetics.md` from the public `main`; Task 22 removes it. Task 22 is gated on Sean confirming labmates have moved.
