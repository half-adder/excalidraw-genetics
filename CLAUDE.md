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

Never iterate against the user's working drawings. Prefer a **throwaway drawing** per test run: create it with `ea.create({filename:'_test-...', foldername:'Excalidraw', onNewPane:true})`, and when done detach its leaf and `app.vault.trash()` both the `.excalidraw.md` and its auto-exported `.excalidraw.svg` (see `tests/tidy-sibling-order.sh`). The user also experiments on `Excalidraw/_test-scratch.md`, so check what is on it (and whether a script modal of theirs is open) before using it, and close only modals you opened.

Gotchas:
- `editor:undo` is the Markdown editor's command and does not reach Excalidraw. To undo, dispatch a `keydown` (`key: "z"`, `metaKey: true`) on the view's `.excalidraw` container.
- `obsidian eval` prefixes its output with `=> `; strip it before comparing results in shell.
- Deselecting via `updateScene({appState:{selectedElementIds:{}}})` can lag; clear `selectedGroupIds` too and confirm `ea.getViewSelectedElements().length === 0` before running a script whose behavior depends on the selection (e.g. Tidy).

## Test loop

Scripts cannot be unit-tested in isolation. They run inside the Excalidraw plugin against a live Excalidraw view. The reliable pattern:

1. Open the test scratch via `obsidian open file="_test-scratch"`. Verify the active view is the scratch (so `ea.setView()` doesn't bind to a user's real drawing):
   ```
   obsidian eval code='ea=ExcalidrawAutomate; ea.setView(); ea.targetView?.file?.path'
   ```
   Expected: `Excalidraw/_test-scratch.md`.
2. Test logic via `obsidian eval` (use a temp-file payload for anything past one statement). See `references/testing-loop.md` in the excalidraw-scripting skill.
3. For end-to-end tests including `utils.suggester` / `utils.inputPrompt`, invoke via the Script Engine: `obsidian command id="obsidian-excalidraw-plugin:<Script Title>"`. Modals cannot be answered from the CLI, so combine with the **agentic test hook** pattern below for unattended runs.
4. Visual check: `obsidian dev:screenshot path=/tmp/x.png && sleep 1` (the PNG is written asynchronously) then `Read` the PNG.

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

The public repo (github.com/half-adder/excalidraw-genetics) has its own history: the orphan branch `public`, pushed as its `main`. Private history on `main` is never pushed (older commits mention unpublished research). To release:

1. On `main`: commit, run `tests/run-all.sh`, `uv run installer/build.py`, commit `dist/`.
2. `tools/scan.sh`: checks tracked files and the text inside the built installer against the maintainer's private blocklist (kept outside the repo); it must PASS.
3. `git switch public && git rm -rq . && git checkout main -- . && git commit -m "<release notes>" && git push public public:main && git switch main`.

Labmates update with the "Update Fly Genetics" command, which fetches `dist/Install Fly Genetics.md` from the public `main`.
