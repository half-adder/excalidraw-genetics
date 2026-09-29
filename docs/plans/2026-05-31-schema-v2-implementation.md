# Schema v2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> REQUIRED DOMAIN SKILL: Use `/excalidraw-scripting` for every code change. It owns the EA API reference, the iterative test loop, and Excalidraw pitfalls. Do not write or modify script code without invoking it.

**Goal:** Add cross structure and lineage tracking to the genetics Excalidraw scripts, per the design at `docs/plans/2026-05-31-schema-v2-design.md`.

**Architecture:** Bump `schemaVersion` to 2. Add a `parents: {maternal, paternal}` field (absent on roots) to genotype-member elements. Introduce four new element kinds: `genotype-label`, `cross-glyph`, `cross-lineage`, `cross-criterion`. Rename `Tidy Genotype` to `Tidy` and expand to walk the connected DAG lineage. Add a new `Cross Genotypes` script. Lazy v1 to v2 migration on read.

**Tech Stack:** Excalidraw Script Engine (markdown files with embedded JS), `ExcalidrawAutomate` (ea) API, executed in Obsidian's Excalidraw plugin. No package manager. No build step. Files in `scripts/` are symlinked into the development vault.

**Testing model:** Scripts cannot be unit-tested in isolation. Every task verifies via the iterative test loop documented in CLAUDE.md and the `/excalidraw-scripting` skill: open Excalidraw view, run script (via `obsidian eval` or `obsidian command`), inspect state, screenshot, compare. **Each task ends in a verification step against the live plugin.** Do not mark a task complete based on code-reading alone.

**Code-sharing constraint:** Excalidraw Script Engine scripts cannot import each other. Helpers must be inlined per script. We accept duplication between Build / Tidy / Cross. When changing a shared helper, change every copy. This plan calls out which copies exist.

**Reference reading:**
- Design doc: `docs/plans/2026-05-31-schema-v2-design.md`
- Mindmap-builder KB: `references/mindmap-kb/00-index.md`
- Current scripts: `scripts/Build Genotype.md`, `scripts/Tidy Genotype.md`

**Branch:** `schema-v2` (already checked out at plan creation time).

---

## Phase 1: Schema version bump

**Outcome:** Both existing scripts emit `schemaVersion: 2`. No other observable behavior change. No new fields. v1 elements drawn before this phase continue to read correctly (their customData has `schemaVersion: 1`, which downstream scripts will treat as roots).

This phase is the safety net: it lets us catch any "I wrote 1, you read 2" bugs immediately, in isolation, before introducing new fields.

### Task 1.1: Bump SCHEMA in Build Genotype

**Files:**
- Modify: `scripts/Build Genotype.md:33` (the line `const SCHEMA = 1;`)

**Step 1: Make the edit**

Change `const SCHEMA = 1;` to `const SCHEMA = 2;` on line 33 of `scripts/Build Genotype.md`.

**Step 2: Verify in vault**

Open Excalidraw view in vault, invoke the Build Genotype script, build a test genotype like `w; +/+; TM3/+`. Then via `obsidian eval`:

```js
ea = ExcalidrawAutomate; ea.setView();
els = ea.targetView.excalidrawAPI.getSceneElements();
els.filter(e => e.customData?.kind === "genotype-allele")
   .map(e => ({ kind: e.customData.kind, schemaVersion: e.customData.schemaVersion }))
```

Expected: every allele has `schemaVersion: 2`.

**Step 3: Commit**

```bash
git add scripts/"Build Genotype.md"
git commit -m "Bump Build Genotype schemaVersion to 2"
```

### Task 1.2: Bump SCHEMA in Tidy Genotype

**Files:**
- Modify: `scripts/Tidy Genotype.md:25`

**Step 1: Make the edit**

Change `const SCHEMA = 1;` to `const SCHEMA = 2;` on line 25 of `scripts/Tidy Genotype.md`.

**Step 2: Verify in vault**

Build a v1 genotype (it will have `schemaVersion: 1` if you reset it; or just trust the prior task and build a fresh one which will be `2`). Select an element, run `Tidy Genotype`. Verify via `obsidian eval` as in Task 1.1 that all elements now have `schemaVersion: 2`.

Lazy migration falls out for free: Tidy re-tags every element, and the tag function writes the current `SCHEMA` constant.

**Step 3: Commit**

```bash
git add scripts/"Tidy Genotype.md"
git commit -m "Bump Tidy Genotype schemaVersion to 2"
```

---

## Phase 2: Helpers + Tidy rename

**Outcome:** `Tidy Genotype` is renamed to `Tidy`. The script gains a set of helper functions (inline). It still operates on a single genotype with no new user-visible behavior, but the helpers are in place for Phase 3 and 4. Lazy migration logic is in place (no `parents` field is added on existing genotypes; new genotypes from Build have no parents either, because Build always creates roots).

### Task 2.1: Rename Tidy Genotype to Tidy

**Files:**
- Rename: `scripts/Tidy Genotype.md` → `scripts/Tidy.md`
- Update header comment inside the file: change the script name and description to reflect lineage scope (per design doc section "Tidy").

**Step 1: Rename file**

```bash
git mv "scripts/Tidy Genotype.md" "scripts/Tidy.md"
```

**Step 2: Update the file's header comment**

Replace the opening comment block (lines 1-18 of the original) with:

```js
/*
Tidy
====
Reflows the connected lineage of the selected element.

In v1 terms: if the selected genotype has no parents and no descendants,
this behaves identically to "Tidy Genotype" (reflows just that genotype).

In v2: walks the connected DAG of genotypes via the `parents` field on each
offspring's elements. Collects ancestors and descendants to a fixpoint,
computes per-genotype generation depth (longest path from any root), lays
out each generation in a horizontal band ordered by parent-position barycenter,
and renders cross furniture (x glyph, lineage lines, optional selection
criteria) from the offspring-side `parents` field as the source of truth.

Manual text edits to alleles, labels, and criteria are honored. Element ids
regenerate. `genotypeId` is preserved.

Usage:
  Select ANY element of any genotype in the lineage. Everything connected
  is reflowed; everything else is untouched.
*/
```

**Step 3: Update the vault symlink**

The vault symlink at `<vault>/Excalidraw/Scripts/Tidy Genotype.md` is now stale. Remove the old symlink and add a new one for `Tidy.md`:

```bash
rm "$FLY_VAULT/Excalidraw/Scripts/Tidy Genotype.md"
ln -s "$PWD/scripts/Tidy.md" "$FLY_VAULT/Excalidraw/Scripts/Tidy.md"
```

(Run from the repo root.)

**Step 4: Verify in vault**

Open Excalidraw, build a v2 genotype, select an element, run command `obsidian-excalidraw-plugin:Tidy`. Expected: same reflow behavior as v1. (No new lineage logic yet; the script body still handles single genotype only.)

**Step 5: Commit**

```bash
git add scripts/Tidy.md
git commit -m "Rename Tidy Genotype to Tidy and update header"
```

### Task 2.2: Add helper functions inline to Tidy.md

**Files:**
- Modify: `scripts/Tidy.md`

Add the following helpers between the constants block (ends ~line 34) and the "Locate the genotype" section. They use `ea.getViewElements()` style at call sites, but accept `allElements` as a parameter so callers can precompute once and pass down (per `references/mindmap-kb/05-notable-idioms.md` "Precomputed lookup maps").

**Step 1: Insert helper block**

Insert the following just after the `CHROMOSOME_ORDER` constant declaration:

```js
// ---- v2 helpers ----------------------------------------------------------

function getGenotypeIdFromElement(el) {
  return el?.customData?.genotypeId ?? null;
}

function getGenotypeElements(genotypeId, allElements) {
  return allElements.filter(e => e.customData?.genotypeId === genotypeId);
}

function getParentsFromGenotype(genotypeId, allElements) {
  // Returns { maternal, paternal } or null if this is a root.
  // Reads from any element of the genotype (parents is denormalized).
  for (const el of allElements) {
    if (el.customData?.genotypeId === genotypeId && el.customData?.parents) {
      return el.customData.parents;
    }
  }
  return null;
}

function reconstructShorthand(genotypeId, allElements) {
  // Inverse of parseShorthand: produces "w; +/+; TM3/+" from tagged elements.
  const members = getGenotypeElements(genotypeId, allElements);
  const byChrom = {};
  for (const el of members) {
    const cd = el.customData;
    if (cd?.kind !== "genotype-allele") continue;
    if (!byChrom[cd.chromosome]) byChrom[cd.chromosome] = {};
    byChrom[cd.chromosome][cd.side] = el.text;
  }
  const parts = [];
  for (const label of CHROMOSOME_ORDER) {
    const a = byChrom[label];
    if (!a) continue;
    if (a.single !== undefined) parts.push(a.single);
    else if (a.top !== undefined && a.bottom !== undefined) parts.push(`${a.top}/${a.bottom}`);
  }
  return parts.join(" ; ");
}

function walkAncestors(genotypeId, allElements, visited = new Set()) {
  if (visited.has(genotypeId)) return visited;
  visited.add(genotypeId);
  const parents = getParentsFromGenotype(genotypeId, allElements);
  if (!parents) return visited;
  if (parents.maternal) walkAncestors(parents.maternal, allElements, visited);
  if (parents.paternal) walkAncestors(parents.paternal, allElements, visited);
  return visited;
}

function walkDescendants(seedIds, allElements) {
  // Fixpoint expansion: find every genotype whose parents reference any id in the set.
  const result = new Set(seedIds);
  let changed = true;
  while (changed) {
    changed = false;
    const allGenotypeIds = new Set(
      allElements.map(e => e.customData?.genotypeId).filter(Boolean)
    );
    for (const gid of allGenotypeIds) {
      if (result.has(gid)) continue;
      const parents = getParentsFromGenotype(gid, allElements);
      if (!parents) continue;
      if ((parents.maternal && result.has(parents.maternal)) ||
          (parents.paternal && result.has(parents.paternal))) {
        result.add(gid);
        changed = true;
      }
    }
  }
  return result;
}

function collectLineage(genotypeId, allElements) {
  const ancestors = walkAncestors(genotypeId, allElements);
  return walkDescendants(ancestors, allElements);
}

function computeDepths(lineageSet, allElements) {
  const depthCache = new Map();
  function depth(gid, stack = new Set()) {
    if (depthCache.has(gid)) return depthCache.get(gid);
    if (stack.has(gid)) return 0; // cycle guard
    stack.add(gid);
    const parents = getParentsFromGenotype(gid, allElements);
    let d = 0;
    if (parents) {
      const dm = parents.maternal && lineageSet.has(parents.maternal)
        ? depth(parents.maternal, stack) : -1;
      const dp = parents.paternal && lineageSet.has(parents.paternal)
        ? depth(parents.paternal, stack) : -1;
      d = 1 + Math.max(dm, dp);
      if (d === 0) d = 0;
    }
    stack.delete(gid);
    depthCache.set(gid, d);
    return d;
  }
  for (const gid of lineageSet) depth(gid);
  return depthCache;
}
```

**Step 2: Verify helpers in vault**

Build two genotypes side by side (no cross between them yet, since Cross script doesn't exist). For each, run via `obsidian eval`:

```js
ea = ExcalidrawAutomate; ea.setView();
els = ea.targetView.excalidrawAPI.getSceneElements();
// Replace <id> with a genotypeId you can read from any element's customData.
reconstructShorthand("<id>", els)
```

Expected: a string like `"w ; +/+ ; TM3/+"` matching what you built.

You can also smoke-test `collectLineage`:

```js
collectLineage("<id>", els)  // expect a Set containing just that id
```

(Note: the helpers as written are scoped inside the script's IIFE. To verify interactively you'll need to copy them into the eval block. Alternatively, run `Tidy` on the test genotype and confirm it still behaves as v1; that exercises `getGenotypeElements` at minimum.)

**Step 3: Commit**

```bash
git add scripts/Tidy.md
git commit -m "Add v2 lineage helpers to Tidy (no behavior change yet)"
```

### Task 2.3: Make Tidy emit `schemaVersion: 2` and propagate `parents`

**Files:**
- Modify: `scripts/Tidy.md` (the `tag()` helper around the original line 118)

In v1, `tag()` writes `{ schemaVersion: SCHEMA, genotypeId, ...data }`. In v2, if the genotype has a `parents` field, every regenerated element must carry it. If absent, it stays absent (no null literal; the design doc is explicit).

**Step 1: Read existing parents (once, before delete)**

Just after locating `members` (the existing `members` array), read the parents (if any) from any member:

```js
// v2: capture parents before we delete and rebuild
let existingParents = null;
for (const m of members) {
  if (m.customData?.parents) { existingParents = m.customData.parents; break; }
}
```

**Step 2: Update `tag()` to include parents conditionally**

Replace:

```js
function tag(id, data) {
  ea.addAppendUpdateCustomData(id, { schemaVersion: SCHEMA, genotypeId, ...data });
}
```

With:

```js
function tag(id, data) {
  const base = { schemaVersion: SCHEMA, genotypeId, ...data };
  if (existingParents) base.parents = existingParents;
  ea.addAppendUpdateCustomData(id, base);
}
```

**Step 3: Verify**

Run Tidy on a v1 genotype. Verify via `obsidian eval` that elements now have `schemaVersion: 2` and **no** `parents` field (since the v1 genotype was a root).

Then via `obsidian eval`, manually stamp a `parents` field on one element of a test genotype:

```js
ea = ExcalidrawAutomate; ea.setView();
els = ea.targetView.excalidrawAPI.getSceneElements();
target = els.find(e => e.customData?.kind === "genotype-allele");
ea.copyViewElementsToEAforEditing([target]);
ea.addAppendUpdateCustomData(target.id, { parents: { maternal: "fake-id", paternal: null } });
await ea.addElementsToView();
```

Now select that genotype and run `Tidy`. Verify: every element of the regenerated genotype carries `parents: { maternal: "fake-id", paternal: null }`. (The `fake-id` doesn't resolve to anything, which is fine for this test.)

**Step 4: Commit**

```bash
git add scripts/Tidy.md
git commit -m "Propagate parents field through Tidy re-tagging"
```

---

## Phase 3: Cross Genotypes script

**Outcome:** A new `Cross Genotypes` script. User selects two genotypes, runs the script, gets an offspring genotype with `parents` populated, an `x` glyph between parents, a lineage line, and (optionally) a label and selection criterion. Tidy is not yet aware of cross furniture; Phase 4 handles that. So after Cross Genotypes creates the figure, the offspring sits at a default position below the parents (Cross does crude initial positioning) and the user re-runs Tidy from Phase 4 to lay it out properly.

For Phase 3 alone, the "tidy at end" step is omitted; Cross does best-effort positioning and the user lives with it until Phase 4.

### Task 3.1: Create Cross Genotypes scaffold

**Files:**
- Create: `scripts/Cross Genotypes.md`

**Step 1: Write the scaffold**

```js
/*
Cross Genotypes
===============
Creates an offspring genotype of two selected parental genotypes.

Preconditions:
  Selection must include elements of exactly two distinct genotypes.

Behavior:
  - Infers maternal/paternal assignment from sex glyphs (♀/☿ -> maternal,
    ♂ -> paternal). If glyphs are absent or ambiguous, defaults to
    maternal = leftmost parent by centroid x.
  - Prompts for: offspring sex glyph, shorthand, optional label,
    optional selection criterion.
  - Stamps `parents: { maternal, paternal }` on every offspring element.
  - Creates (or reuses) a `cross-glyph` element keyed by the parent pair.
  - Creates a `cross-lineage` element keyed by the offspring's genotypeId.
  - Optionally creates `genotype-label` and `cross-criterion` elements.
  - Best-effort initial positioning. Run `Tidy` afterwards for a clean layout.

customData schema (v2): see docs/plans/2026-05-31-schema-v2-design.md
*/

if (!ea.verifyMinimumPluginVersion || !ea.verifyMinimumPluginVersion("1.9.0")) {
  new Notice("Requires Excalidraw plugin 1.9.0+.");
  return;
}

const SCHEMA = 2;
const FONT_SIZE = 20;
const FONT_FAMILY = 1;
const GLYPH_SIZE = 24;
const CHROMOSOME_GAP = 14;
const FRACTION_PADDING = 4;
const FRACTION_GAP = 2;
const GLYPH_GAP = 12;
const STROKE_WIDTH = 1.5;
const CHROMOSOME_ORDER = ["X", "II", "III", "IV"];
const CROSS_GLYPH_CHAR = "x";
const PARENT_GAP_X = 80;       // gap between left parent and x glyph (and x and right parent)
const LINEAGE_DROP = 60;       // vertical distance from cross-glyph to offspring center

new Notice("Cross Genotypes: not yet implemented (scaffold only).");
return;
```

**Step 2: Symlink into vault**

```bash
ln -s "$PWD/scripts/Cross Genotypes.md" "$FLY_VAULT/Excalidraw/Scripts/Cross Genotypes.md"
```

**Step 3: Verify the script registers**

Run via `obsidian command id="obsidian-excalidraw-plugin:Cross Genotypes"` or via Command Palette. Expected: the "not yet implemented" Notice fires. No errors.

**Step 4: Commit**

```bash
git add scripts/"Cross Genotypes.md"
git commit -m "Add Cross Genotypes scaffold"
```

### Task 3.2: Add parent detection and maternal/paternal inference

**Files:**
- Modify: `scripts/Cross Genotypes.md`

**Step 1: Inline the helpers**

Copy `splitAtDepth0`, `parseShorthand` (from Build Genotype) and `getGenotypeIdFromElement`, `getGenotypeElements`, `reconstructShorthand` (from Tidy) into Cross Genotypes. They are pure functions; duplicate verbatim.

**Step 2: Detect two parents from selection**

Replace the `new Notice("...not yet implemented...")` line with:

```js
const selected = ea.getViewSelectedElements();
const allElements = ea.getViewElements();
const parentIds = [];
for (const el of selected) {
  const gid = getGenotypeIdFromElement(el);
  if (gid && !parentIds.includes(gid)) parentIds.push(gid);
}
if (parentIds.length !== 2) {
  new Notice(`Select elements from exactly two genotypes (found ${parentIds.length}).`);
  return;
}

const parentA = { id: parentIds[0], elements: getGenotypeElements(parentIds[0], allElements) };
const parentB = { id: parentIds[1], elements: getGenotypeElements(parentIds[1], allElements) };

function centroidX(elements) {
  const xs = elements.map(e => e.x + (e.width || 0) / 2);
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function glyphChar(elements) {
  const g = elements.find(e => e.customData?.kind === "genotype-glyph");
  return g?.text ?? null;
}

const aGlyph = glyphChar(parentA.elements);
const bGlyph = glyphChar(parentB.elements);
const FEMALE_GLYPHS = new Set(["♀", "☿"]);
const MALE_GLYPHS = new Set(["♂"]);

let maternalId, paternalId;
if (FEMALE_GLYPHS.has(aGlyph) && MALE_GLYPHS.has(bGlyph)) {
  maternalId = parentA.id; paternalId = parentB.id;
} else if (FEMALE_GLYPHS.has(bGlyph) && MALE_GLYPHS.has(aGlyph)) {
  maternalId = parentB.id; paternalId = parentA.id;
} else if (FEMALE_GLYPHS.has(aGlyph)) {
  maternalId = parentA.id; paternalId = parentB.id;
} else if (FEMALE_GLYPHS.has(bGlyph)) {
  maternalId = parentB.id; paternalId = parentA.id;
} else if (MALE_GLYPHS.has(aGlyph)) {
  paternalId = parentA.id; maternalId = parentB.id;
} else if (MALE_GLYPHS.has(bGlyph)) {
  paternalId = parentB.id; maternalId = parentA.id;
} else {
  // Default: leftmost is maternal.
  if (centroidX(parentA.elements) <= centroidX(parentB.elements)) {
    maternalId = parentA.id; paternalId = parentB.id;
  } else {
    maternalId = parentB.id; paternalId = parentA.id;
  }
}

new Notice(
  `Maternal: ${reconstructShorthand(maternalId, allElements)} | ` +
  `Paternal: ${reconstructShorthand(paternalId, allElements)}`
);
return;
```

**Step 3: Verify**

Build two genotypes (give one a ♀ glyph, the other ♂). Select an element from each, run Cross Genotypes. Expected: a Notice appears showing the correct maternal and paternal shorthand.

Test the no-glyph fallback: build two genotypes with no glyphs, select both, run. Expected: leftmost becomes maternal.

Test the error path: select elements from only one genotype. Expected: error notice.

**Step 4: Commit**

```bash
git add scripts/"Cross Genotypes.md"
git commit -m "Cross: detect parents and infer maternal/paternal"
```

### Task 3.3: Add the offspring prompts and creation

**Files:**
- Modify: `scripts/Cross Genotypes.md`

**Step 1: Replace the temporary Notice + return with the full prompt and creation pipeline**

After the maternal/paternal assignment, instead of the Notice + return, add the prompt flow. The genotype-creation pipeline is structurally identical to Build Genotype, with one addition: stamp `parents: { maternal: maternalId, paternal: paternalId }` on every element via the `tag()` helper.

The detailed pipeline mirrors `scripts/Build Genotype.md` lines 85-243. Key differences:

1. Skip the sex-glyph suggester only if you want to default offspring to no glyph; otherwise prompt as Build does.
2. The shorthand prompt header should include the parent shorthand reconstructed via `reconstructShorthand`. Use `utils.inputPrompt(header, placeholder, defaultValue)` where `header` includes the parent display.
3. After shorthand → also prompt for label (optional, blank to skip) and criterion (optional, blank to skip).
4. The `tag()` helper for offspring elements writes `parents` on every element:
   ```js
   function tag(id, data) {
     ea.addAppendUpdateCustomData(id, {
       schemaVersion: SCHEMA, genotypeId,
       parents: { maternal: maternalId, paternal: paternalId },
       ...data
     });
   }
   ```
5. The center position for the offspring should be midpoint of parent centroids in x, and below the lower parent by `LINEAGE_DROP * 2` in y (a crude default; Tidy in Phase 4 will fix it).

**Step 2: Verify**

Build two parental genotypes. Run Cross Genotypes, fill in shorthand `+/+; +/+; +/+` and skip optional prompts. Expected: a third genotype appears below the parents. Inspect via `obsidian eval`: every offspring element has `parents: { maternal: <id>, paternal: <id> }` matching the actual parents' ids. Cross furniture not yet created (Task 3.4).

**Step 3: Commit**

```bash
git add scripts/"Cross Genotypes.md"
git commit -m "Cross: prompt and create offspring genotype with parents stamped"
```

### Task 3.4: Add cross-glyph and cross-lineage furniture

**Files:**
- Modify: `scripts/Cross Genotypes.md`

**Step 1: Look up existing cross-glyph or create one**

After the offspring is created and positioned, search `allElements` for a `cross-glyph` whose `customData.parents.maternal === maternalId && customData.parents.paternal === paternalId`. If found, reuse. If not, create one:

```js
function findCrossGlyph(maternalId, paternalId, allElements) {
  return allElements.find(e =>
    e.customData?.kind === "cross-glyph" &&
    e.customData?.parents?.maternal === maternalId &&
    e.customData?.parents?.paternal === paternalId
  );
}

let crossGlyphId;
const existingGlyph = findCrossGlyph(maternalId, paternalId, allElements);
if (existingGlyph) {
  crossGlyphId = existingGlyph.id;
} else {
  ea.style.fontSize = GLYPH_SIZE;
  // Position: midpoint between parents in x, midline-aligned with parents in y.
  const maternalElements = getGenotypeElements(maternalId, allElements);
  const paternalElements = getGenotypeElements(paternalId, allElements);
  const midX = (centroidX(maternalElements) + centroidX(paternalElements)) / 2;
  const midY = (
    maternalElements.reduce((s, e) => s + e.y + (e.height || 0) / 2, 0) / maternalElements.length +
    paternalElements.reduce((s, e) => s + e.y + (e.height || 0) / 2, 0) / paternalElements.length
  ) / 2;
  crossGlyphId = ea.addText(midX, midY, CROSS_GLYPH_CHAR);
  ea.addAppendUpdateCustomData(crossGlyphId, {
    schemaVersion: SCHEMA,
    kind: "cross-glyph",
    parents: { maternal: maternalId, paternal: paternalId },
  });
  ea.style.fontSize = FONT_SIZE;
}
```

**Step 2: Create the lineage line**

A simple vertical line from the cross-glyph downward to the offspring's vertical center:

```js
const crossGlyphEl = ea.getElement(crossGlyphId);
const glyphBottomX = crossGlyphEl.x + crossGlyphEl.width / 2;
const glyphBottomY = crossGlyphEl.y + crossGlyphEl.height;
const offspringCenterY = midlineY;  // from the offspring layout pass above

const lineageId = ea.addLine([
  [glyphBottomX, glyphBottomY],
  [glyphBottomX, offspringCenterY],
]);
ea.addAppendUpdateCustomData(lineageId, {
  schemaVersion: SCHEMA,
  kind: "cross-lineage",
  childGenotypeId: genotypeId,
});
```

**Step 3: Verify**

Run Cross Genotypes with two parents. Inspect via `obsidian eval`:

```js
els = ea.targetView.excalidrawAPI.getSceneElements();
els.filter(e => e.customData?.kind === "cross-glyph")
   .map(e => ({ x: e.x, y: e.y, parents: e.customData.parents }))
els.filter(e => e.customData?.kind === "cross-lineage")
   .map(e => ({ childGenotypeId: e.customData.childGenotypeId }))
```

Expected: one cross-glyph between the parents with correct `parents` field, one cross-lineage with `childGenotypeId` matching the offspring.

Run Cross Genotypes a second time with the same two parents to create a sibling offspring. Expected: NO second cross-glyph appears (reused). A second cross-lineage element is created, terminating at the new offspring.

**Step 4: Commit**

```bash
git add scripts/"Cross Genotypes.md"
git commit -m "Cross: create cross-glyph and cross-lineage furniture"
```

### Task 3.5: Add optional label and criterion

**Files:**
- Modify: `scripts/Cross Genotypes.md`

**Step 1: After shorthand prompt, add label prompt**

```js
const labelText = await utils.inputPrompt(
  "Label (optional)",
  "e.g. M1.1, M1.2 (blank to skip)",
  ""
);
```

**Step 2: After label, add criterion prompt**

```js
const criterionText = await utils.inputPrompt(
  "Selection criterion (optional)",
  "e.g. non-Tb, Sb/+ (blank to skip)",
  ""
);
```

**Step 3: Create label element if labelText is non-empty**

After the offspring elements are positioned, before grouping:

```js
let labelId = null;
if (labelText && labelText.trim()) {
  // Place above the offspring genotype, centered on x.
  // offspringTop = midlineY - slotMaxHeight/2; place above with small gap.
  const LABEL_GAP = 8;
  labelId = ea.addText(0, 0, labelText.trim());
  ea.addAppendUpdateCustomData(labelId, {
    schemaVersion: SCHEMA,
    kind: "genotype-label",
    genotypeId,
    parents: { maternal: maternalId, paternal: paternalId },
    text: labelText.trim(),
  });
  const labelEl = ea.getElement(labelId);
  labelEl.x = centerX - labelEl.width / 2;
  labelEl.y = midlineY - slotMaxHeight / 2 - LABEL_GAP - labelEl.height;
}
```

**Step 4: Create criterion element if criterionText is non-empty**

After the lineage line is created:

```js
let criterionId = null;
if (criterionText && criterionText.trim()) {
  const lineMidY = (glyphBottomY + offspringCenterY) / 2;
  const CRIT_OFFSET_X = 12;
  criterionId = ea.addText(0, 0, criterionText.trim());
  ea.addAppendUpdateCustomData(criterionId, {
    schemaVersion: SCHEMA,
    kind: "cross-criterion",
    childGenotypeId: genotypeId,
    text: criterionText.trim(),
  });
  const critEl = ea.getElement(criterionId);
  critEl.x = glyphBottomX + CRIT_OFFSET_X;
  critEl.y = lineMidY - critEl.height / 2;
}
```

**Step 5: Group offspring elements together (excluding cross furniture)**

The label is part of the offspring genotype group. The cross-glyph and lineage-line are *not* part of either parent's or offspring's group (they're cross furniture, shared). Add `labelId` to the offspring group if present. Do not add `crossGlyphId`, `lineageId`, or `criterionId` to any genotype group.

(Whether cross furniture should be in its own group is a Tidy-level concern; for now they're ungrouped.)

**Step 6: Verify**

Run Cross Genotypes with label "M1.1" and criterion "non-Tb". Inspect via `obsidian eval`:

```js
els.filter(e => e.customData?.kind === "genotype-label").map(e => e.text)
els.filter(e => e.customData?.kind === "cross-criterion").map(e => e.text)
```

Expected: `["M1.1"]` and `["non-Tb"]`.

Screenshot the figure and confirm:
- Label appears above the offspring genotype.
- Criterion appears to the right of the lineage line, vertically near the midpoint.

**Step 7: Commit**

```bash
git add scripts/"Cross Genotypes.md"
git commit -m "Cross: optional label and selection criterion"
```

---

## Phase 4: Tidy renders lineage and cross furniture

**Outcome:** Tidy collects every element in the connected lineage of the selected element: all genotypes and their members, all cross-glyphs whose parent pair is within the lineage, all cross-lineages and cross-criteria whose `childGenotypeId` is within the lineage. Lays out genotypes by generation depth, with horizontal ordering per generation determined by a barycenter sweep over parent x-positions. Regenerates cross furniture from the offspring's `parents` field.

This is the biggest phase. Internal sub-tasks:

### Task 4.1: Make Tidy collect the connected lineage

**Files:**
- Modify: `scripts/Tidy.md`

**Step 1: Replace single-genotype handling with lineage collection**

Currently Tidy locates one `genotypeId` and processes its members. Change this to:

1. Locate the seed `genotypeId` from selection (existing logic).
2. Call `collectLineage(seedId, allElements)` to get the full lineage set.
3. For each genotypeId in the set, process it (read structure, delete old elements, schedule re-creation).
4. Also collect cross-glyphs (where `parents.maternal` and `parents.paternal` are both in the lineage set), cross-lineages (where `childGenotypeId` is in the set), and cross-criteria (same), to delete and regenerate.

**Step 2: For each genotype, re-tag with its preserved `parents` field**

The existing `tag()` helper uses module-scope `existingParents`. With multiple genotypes in flight, this needs to be per-genotype. Either:
- Refactor `tag()` to take `parents` as a parameter
- Or build per-genotype tag closures inside the loop

The cleaner shape is: extract the per-genotype reflow into a function `reflowGenotype(genotypeId, allElements)` returning `{ elementIds, slotMaxHeight, totalWidth, centerX, centerY }`, with `parents` captured in the closure.

**Step 3: Verify**

Use a manually-stamped lineage (from Phase 2 testing): two genotypes A and B, with A's elements carrying `parents: { maternal: B.id, paternal: null }`. (This is a contrived lineage but exercises the code path before Cross Genotypes exists in full.)

Actually, by this phase, Cross Genotypes does exist. Use it: build two parents, run Cross to make an offspring, then run Tidy. Expected after Tidy: the lineage's three genotypes are still in approximately correct positions, no errors. Layout quality is not yet good (next task).

**Step 4: Commit**

```bash
git add scripts/Tidy.md
git commit -m "Tidy: collect connected lineage and reflow per genotype"
```

### Task 4.2: Add DAG-aware layered layout

**Files:**
- Modify: `scripts/Tidy.md`

**Step 1: Compute depths**

After collecting the lineage, call `computeDepths(lineageSet, allElements)`. Bucket genotypes by depth.

**Step 2: Within each bucket, order by parent barycenter**

For depth 0 (roots), order by the original x-position (preserve existing horizontal order).

For depth > 0, compute the barycenter of each genotype's parent positions (using parents' x in the depth-below). Sort by barycenter ascending.

A single pass top-down is enough for small graphs; iterate 2-3 times if you observe crossings.

**Step 3: Assign coordinates**

Define constants:

```js
const GENERATION_GAP_Y = 140;   // vertical between generations
const SIBLING_GAP_X = 60;       // horizontal between same-depth genotypes
```

For each depth bucket, lay genotypes left-to-right with `SIBLING_GAP_X` between them. Use the precomputed totalWidth from each genotype's reflow. Center the whole bucket on x=0 (or some chosen origin) for symmetry.

Y for each bucket = depth * GENERATION_GAP_Y, offset to keep the figure on screen (e.g., based on the original bbox center of the seed genotype).

**Step 4: Verify**

Build two parents, cross them to create an F1, cross F1 with a third parent to create F2. Run Tidy. Expected: 4 genotypes laid out in 3 rows (parents on row 0, F1 on row 1, F2 on row 2). Horizontal positions reasonable, no overlaps.

**Step 5: Commit**

```bash
git add scripts/Tidy.md
git commit -m "Tidy: DAG-aware layered layout by generation depth"
```

### Task 4.3: Render cross furniture from offspring's `parents`

**Files:**
- Modify: `scripts/Tidy.md`

**Step 1: Group offspring by parent pair**

After laying out genotypes, iterate the lineage. For each non-root offspring, group by `(maternalId, paternalId)`. Each unique pair gets one `cross-glyph` and N `cross-lineage` elements (one per child).

**Step 2: Position the cross-glyph between parents**

Use the same midpoint logic as Cross Genotypes: midpoint x of the two parents' centroids, depth row halfway between parent depth and child depth (or `parent_y + GENERATION_GAP_Y / 2`).

**Step 3: Draw lineage lines**

From cross-glyph bottom to each child's top-center. If multiple children share a cross, you can either draw N separate lines (simpler) or a tree with trunk + branches (prettier). Start with N separate lines for simplicity.

**Step 4: Preserve and re-position cross-criterion elements**

For each `cross-lineage` (identified by `childGenotypeId`), check if a `cross-criterion` exists for the same `childGenotypeId`. If yes, reposition it next to the new lineage line (offset right of midpoint). Honor manual text edits (read the text from the existing element before delete-and-recreate, or move-in-place; moving-in-place is easier and preserves user formatting).

**Step 5: Delete old furniture before creating new**

To stay consistent with the "regenerate from data" model, delete all old `cross-glyph`, `cross-lineage` elements at the start of the cross-rendering pass, then create fresh ones. For `cross-criterion`, prefer move-in-place to preserve any manual edits.

**Step 6: Verify**

Build a small lineage (2 parents → F1 → F2 with a second stock as F2 paternal). Add labels and criteria. Run Tidy. Expected:
- All genotypes positioned in correct generations.
- Cross-glyphs between parent pairs, vertically between depths.
- Lineage lines from each cross-glyph to its offspring(s).
- Criteria preserved and repositioned next to their lines.

Move a genotype manually, then run Tidy again. Expected: layout snaps back to canonical positions; criterion text preserved.

**Step 7: Commit**

```bash
git add scripts/Tidy.md
git commit -m "Tidy: render cross furniture from offspring parents field"
```

### Task 4.4: Make Cross Genotypes trigger Tidy at end

**Files:**
- Modify: `scripts/Cross Genotypes.md`

**Step 1: After creation, invoke Tidy**

The simplest path is to invoke the Tidy command via the plugin command API. Inside Cross Genotypes, after `await ea.addElementsToView(...)`:

```js
// Auto-tidy the new lineage so user sees a clean layout.
// Select an element of the offspring so Tidy's selection-based dispatch picks it up.
ea.targetView?.excalidrawAPI?.updateScene({
  appState: { selectedElementIds: { [<some-offspring-allele-id>]: true } }
});
await app.commands.executeCommandById("obsidian-excalidraw-plugin:Tidy");
```

If invoking another script from within a script is too fragile (depends on plugin internals), an alternative is to factor the Tidy logic into a function the user copy-pastes into Cross Genotypes. Defer that decision: try the command invocation first; if it fails, fall back to crude Cross-only positioning and require the user to run Tidy manually.

**Step 2: Verify**

Run Cross Genotypes end-to-end. Expected: the new offspring + furniture appear, and the figure is immediately tidied.

If command invocation fails or behaves badly, document the limitation in the script's header comment and skip the auto-tidy step.

**Step 3: Commit**

```bash
git add scripts/"Cross Genotypes.md"
git commit -m "Cross: auto-tidy lineage after creation"
```

---

## Wrap-up

After Phase 4, the v2 schema is fully implemented. Merge `schema-v2` into `main`:

```bash
git checkout main
git merge --no-ff schema-v2 -m "Merge schema-v2: cross structure, lineage, labels, criteria"
```

Run a final end-to-end smoke test on the merged branch:

1. Build two parental genotypes.
2. Run Cross Genotypes with a label and criterion.
3. Run Cross Genotypes again with the F1 and a third stock to create F2.
4. Manually drag one genotype off its tidy position.
5. Run Tidy.
6. Screenshot. The figure should be a clean two-generation pedigree.

Update `README.md` to reflect the v2 schema: rename "Tidy Genotype" reference, add Cross Genotypes to the scripts table, move v2 items out of the Roadmap section, and add a "Cross structure" section under "Data model" explaining `parents`, cross furniture, labels, criteria.

Commit the README update separately:

```bash
git add README.md
git commit -m "Update README for schema v2"
```

---

## Out of scope (do not implement; defer to follow-up plans)

- **Cross resolver:** Mendelian math to compute offspring genotype from parents.
- **Stock library lookup:** suggester for parent genotypes from Fly Stocks frontmatter.
- **Link Parents script:** retrofit existing v1 genotypes into a lineage by selecting an offspring and two parents.
- **Swap Parents action:** swap maternal/paternal without retyping.
- **Auto-label derivation:** generate "M1.1, M1.2" automatically from parent label.
- **Multi-line lineage trees with shared trunk + branches:** Task 4.3 starts with N separate lines per cross. A tree-shaped lineage diagram is a follow-up.

Each of these is its own brainstorm + plan cycle.

---

## Plan integrity check

If any task's verification step fails:
1. Stop. Do not proceed to the next task.
2. Diagnose with `/excalidraw-scripting` (it has debugging recipes).
3. If the issue is in the plan (wrong expected behavior, missing step), update the plan before retrying.
4. Recommit fixes against the same task name.
