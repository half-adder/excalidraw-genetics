# CLAUDE

## Context

Excalidraw Script Engine scripts for *Drosophila* genetic crossing schemes. Files in `scripts/` are **symlinked** into the development vault's Excalidraw script folder:

```
<vault>/Excalidraw/Scripts/
```

Edits to `scripts/*.md` reach the vault file through the symlink, but the Excalidraw Script Engine does **not** reload a script edited outside Obsidian: it keeps running the cached version. After each edit, re-save the file through Obsidian so the engine picks it up:

```
obsidian eval code="(async()=>{const f=app.vault.getAbstractFileByPath('Excalidraw/Scripts/<Name>.md');await app.vault.modify(f,await app.vault.adapter.read(f.path));return 'resaved'})()"
```

Verify the reload before trusting a test result (e.g. expose a new value on a window global and check it).

## Skills to use

- **`/excalidraw-scripting`** for any script development, modification, or debugging. It has the EA API reference, testing loop, and pitfalls. Don't write Excalidraw script code without invoking it.
- **`/obsidian-cli`** for any operation against the vault (read/write notes, search, list commands, run plugin commands). Don't `cat`/`grep` vault files directly when the CLI has a structured equivalent.

## Test canvas

Never iterate against the user's working drawings. Prefer a **throwaway drawing** per test run: create it with `ea.create({filename:'_test-...', foldername:'Excalidraw', onNewPane:true})`, and when done detach its leaf and `app.vault.delete()` the fixed throwaway paths: the `.excalidraw.md` and its auto-exported `.excalidraw.svg` (see `trashDrawing` in `tests/harness.js`). Tests must never use the system trash (`app.vault.trash()`, `adapter.trashSystem`, `fileManager.trashFile`): delete only the paths the test itself created. The user also experiments on `Excalidraw/_test-scratch.md`, so check what is on it (and whether a script modal of theirs is open) before using it, and close only modals you opened.

Gotchas:
- `editor:undo` is the Markdown editor's command and does not reach Excalidraw. To undo, dispatch a `keydown` (`key: "z"`, `metaKey: true`) on the view's `.excalidraw` container.
- `obsidian eval` prefixes its output with `=> `; strip it before comparing results in shell.
- Deselecting via `updateScene({appState:{selectedElementIds:{}}})` can lag; clear `selectedGroupIds` too and confirm `ea.getViewSelectedElements().length === 0` before running a script whose behavior depends on the selection (e.g. Tidy).

## Test loop (scripts, until they are retired)

Scripts cannot be unit-tested in isolation. They run inside the Excalidraw plugin against a live Excalidraw view. The reliable pattern:

1. Open the test scratch via `obsidian open file="_test-scratch"`. Verify the active view is the scratch (so `ea.setView()` doesn't bind to a user's real drawing):
   ```
   obsidian eval code='ea=ExcalidrawAutomate; ea.setView(); ea.targetView?.file?.path'
   ```
   Expected: `Excalidraw/_test-scratch.md`.
2. Test logic via `obsidian eval` (use a temp-file payload for anything past one statement). See `references/testing-loop.md` in the excalidraw-scripting skill.
3. For end-to-end tests including `utils.suggester` / `utils.inputPrompt`, invoke via the Script Engine: `obsidian command id="obsidian-excalidraw-plugin:<Script Title>"`. Modals cannot be answered from the CLI, so combine with the **agentic test hook** pattern below for unattended runs.
4. Visual check: `obsidian dev:screenshot path=/tmp/x.png && sleep 1` (the PNG is written asynchronously) then `Read` the PNG.

## Plugin test loop (the default engine)

The `fly-genetics` plugin (`src/`, TypeScript, bundled to `main.js` by esbuild) is what the tests run by default. The loop:

1. `npm run build` (type check and bundle), then `tools/dev-install.sh` once per vault (links `main.js`, `manifest.json`, `styles.css` into `$FLY_VAULT/.obsidian/plugins/fly-genetics` and enables the plugin).
2. After each build: `obsidian plugin:reload id=fly-genetics` (never reload Obsidian itself). The harness also reloads the plugin on its own when `main.js` changed.
3. `obsidian dev:errors` shows errors Obsidian captured; a command that throws is also recorded in `plugin.testing.errors`, which fails the Obsidian-driven tests.
4. `npm test` runs the Vitest unit tests (`tests/unit/`); `tests/<name>.sh` runs one Obsidian-driven test; `tests/run-all.sh` runs the unit tests and every Obsidian-driven test (slow).

Test engine switches (`tests/lib.sh`):
- `FLY_ENGINE=plugin` (default): `T.run` runs the plugin's commands; `lib.sh` runs `npm run build` first. Fixtures are hashed from the `src/` files that determine what the Genotype, Cross Genotypes and Tidy commands build (`FIXTURE_SRC` in `tests/harness.js`), not all of `main.js`, so unrelated plugin changes (migration, font-offer, other commands) don't mark them stale. A change to one of those files makes fixtures stale and the next test that loads one rebuilds it (commit the rebuilt fixtures).
- `FLY_ENGINE=scripts`: runs the Script Engine scripts in the vault (symlinks into `~/code/excalidraw-genetics/scripts`) and hashes fixtures with the scripts. Kept until the scripts are retired; before using it, confirm that checkout is on `main` with `git -C ~/code/excalidraw-genetics status --short scripts` empty, and set `FLY_FROZEN=1` too (the committed fixtures are plugin-built, so without it the scripts engine rebuilds them). The scripts' installer and updater (`tests/installer.sh`, `tests/updater.sh`) always run as scripts.
- `FLY_FROZEN=1`: loads fixtures as saved, without rebuilding stale ones (to run one engine on fixtures the other built).

The test and interop globals (`window._genotypeAuto`, `_crossGenotypesAuto`, `_genotypeCreateAt`, ...) keep the scripts' names and shapes and are read through `take` and `put` in `src/hooks.ts`. Every scene write in the plugin goes through `src/operation` (the undo-safe transaction below, ported): commands get an `OperationContext` and use `ctx.commit()`, `ctx.commitPatches()`, `ctx.deleteElements()`, `ctx.selectElements()` and `ctx.setAppState()`, and start child commands with `ctx.start()` (the scripts' `flyStart`: the child joins the operation, and its failure is put back and reported under its own name). `ctx.join()` awaits the child and turns its failure into the parent's error (so the parent's own changes are put back too); use it only for a child whose failure must fail the parent. No command needs that today. `tests/unit/write-guard.test.ts` fails if any file outside `src/operation/` names a scene or undo-stack write (`updateScene`, `addElementsToView`, `deleteViewElements`, `mutateElement`, `history` and the others listed there).

## Undo-safe operations (rule for every scene change)

Every command is ONE undo step, including the scripts it starts (design: `docs/plans/2026-09-29-undo-safe-design.md`). This holds by construction only if every script follows the shared commit discipline:

- A script that changes the drawing carries the "Undo-safe operations (same in every script; keep in sync)" block unchanged (edit it in one script, copy it to the others) and is listed in `REQUIRED_OP_SCRIPTS` in `tests/run-all.sh`.
- Its work runs inside `return await flyOperation("<Script name>", async () => { ... });` (body not indented). Work started later (a timer, as in Cross Mode) is wrapped in `flyOperation` there.
- Change elements only with `flyAddElementsToView()` (delete by setting `isDeleted` on the workbench copy) or `flyDeleteViewElements(els)`; select with `flySelect(els)` (or `updateScene({ appState })`). Never `ea.addElementsToView`, `ea.deleteViewElements`, `addElements`, `mutateElement`, `moveViewElementToZIndex`, `ea.selectElementsInView` (it records a step), `history.undo/redo` (use `flyUnrecordDrawn`), `captureUpdate`, or `updateScene` with elements or a non-literal argument.
- Start another script only with `flyStart("<Script name>")`, never `executeCommandById`, so it joins the operation. When waiting for its result, also stop when the promise `flyStart` returns resolves (the script ended, maybe by failing).
- `flyOperation` takes the file's own script name (checked).
- Add a case to `tests/undo.sh`: one undo restores the drawing exactly and a second changes nothing, one redo re-applies it and a second changes nothing, a cancel records nothing.

`tests/run-all.sh` fails (`undo-safe-discipline`) if the block drifts or a script writes the scene or starts a script outside the helpers. Scene writes are unrecorded (`NEVER`) and the operation records one step from its start to its end when its last script finishes; `EVENTUALLY` is not used because the plugin's own `NEVER` updates silently drop pending `EVENTUALLY` changes from history. Excalidraw's own captures inside a commit (`refreshAllArrows`) are kept out of the history by `flyQuietly`; see the design doc's findings before touching the block.

## Agentic test hook pattern

Scripts in this repo (e.g. `Cross Genotypes.md`) expose a `window._<scriptName>Auto` global. When set, prompts are skipped and the global's values are used; the global is consumed (cleared) on read. Pattern:

```js
const _auto = (typeof window !== "undefined" && window._crossGenotypesAuto)
  ? window._crossGenotypesAuto
  : null;
if (_auto && typeof window !== "undefined") window._crossGenotypesAuto = undefined;

const valueA = _auto ? _auto.valueA : await utils.suggester(...);
```

This makes the prompt-driven script drivable from the terminal:

```bash
# 1. Seed scene state (selection, etc.) via obsidian eval.
# 2. Inject config:
obsidian eval code="window._crossGenotypesAuto = {valueA: 'x', valueB: 'y'}; 'set'"
# 3. Run:
obsidian command id="obsidian-excalidraw-plugin:Cross Genotypes"
# 4. Verify side effects:
sleep 1
obsidian eval code="ea=ExcalidrawAutomate;ea.setView();JSON.stringify(/* probe */)"
```

Top-level `await` in `obsidian eval` is a `SyntaxError`; wrap in `(async () => { ... })()`. Multi-line `code='...'` past a few statements is unreliable; use `code="$(cat /tmp/payload.js)"`.

## Debugging

Excalidraw scripts swallow exceptions in the async wrapper. If a script "runs" but does nothing:
- Check that `window._<scriptName>Auto` was consumed (became `undefined`). If it was consumed but no scene change happened, an exception was likely caught silently.
- Add a temporary `try/catch` around the suspect block. Stash the error in a window global (`window._lastScriptError = String(e)`) and emit a `new Notice`. Remove before committing.
- Common silent-failure root cause: `ea.getElement(id)` on a view-element id returns `undefined`. The two pools (view, workbench) are disjoint. See excalidraw-scripting skill `references/pitfalls.md#getelement_vs_view`.

## Reference

See `README.md` for the v1 customData schema, shorthand syntax, and roadmap. See `docs/plans/2026-05-31-schema-v2-design.md` for the v2 cross + lineage design.

## Publishing

The public repo (github.com/half-adder/excalidraw-genetics) has its own history: the orphan branch `public`, pushed as its `main` (remote `public`). Private history on `main` is never pushed (older commits mention unpublished research).

Versions are release dates in the form `YYYY.MDD.N`: year, month and two-digit day, then a release counter from 0 (`2026.929.0`, `2026.929.1` later the same day, `2026.1001.0` on October 1). `node tools/set-version.mjs` computes today's next one from `versions.json`.

To release:

1. On `main`: `node tools/set-version.mjs` (prints the version), add a `## <version>` section at the top of `CHANGELOG.md`, commit.
2. `npm test` and `tests/run-all.sh` must pass; `npm run build`; while the scripts still ship, `uv run installer/build.py` and commit `dist/`.
3. `git status` must be clean. Then `tools/scan.sh` must PASS.
4. `git switch public && git rm -rq . && git checkout main -- . && git commit -m "Release <version>" && git push public public:main`, then `git tag v<version> && git push public v<version>` and `gh release create v<version> --repo half-adder/excalidraw-genetics --title <version> --notes "<that CHANGELOG section>" main.js manifest.json styles.css`; `git switch main`.

Labmates install and update through BRAT from the releases (`main.js`, `manifest.json`, `styles.css` assets); `manifest.json` and `versions.json` are at the repository root. Older `CHANGELOG.md` headings keep their `YYYY.M.D` form.
