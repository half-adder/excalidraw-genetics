# Undo-safe operations

Bug report: "undoing a cross deletes a bunch of stuff". Requirement: every
operation is safely undoable, by construction, not by patching scripts one
symptom at a time. One command (with every script it starts) is one undo
step, and no intermediate state is reachable by undo or redo.

Regression test: `tests/undo.sh`. Rule check: the `undo-safe-discipline`
step of `tests/run-all.sh`.

## How scripts committed before

Every script wrote the scene through ExcalidrawAutomate, and each write was
its own undo step:

- `ea.addElementsToView` goes through `ExcalidrawView.addElements`, which
  calls `updateScene` with `captureUpdate: IMMEDIATELY` (plugin
  `src/view/ExcalidrawView.ts`, `addElements`).
- `ea.deleteViewElements` removes elements from the scene, also
  `IMMEDIATELY` (`src/shared/ExcalidrawAutomate.ts`, `deleteViewElements`).
- A script starts another one with `app.commands.executeCommandById`, fire
  and forget: Cross Genotypes starts Tidy, Tidy Below starts Select Below
  and then Tidy, Cross Mode starts Genotype and Cross Genotypes.

So one command made several steps. Commits per operation (before):

| Operation | Commits |
|---|---|
| Genotype (edit) | 2: the redraw, then the frame and lineage arrow resized |
| Cross Genotypes | the cross, Tidy's delete of the old lineage, Tidy's re-add, plus a selection step; more when a split runs |
| Tidy (everything) | 2 per lineage (delete, re-add) |
| Tidy Below | Select Below's split (if any), Tidy's delete and re-add |
| splitDuplicateGenotypes (7 scripts), Tidy's splitMultiRowParents | 1 each, when they act |

Undo walked back through those steps. The worst one is the state between
Tidy's delete and its re-add: undo 2 after a cross reverted the re-add while
the delete stayed, and the whole lineage disappeared. Undo 4 reached the
drawing before the cross, but fractional indices (`index`, z-order) still
differed, from the delete and re-add. Break Cross was one step, but its undo
did not put the restored arrow back on the x glyph's `boundElements`.

## What Excalidraw does (measured, plugin 2.27.3)

Excalidraw's store records history in `componentDidUpdate`, from its
snapshot of the scene to the scene now, according to the `captureUpdate`
scheduled since the last render:

- `IMMEDIATELY`: records the change from the snapshot, then moves the
  snapshot.
- `NEVER`: moves the snapshot without recording.
- `EVENTUALLY`: does nothing; the change is recorded with the next
  `IMMEDIATELY`.

Measured in the plugin (throwaway drawing, `obsidian eval`):

1. `EVENTUALLY` is not safe to carry an operation. The plugin itself issues
   `NEVER` updates at unrelated times (e.g. `gridColor`,
   `frameColor/dynamicStyle` after a scene change). Each moves the snapshot,
   so pending `EVENTUALLY` changes before it are silently dropped from
   history: a text element added with `EVENTUALLY` and then flushed with
   `IMMEDIATELY` was not removed by undo.
2. The store sees an element as changed only if its `version` went up
   (`prev.version < next.version`). Putting an older copy back with the old
   version is invisible to it.
3. An element the next scene leaves out is marked deleted in the snapshot,
   one version up, keeping its last `index`. A restored element whose index
   is out of order with the array is re-indexed by undo (`reorderElements`,
   `syncMovedIndices`), so undo does not give back its `index`.
4. An element that goes from deleted (in the snapshot) to live is recorded
   as "updated", and undo does not delete it again; an element missing from
   the snapshot is "added", and undo deletes it.
5. `boundElements` changes are merged by id on undo (`Delta.mergeArrays`):
   a reference that comes back is appended, so an x glyph that lost the
   first of two arrows gets them back in the other order. Native Excalidraw
   (delete a bound arrow, undo) does the same.
6. `ea.addElementsToView` takes `captureUpdate` as its fifth argument since
   plugin 2.20.2.
7. `ExcalidrawView.updateScene` flushes the render synchronously when
   `appState` is passed, so two consecutive updates are two store commits.
8. `ea.selectElementsInView` (`api.selectElements`) records a step of its
   own, taking whatever the scene has pending with it.
9. `refreshAllArrows`, which `addElementsToView` runs when arrows or bound
   elements are involved, asks for a capture when it moves an arrow: the
   next store commit, even one requested `NEVER`, is then recorded,
   pending changes included. Skipping it is not an option: elbow arrows are
   left half-normalized (`fixedSegments`, `startIsSpecial`) and Excalidraw
   rewrites them later.
10. A `NEVER` update takes into the store only what it changes compared to
   the current scene. A selection change made without `captureUpdate`
   (Excalidraw's default, `EVENTUALLY`) therefore stays pending until a
   recorded commit, which then records it.

## Options considered

**(a) Each script accumulates everything and commits once**, deleting with
`isDeleted` in the same commit instead of `deleteViewElements`. This makes
each script one step, but not an operation: Cross Genotypes and the Tidy it
starts are two scripts, two commits, two steps. Scripts cannot import each
other, so a single commit across them would mean passing the workbench
between scripts. Tidy also reads the scene between its phases (obstacles,
bound arrows), so "accumulate everything" means rewriting it to work on a
virtual scene. It does not cover a script that fails halfway.

**(b) An operation-level transaction with `EVENTUALLY`**: intermediate
commits `EVENTUALLY`, one final `IMMEDIATELY` by the outermost script. This
is the natural reading of Excalidraw's docs, but finding 1 rules it out: any
`NEVER` update from the plugin while the operation runs (and there are
several per scene change) drops everything before it from history. Undo
would then miss part of the operation, which is the original bug in another
form. It also leaves changes pending if a script stops without the final
flush, and they then merge into the user's next action.

**(c) An operation-level transaction that records one step at the end**
(chosen). Intermediate commits are `NEVER`: they are never recorded and a
plugin `NEVER` cannot lose them, because nothing is pending. When the
operation ends, it is recorded from the drawing as it was when it started
to the drawing now, by putting the start back unrecorded and then the end
recorded. This keeps (b)'s shared transaction across chained scripts and
gives the single-commit guarantee of (a) without rewriting the scripts'
logic.

## The design

Each script that changes the drawing carries the same helper block,
"Undo-safe operations (same in every script; keep in sync)", between its
header and its body (scripts cannot import each other; `run-all.sh` checks
that the block is byte-identical in every such script, as for
splitDuplicateGenotypes). The script's work runs inside it:

```js
return await flyOperation("Tidy", async () => {
  // ... the script, unindented ...
}); // end of the operation
```

- `flyOperation(name, body)` joins the drawing's open operation, or opens
  one, noting the selection and the drawing (file) its view shows.
  Operations are kept per view (`window._flyOperations`, a WeakMap). It
  counts the scripts running in the operation and, in `finally`, ends it if
  none is left. The operation's "before" (a deep copy of the scene, deleted
  elements included) is taken at its first scene change, so a form that is
  open before then is not part of it.
- `flyAddElementsToView()` commits the EA workbench as
  `ea.addElementsToView(false, false, true)` did, with `captureUpdate:
  NEVER`, and runs Excalidraw's closing `refreshAllArrows` and
  `updateContainerSize` through `flyQuietly` (finding 9): it settles the
  pending selection into the store (finding 10), lets the call change the
  elements, takes the capture it asked for with the elements put back as
  they were (nothing to record), then puts the changed elements back,
  unrecorded.
- `flyDeleteViewElements(elements)` marks elements deleted in place, `NEVER`
  (it replaces `ea.deleteViewElements`, which removed them and recorded a
  step; it does not refresh arrows, so Tidy can re-bind the arrows of a
  deleted frame afterwards).
- Both go through `flyWriting`. Each script is bound to the operation it
  joined (`window._flyScriptOps`, EA instance to operation), and
  `flyWriting` throws unless that operation is still the view's open one
  (a change can never be made that no operation records, and a script of a
  stale operation cannot write into a newer one). It keeps, per script, how
  every element that script's writes changed, added or removed was before
  its first change to it, and the version its last write left.
- `flySelect(elements)` selects elements with their groups, `NEVER`
  (finding 8).
- `flyStart(name)` starts another script by its command as part of the
  operation: it reserves a place for it, so the operation stays open until
  that script has joined and finished (or has not started within 15 s). It
  returns a promise that resolves when that script has ended, so a caller
  waiting for the script's result (Cross Mode, Tidy Below) stops waiting
  when the script fails without one. If the caller's operation is stale
  (its drawing left the view), it starts nothing and the promise carries
  `skipped` (Tidy Below then drops its Tidy seed).
- `flyUnrecordDrawn(element)` takes a user's just-drawn element out of the
  drawing and the history (see Cross Mode's line below).
- `flyFinish(op)` ends the operation once nothing runs in it and no started
  script is still expected. After one frame (at most 100 ms, as a hidden
  window renders none; the view's own window is used, for popouts), it
  compares "before" with the scene now:
  - no element changed (only the selection, or nothing): one `NEVER`
    update, so nothing is recorded and nothing stays pending;
  - otherwise three updates, each raising the versions of what it changes
    (finding 2): (1) the final scene with the new elements' `index` cleared,
    `NEVER`, so Excalidraw gives them indices after the old elements;
    (2) "before" (the old elements as they were, new ones left out),
    `NEVER`, with the old selection; (3) "after" (the old elements as they
    are now, in their order with their old `index`, the ones the operation
    removed back in place as deleted; then the new elements with the
    indices from (1)), `IMMEDIATELY`, with the current selection. Step (3)
    is the only recorded change: from exactly "before" to exactly "after".
    New elements are in the store at their final index before (2) leaves
    them out (findings 3 and 4), and old elements never change position, so
    undo and redo move nothing in the z-order. If an update fails, the
    scene as the operation left it is put back, unrecorded, and the error
    is re-thrown.
- A script that throws has the elements its own writes changed put back as
  they were before its first change to them (elements it added removed),
  `NEVER`, then the error is re-thrown. An element whose version is no
  longer the one the script's last write left was changed since by someone
  else and is left as it is. Nothing else is touched: writes of other
  scripts in the operation (a child that ran after it, a child still
  running) and user edits stay, including their changes to elements the
  failing script had changed (a child binding an arrow into one). The rest of the operation is recorded as
  usual (a cross whose Tidy fails is one step, the cross alone; Tidy Below
  failing after its Select Below split a copy is one step, the split).
- An operation whose view has moved on to another drawing (Obsidian reuses
  the view when a tab opens another file) is stale: `flyWriting`, the
  rollback, `flyStart` and `flyFinish` see `view.file` differ from the
  operation's file, end it and write, start and record nothing; a script
  started in the new drawing opens an operation of its own.

### Why this is one undo step, by construction

- Inside an operation nothing is ever recorded: every scene write goes
  through a helper that writes `NEVER`, and `run-all.sh` fails if a script
  writes the scene any other way outside the helper block
  (`ea.addElementsToView`, `ea.deleteViewElements`, `addElements`,
  `mutateElement`, `moveViewElementToZIndex`, `selectElementsInView` /
  `selectElements`, `history.undo` / `redo`, `captureUpdate`, `updateScene`
  other than with an object literal without elements), starts a script
  other than with `flyStart`, or runs its work in `flyOperation` under
  another script's name. Excalidraw's own captures that a commit triggers
  (finding 9) are taken with nothing to record by `flyQuietly`.
- The only recorded update is flyFinish's step (3), made once per
  operation, when its last script ends. It is computed from the operation's
  "before", not from intermediate states, so no intermediate state exists in
  the history to undo into.
- Chained and nested scripts join the same operation: the parent's
  `flyStart` reserves a place before the child starts, so the operation
  cannot end between the parent finishing and the child starting (Cross
  Genotypes ends before its Tidy starts). Whoever finishes last records.
  Cross Mode opens its operation per cross line, around the Genotype forms
  and the cross it starts.
- Errors: `finally` always ends the operation, and a started script's
  promise resolves when it ends, so no caller waits forever; a failed
  script's own writes are rolled back first.
- Cancel and no-op: an operation that changed no element records nothing
  and settles its selection changes with `NEVER`, so the user's next action
  is recorded on its own.

### Cross Mode's line

The user draws the cross line, and Excalidraw records that as a step before
Cross Mode sees it. To make undo return to the drawing before the line,
Cross Mode undoes that step (`flyUnrecordDrawn`, `api.history.undo()`)
before it opens the operation (after checking the plugin version, so an
unsupported plugin leaves the line alone), checking that it removed exactly the line (every other element
unchanged); if not, it redoes it and deletes the line inside the operation
instead (then the line stays a separate step). The operation's recorded step
clears the redo stack. If the operation is cancelled (picker cancelled),
nothing is recorded; a redo right then brings the line back, as for any
undone step.

### Requirements

Excalidraw plugin 2.20.2 or newer (`addElementsToView`'s `captureUpdate`
argument). `flyOperation` checks it and the installer requires it.

## Rule for new operations

1. A script that changes the drawing copies the "Undo-safe operations"
   block unchanged and is added to `REQUIRED_OP_SCRIPTS` in
   `tests/run-all.sh`.
2. Its work runs inside `return await flyOperation("<Script name>", async
   () => { ... })` (for a script that changes the scene later, e.g. from a
   timer, wrap that work in `flyOperation`).
3. It changes elements only with `flyAddElementsToView()` (delete by setting
   `isDeleted` on the workbench copy) or `flyDeleteViewElements`, and
   selects with `flySelect` (or `updateScene({ appState })`).
4. It starts another script only with `flyStart("<Script name>")`, and
   waits for its result racing the promise `flyStart` returns.
5. `tests/undo.sh` gets a case for it: one undo restores the drawing
   exactly and a second changes nothing; one redo re-applies it and a
   second changes nothing; a cancel records nothing; a failure puts back
   what the failing script changed.

## Known limits

- `boundElements` order after undo (finding 5): when an operation removes a
  reference that was not last in an element's `boundElements` (Break Cross
  removing the first of two arrows from an x glyph), undo restores it at the
  end of the list. Same references, other order; Excalidraw treats the list
  as a set keyed by id, and `tests/undo.sh` compares it as a set of
  `{id, type}` references (order ignored); everything else is compared
  exactly.
- A change the user makes to the drawing after an operation's first change
  and before its end (only possible while a form opens mid-operation, e.g.
  Cross Mode's second Genotype form) is folded into the operation's step.
