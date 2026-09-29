# Backcross (parent crossed on more than one row) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tidy draws a copy of a genotype that is a parent in crosses on more than one row, so a backcross (or a stock reused in a later generation) keeps every cross's parents side by side. Ship it together with the duplicate-genotype fix already in the working tree.

**Architecture:** One new step in `scripts/Tidy.md`, `splitMultiRowParents(lineageSet)`, runs at the start of `tidyLineage` (after `splitDuplicateGenotypes`, before layout). It finds genotypes whose crosses sit on different rows, makes one founder copy for each of their crosses below the highest row, and rewires that cross's x glyph and offspring `parents` to its copy. The existing layout then places each copy beside its partner. Cross Genotypes and Cross Mode get the behavior through the Tidy they already run.

**Tech Stack:** Excalidraw Script Engine scripts (JavaScript in `scripts/*.md`), ExcalidrawAutomate (`ea`), Obsidian-driven tests (`tests/lib.sh`, `tests/harness.js`, `tests/checks.js`, `tests/scenarios.js`).

**Spec:** `docs/plans/2026-09-29-backcross-design.md`

## Global Constraints

- Read `CLAUDE.md` in the repo first. Obsidian must be running with the vault at `FLY_VAULT` (`~/.config/fly-genetics/env`); the harness reloads scripts itself.
- Generic public alleles only in fixtures and tests (w, Y, Sp, CyO, Gla, Bc, yw, MKRS, TM6B, Sb, TM3, y). No lab-specific allele or research terms anywhere in the repo (it is published).
- Never use em dashes in code comments, docs, or CHANGELOG text.
- A copy is an independent founder: fresh `genotypeId` (`crypto.randomUUID()`), its own group, no `parents`, no link to the original.
- Do not re-run the full suite repeatedly (it is slow). Run the targeted test while iterating; run `tests/run-all.sh` once per task where a step says so.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Commit the duplicate-genotype fix

The working tree holds a finished, tested fix: a genotype copied in Excalidraw (Cmd+D, copy/paste, alt-drag) becomes its own founder (`splitDuplicateGenotypes` in seven scripts), with `tests/duplicate-genotype.sh`, the `backcross` scenario, and rebuilt fixtures.

**Files:**
- Commit as is: `scripts/Break Cross.md`, `scripts/Cross Genotypes.md`, `scripts/Cross Mode.md`, `scripts/Genotype.md`, `scripts/Select Below.md`, `scripts/Select Lineage.md`, `scripts/Tidy.md`, `tests/scenarios.js`, `tests/duplicate-genotype.sh`, `tests/fixtures/*.json`

- [ ] **Step 1: Run the duplicate test**

Run: `bash tests/duplicate-genotype.sh`
Expected: 32 `PASS` lines, no `FAIL`, exit 0.

- [ ] **Step 2: Commit**

```bash
git add scripts tests
git commit -m "A duplicated genotype (Cmd+D, copy/paste, alt-drag) becomes its own founder

Copies kept the original's genotypeId, so Tidy redrew both as one genotype,
deleting a copy and pulling the survivor down a row.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Tidy copies a parent crossed on more than one row

**Files:**
- Modify: `tests/scenarios.js` (two new scenarios after `'backcross'`)
- Create: `tests/tidy-backcross.sh`
- Modify: `scripts/Tidy.md` (`computeDepths` around lines 230-281; new function after it; call site at the top of `tidyLineage`, around line 405)
- Fixtures `tests/fixtures/backcross-sibs.json` and `tests/fixtures/reused-stock.json` are created by the first test run; other fixtures rebuild because Tidy changed. Commit them all.

**Interfaces:**
- Consumes: the harness (`T.fixture`, `T.cross`, `T.setup`, `T.tidyAll`, `T.unmoved`, `T.pass`, `T.check`) and checks (`F.els`, `F.live`, `F.layout`, `F.arrows`, `F.overlaps`, `F.foreignX`, `F.xOverlap`, `F.cut`); `T.cross(name, m, f, auto)` selects genotypes by the names in `window.__t`, so a copy is crossed by registering it there (`window.__t.P2copy = gid`).
- Produces: `topDownDepths(lineageSet, allElements) -> Map<gid, number>` (pass 1 of `computeDepths`, extracted); `splitMultiRowParents(lineageSet: Set<gid>) -> Promise<gid[]>` (the copies' genotype ids; empty if nothing was split).

- [ ] **Step 1: Add the fixture scenarios**

In `tests/scenarios.js`, directly after the `'backcross'` entry, add:

```js
    // P1 x P2 -> A, C (both female); both are later crossed back to P2.
    'backcross-sibs': async T => {
      await founders(T);
      await T.cross('A', 'P1', 'P2', { offspringGlyph: '♀', pick: { X: 0, II: 0, III: 0 }, labelText: 'A' });
      await T.cross('C', 'P1', 'P2', { offspringGlyph: '♀', pick: { X: 1, II: 1, III: 0 }, labelText: 'C' });
    },
    // P1 x P2 -> A, B (female); A x P3 -> C; stock S, crossed later to B
    // (row 1) and to C (row 2).
    'reused-stock': async T => {
      await founders(T);
      await T.cross('A', 'P1', 'P2', { offspringGlyph: '♀', pick: { X: 0, II: 0, III: 0 }, labelText: 'A' });
      await T.cross('B', 'P1', 'P2', { offspringGlyph: '♀', pick: { X: 1, II: 1, III: 0 }, labelText: 'B' });
      await T.genotype('P3', { glyph: '♂', X: { top: 'yw', bottom: 'Y' }, II: { top: '', bottom: '' }, III: { top: 'MKRS', bottom: 'TM6B' } });
      await T.cross('C', 'A', 'P3', { offspringGlyph: '♀', pick: { X: 0, II: 0, III: 0 }, labelText: 'C' });
      await T.genotype('S', { glyph: '♂', X: { top: 'y', bottom: 'Y' }, II: { top: '', bottom: '' }, III: { top: 'Sb', bottom: 'TM3' } });
    },
```

- [ ] **Step 2: Write the failing test**

Create `tests/tidy-backcross.sh` (then `chmod +x tests/tidy-backcross.sh`):

```bash
#!/usr/bin/env bash
# Regression test: a genotype that is a parent in crosses on two rows gets a
# copy for the lower row (docs/plans/2026-09-29-backcross-design.md).
#   1. Backcross (fixture backcross: P1 x P2 -> A): cross A with the original
#      P2 -> B. P2 stays on P1's row, drawn once; one copy of P2, a founder,
#      sits on A's row and is B's father; A is still P1 x P2's.
#   2. Existing drawing: the scene of 1 with the copy folded back into P2 (B's
#      parents and the x rewired to P2, the copy deleted), as scenes were drawn
#      before this fix. One Tidy gives the result of 1.
#   3. Two sisters (fixture backcross-sibs: P1 x P2 -> A, C): A x P2 -> B, then
#      C x P2 -> D. Two copies of P2 on the F1 row, one per cross.
#   4. Reused stock (fixture reused-stock): B x S -> D (row 1), then
#      C x S -> E (row 2). S stays beside B and is D's father; one copy of S
#      sits on C's row and is E's father.
#   5. Shared by choice (fixture backcross-sibs): A x P2 -> B, then C x B's
#      copy of P2 -> D. No new copy: B and D share the one copy.
# Each case also checks the usual layout invariants and that a second Tidy
# moves nothing. Prints PASS/FAIL per check; exit 0 only if all pass.
source "$(dirname "$0")/lib.sh"
fly_test <<'JS'
const ea = F.view();
const frames = () => F.live().filter(e => e.customData?.kind === 'genotype-frame');
const alleles = gid => F.live().filter(e => e.customData?.genotypeId === gid && e.customData.kind === 'genotype-allele').map(e => e.originalText ?? e.text).sort().join(',');
const bottom = gid => { const f = frames().find(e => e.customData.genotypeId === gid); return f ? Math.round(f.y + f.height) : null; };
const parentsOf = n => F.els(n).find(e => e.customData.parents)?.customData.parents;
const has = (p, gid) => !!p && (p.maternal === gid || p.paternal === gid);
// Female offspring of m x f, through Cross Genotypes (which runs Tidy).
const cross = (name, m, f) => T.cross(name, m, f, { offspringGlyph: '♀', pick: { X: 0, II: 0, III: 0 }, labelText: name });
// Genotype ids, other than n's, drawn with alleles `als`.
const copiesOf = (n, als) => [...new Set(frames().map(f => f.customData.genotypeId).filter(g => g !== window.__t[n] && alleles(g) === als))];

// n is drawn once, on home's row, and is still a parent of every genotype in
// keep. It has one copy per group in `groups` (arrays of offspring names):
// each a founder on row's row, the parent of every offspring in its group,
// and different groups have different copies.
function checkCopies(how, n, als, home, row, groups, keep) {
  const cs = copiesOf(n, als), t = window.__t;
  const drawn = F.els(n, 'genotype-frame').length;
  T.pass(drawn === 1 && cs.length === groups.length, how + ': ' + n + ' drawn once, ' + groups.length + ' copies', how + ': ' + n + ' drawn ' + drawn + ' time(s), ' + cs.length + ' copies');
  T.pass(bottom(t[n]) === bottom(t[home]), how + ': ' + n + ' stays on ' + home + '\'s row', how + ': ' + n + ' is not on ' + home + '\'s row');
  T.pass(cs.length > 0 && cs.every(c => bottom(c) === bottom(t[row])), how + ': the copies are on ' + row + '\'s row', how + ': a copy is missing from ' + row + '\'s row');
  T.pass(cs.length > 0 && !F.live().some(e => cs.includes(e.customData?.genotypeId) && e.customData.parents), how + ': the copies are founders', how + ': a copy has parents');
  const from = k => cs.find(c => has(parentsOf(k), c));
  const split = groups.filter(g => !from(g[0]) || g.some(k => from(k) !== from(g[0])));
  const distinct = new Set(groups.map(g => from(g[0]))).size === groups.length;
  const desc = groups.map(g => g.join('+')).join(', ');
  T.pass(!split.length && distinct, how + ': ' + desc + ' from ' + (groups.length === 1 ? 'the copy' : 'one copy each'), how + ': wrong copies for ' + desc);
  const lost = keep.filter(k => !has(parentsOf(k), t[n]));
  T.pass(!lost.length, how + ': ' + keep.join(', ') + ' still from ' + n, how + ': no longer from ' + n + ': ' + lost.join(', '));
  return cs;
}
async function invariants(how) {
  T.out(how + ' ' + F.layout());
  T.check(F.arrows({ pos: true }));
  T.check(F.overlaps());
  T.check(F.foreignX());
  T.check(F.xOverlap());
  T.check(F.cut({ diag: true }));
  await T.unmoved(how + ': second Tidy', T.tidyAll);
}
// Deletes genotype copyGid and points every `parents` that names it at into.
async function foldCopy(copyGid, into) {
  const els = F.live().filter(e => e.customData?.genotypeId === copyGid);
  const refs = F.live().filter(e => has(e.customData?.parents, copyGid));
  ea.clear();
  ea.copyViewElementsToEAforEditing([...els, ...refs]);
  for (const e of els) ea.getElement(e.id).isDeleted = true;
  for (const e of refs) {
    const p = { ...e.customData.parents };
    for (const k of ['maternal', 'paternal']) if (p[k] === copyGid) p[k] = into;
    ea.getElement(e.id).customData = { ...e.customData, parents: p };
  }
  await ea.addElementsToView(false, false, true);
  ea.clear();
}

// ---- 1. Backcross A x P2 ---------------------------------------------------
await T.fixture('backcross');
T.setup(['P1', 'P2', 'A']);
const p2 = alleles(window.__t.P2);
await cross('B', 'A', 'P2');
checkCopies('backcross', 'P2', p2, 'P1', 'A', [['B']], ['A']);
await invariants('backcross');

// ---- 2. A drawing that already has the conflict -----------------------------
for (const c of copiesOf('P2', p2)) await foldCopy(c, window.__t.P2);
T.pass(!copiesOf('P2', p2).length && has(parentsOf('B'), window.__t.P2),
  'existing: set up (B is A x P2, no copy)', 'existing: setup failed');
await T.tidyAll();
checkCopies('existing', 'P2', p2, 'P1', 'A', [['B']], ['A']);
await invariants('existing');

// ---- 3. Two sisters crossed back to P2: one copy each ------------------------
await T.fixture('backcross-sibs');
T.setup(['P1', 'P2', 'A', 'C']);
await cross('B', 'A', 'P2');
await cross('D', 'C', 'P2');
checkCopies('sisters', 'P2', p2, 'P1', 'A', [['B'], ['D']], ['A', 'C']);
await invariants('sisters');

// ---- 4. A stock crossed on row 1 and on row 2 -------------------------------
await T.fixture('reused-stock');
T.setup(['P1', 'P2', 'A', 'B', 'P3', 'C', 'S']);
const s = alleles(window.__t.S);
await cross('D', 'B', 'S');
await cross('E', 'C', 'S');
checkCopies('reused', 'S', s, 'B', 'C', [['E']], ['D']);
await invariants('reused');

// ---- 5. The second sister crossed with the first one's copy --------------------
await T.fixture('backcross-sibs');
T.setup(['P1', 'P2', 'A', 'C']);
await cross('B', 'A', 'P2');
window.__t.P2copy = copiesOf('P2', p2)[0];
if (!window.__t.P2copy) throw new Error('A x P2 made no copy of P2');
await cross('D', 'C', 'P2copy');
checkCopies('shared', 'P2', p2, 'P1', 'A', [['B', 'D']], ['A', 'C']);
await invariants('shared');
JS
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bash tests/tidy-backcross.sh`
Expected: the new fixtures build (`built fixture backcross-sibs`, `built fixture reused-stock`), then `FAIL` lines including `backcross: P2 drawn once, ... 0 copies` and `backcross: P2 is not on P1's row`; exit 1. If instead the run stops with `FAIL: ...` from a thrown error (a scenario or setup problem), fix the test first: the failures must be the missing feature, not the harness.

- [ ] **Step 4: Extract `topDownDepths` from `computeDepths`**

In `scripts/Tidy.md`, replace the start of `computeDepths` (from `function computeDepths(lineageSet, allElements) {` through `for (const gid of lineageSet) td(gid);`) with:

```js
// Top-down depth of each genotype in `lineageSet`: the longest path from a
// root of the lineage (roots are 0).
function topDownDepths(lineageSet, allElements) {
  const topDown = new Map();
  function td(gid, stack = new Set()) {
    if (topDown.has(gid)) return topDown.get(gid);
    if (stack.has(gid)) return 0; // cycle guard
    stack.add(gid);
    const parents = getParentsFromGenotype(gid, allElements);
    let d = 0;
    if (parents) {
      const dm = parents.maternal && lineageSet.has(parents.maternal)
        ? td(parents.maternal, stack) : -1;
      const dp = parents.paternal && lineageSet.has(parents.paternal)
        ? td(parents.paternal, stack) : -1;
      d = 1 + Math.max(dm, dp);
      if (d < 0) d = 0;
    }
    stack.delete(gid);
    topDown.set(gid, d);
    return d;
  }
  for (const gid of lineageSet) td(gid);
  return topDown;
}

function computeDepths(lineageSet, allElements) {
  // Two-pass depth:
  //   Pass 1: top-down depth = longest path from any root in the lineage.
  //   Pass 2: a genotype's ROW = max(own top-down, max top-down of any
  //           co-parent). A co-parent is the OTHER parent in a cross where
  //           this genotype is also a parent.
  //
  // Why two passes: standard fly-cross notation places a genotype at the
  // row where it's USED, not where it originated. A stock used at the F2
  // generation should sit alongside F1 in the figure, even though it's a
  // root genotype (top-down depth 0). Pure top-down would shove it back
  // to row 0 with the founding stocks, where the cross-glyph collides
  // with it.
  const topDown = topDownDepths(lineageSet, allElements);
```

Keep the rest of `computeDepths` (pass 2 and `return result;`) unchanged.

- [ ] **Step 5: Add `splitMultiRowParents`**

Directly after the closing `}` of `computeDepths`, add:

```js
// ---- Parents crossed on more than one row -----------------------------------
// A genotype that is a parent in crosses on two rows can be drawn on only one
// of them (a backcross to a parent, a stock reused in a later generation). It
// keeps its crosses on the highest of those rows; each of its other crosses
// gets its own copy of it, a founder with a fresh genotypeId and no
// `parents`, and uses the copy: that cross's x glyph's and offspring's
// `parents` are rewired. (Copies are unlinked, so two crosses never share
// one; to share, cross with an existing copy.) A cross's row is the larger top-down depth of its two parents;
// only crosses with an offspring and both parents in `lineageSet` count.
// Commits (one scene update) only if it split something; returns the copies'
// genotype ids. See docs/plans/2026-09-29-backcross-design.md.
async function splitMultiRowParents(lineageSet) {
  const all = ea.getViewElements().filter(el => !el.isDeleted);
  const topDown = topDownDepths(lineageSet, all);
  const crosses = new Map();   // "maternal|paternal" -> { parents, row }
  for (const el of all) {
    const p = el.customData?.parents;
    if (!el.customData?.genotypeId || !p?.maternal || !p?.paternal) continue;
    if (!lineageSet.has(p.maternal) || !lineageSet.has(p.paternal)) continue;
    const key = p.maternal + "|" + p.paternal;
    if (!crosses.has(key)) {
      crosses.set(key, { parents: p, row: Math.max(topDown.get(p.maternal) ?? 0, topDown.get(p.paternal) ?? 0) });
    }
  }
  const swap = new Map();     // cross key -> { maternal?, paternal? }: the copy that replaces that parent
  const copyOf = new Map();   // copy genotypeId -> original genotypeId
  for (const gid of lineageSet) {
    const mine = [...crosses].filter(([, c]) => c.parents.maternal === gid || c.parents.paternal === gid);
    const top = Math.min(...mine.map(([, c]) => c.row));
    for (const [key, c] of mine) {
      if (c.row === top) continue;
      const copy = crypto.randomUUID();
      copyOf.set(copy, gid);
      const s = swap.get(key) ?? swap.set(key, {}).get(key);
      if (c.parents.maternal === gid) s.maternal = copy;
      if (c.parents.paternal === gid) s.paternal = copy;
    }
  }
  if (!copyOf.size) return [];

  ea.clear();
  // Each copy: the original's alleles, fractions, separators, glyph and label
  // with new element ids in one new group. Frames and label boxes are
  // regenerated by Tidy.
  const copied = new Set(["genotype-allele", "genotype-fraction", "genotype-separator", "genotype-glyph", "genotype-label"]);
  for (const [copy, gid] of copyOf) {
    const group = crypto.randomUUID();
    for (const el of all) {
      if (el.customData?.genotypeId !== gid || !copied.has(el.customData.kind)) continue;
      const { parents, ...rest } = el.customData;
      const c = structuredClone(el);
      c.id = crypto.randomUUID();
      c.groupIds = [group];
      c.boundElements = [];
      c.containerId = null;
      c.customData = { ...rest, genotypeId: copy };
      ea.elementsDict[c.id] = c;
    }
  }
  // Rewire each moved cross: its x glyph and every element of its offspring.
  for (const el of all) {
    const p = el.customData?.parents;
    const s = p && swap.get(p.maternal + "|" + p.paternal);
    if (!s || !(el.customData.genotypeId || el.customData.kind === "cross-glyph")) continue;
    ea.copyViewElementsToEAforEditing([el]);
    ea.getElement(el.id).customData = {
      ...el.customData,
      parents: { maternal: s.maternal ?? p.maternal, paternal: s.paternal ?? p.paternal },
    };
  }
  await ea.addElementsToView(false, false, true);
  ea.clear();
  return [...copyOf.keys()];
}
```

- [ ] **Step 6: Call it at the start of `tidyLineage`**

In `scripts/Tidy.md`, replace:

```js
async function tidyLineage(seedGenotypeId, avoid, subset = null) {
ea.clear();
const below = !!subset;   // subset mode
```

with:

```js
async function tidyLineage(seedGenotypeId, avoid, subset = null) {
ea.clear();
const below = !!subset;   // subset mode

// A parent crossed on more than one row gets a copy per extra row first; a
// subset takes its copies along.
const copies = await splitMultiRowParents(below ? new Set(subset) : collectLineage(seedGenotypeId, ea.getViewElements()));
if (below) for (const g of copies) subset.add(g);
ea.clear();
```

(`subset` is the `Set` passed by the callers at the end of the file, e.g. `tidyLineage(selectedSeedId, null, selectedGids)`.)

- [ ] **Step 7: Run the test to verify it passes**

Run: `bash tests/tidy-backcross.sh`
Expected: every line `PASS` (or a `layout:` line), exit 0. `F.layout()` lists only named genotypes, so the backcross line reads `backcross layout: P1 P2 | A | B` (the unnamed copy sits beside A). If a check fails, fix `scripts/Tidy.md`, not the test; if you believe a check is wrong, stop and report why.

- [ ] **Step 8: Run the duplicate test and the full suite once**

Run: `bash tests/duplicate-genotype.sh && bash tests/run-all.sh`
Expected: `duplicate-genotype.sh` all `PASS`; `run-all.sh` prints `PASS` for every test (including `tidy-backcross` and `duplicate-genotype`) and exits 0. Fixtures that hash Tidy rebuild on their first use; that is expected.

- [ ] **Step 9: Commit**

```bash
git add scripts/Tidy.md tests/scenarios.js tests/tidy-backcross.sh tests/fixtures
git commit -m "Tidy draws a copy of a parent crossed on more than one row (backcross)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Docs, changelog, release

**Files:**
- Modify: `README.md` (Tidy row of the script table, around line 40; test list, around line 84)
- Modify: `CHANGELOG.md` (new top section)
- Modify: `VERSION`
- Rebuild: `dist/` (via `uv run installer/build.py`)

- [ ] **Step 1: README**

Append to the end of the `Tidy` row's description (line starting `| \`Tidy\` |`), before the closing ` |`:

```
 A genotype crossed on two rows (a backcross to a parent, or a stock used again in a later generation) is drawn again beside its later mate, as an independent copy.
```

In the test list (after the `tests/tidy-sibling-cross-overlap.sh ...` line), add:

```
- `tests/duplicate-genotype.sh`: a genotype copied with Cmd+D, copy/paste or alt-drag becomes its own genotype.
- `tests/tidy-backcross.sh`: a parent crossed on two rows gets a copy for each lower cross (backcross, existing drawings, two sisters, reused stock, sharing a copy on purpose).
```

- [ ] **Step 2: CHANGELOG and VERSION**

Set `VERSION` to the release date per `CLAUDE.md` (today, with the next `.N` suffix after the latest `## ` section if one already exists for today; e.g. `2026.9.29.5`). Add at the top of `CHANGELOG.md`, under the intro paragraph:

```markdown
## <version>

- Backcrosses: crossing an offspring with its own parent (or crossing a stock again in a later generation) draws a copy of that parent beside its new mate, so the original cross keeps both its parents. Tidy repairs drawings that already have this.
- A genotype copied with Cmd+D, copy/paste or alt-drag becomes its own genotype. Tidy used to merge the copies, deleting one.
```

- [ ] **Step 3: Build and verify**

Run: `uv run installer/build.py && git status --short`
Expected: `dist/` changes. Then commit:

```bash
git add README.md CHANGELOG.md VERSION dist
git commit -m "Version <version>: backcrosses, duplicated genotypes

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 4: Scan**

Run: `git status --short && tools/scan.sh`
Expected: clean tree, scan `PASS`.

- [ ] **Step 5: Publish (ask the user first)**

Publishing pushes to the public repo. Confirm with the user, then follow `CLAUDE.md` "To release" step 4 exactly (switch to `public`, replace tree from `main`, commit `Release <version>`, push `public:main`, tag, `gh release create` with the CHANGELOG section as notes, switch back to `main`).
