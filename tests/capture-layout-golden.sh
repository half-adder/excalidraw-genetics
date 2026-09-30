#!/usr/bin/env bash
# Captures what the Tidy SCRIPT makes of each single-lineage fixture, for the
# layout unit tests (tests/unit/layout.test.ts): loads the fixture, runs Tidy
# with nothing selected, and writes the live elements to
# tests/unit/golden/tidy-<fixture>.json. The fixtures are already tidy, so
# each is captured a second time with its genotypes first moved by fixed
# offsets (tidy-<fixture>-moved.json). sibling-order is also captured with
# its two offspring's x swapped (tidy-sibling-order-swapped.json), so the
# goldens test sibling order too. Every golden keeps the scene Tidy started
# from as `before`. Run with the scripts engine (the reference), before the scripts
# are retired: FLY_ENGINE=scripts FLY_FROZEN=1.
source "$(dirname "$0")/lib.sh"
# The goldens are the scripts' output (the reference the plugin is checked
# against); captured with the plugin they would compare it with itself.
[[ "$ENGINE" == scripts ]] || { echo "FAIL: capture the goldens with FLY_ENGINE=scripts FLY_FROZEN=1 (the reference)"; exit 1; }
fly_test <<'JS'
const fs = require('fs');
const list = ['below', 'joined-families', 'three-partners', 'sibling-chain', 'sibling-cross', 'sibling-order', 'select-move', 'label-criterion'];
fs.mkdirSync(T.repo + '/tests/unit/golden', { recursive: true });
// Ids Tidy made (random) are renumbered r0000001..., h0000001... (groups), as
// the fixtures' are, so random ids cannot spell words by chance. Fixture ids
// (q..., g...) are kept, so fixture and golden ids still match.
const renumber = (els, text) => {
  const map = new Map();
  const kept = id => /^[qg][0-9]{7}$/.test(id);
  let n = 0, g = 0;
  for (const e of els) if (!kept(e.id)) map.set(e.id, 'r' + String(++n).padStart(7, '0'));
  for (const e of els) for (const id of e.groupIds ?? []) if (!kept(id) && !map.has(id)) map.set(id, 'h' + String(++g).padStart(7, '0'));
  return text.replace(/"([^"\\]{1,64})"/g, (m, id) => map.has(id) ? '"' + map.get(id) + '"' : m);
};
// Offsets for the moved captures, by genotype name in sorted order.
const DX = [-150, 90, -40, 170, -110, 60, 130, -80, 20, -170, 110];
const DY = [-25, 18, 30, -12, 8, -30, 22, -5, 15, -20, 10];
const gids = () => new Set(F.live().filter(e => e.customData?.genotypeId).map(e => e.customData.genotypeId));
const runs = [...list.flatMap(s => [[s, ''], [s, '-moved']]), ['sibling-order', '-swapped']];
for (const [s, variant] of runs) {
  {
    const out = 'tidy-' + s + variant;
    const moved = variant !== '';
    await T.fixture(s);
    let before = null, offsets = null;
    if (variant === '-moved') offsets = Object.fromEntries(Object.keys(window.__t).sort().map((n, i) => [n, [DX[i % DX.length], DY[i % DY.length]]]));
    if (variant === '-swapped') offsets = { A: [F.cx('B') - F.cx('A'), 0], B: [F.cx('A') - F.cx('B'), 0] };
    if (moved) await F.move(offsets, false);
    before = F.live();
    const had = gids();
    await T.tidyAll();
    const after = F.live();
    if (gids().size !== had.size) { T.check('FAIL: ' + out + ': Tidy changed the set of genotypes; not a layout golden'); continue; }
    const data = moved ? { fixture: s, names: window.__t, offsets, before, elements: after } : { fixture: s, names: window.__t, before, elements: after };
    fs.writeFileSync(T.repo + '/tests/unit/golden/' + out + '.json', renumber([...before, ...after], JSON.stringify(data)) + '\n');
    T.check('PASS: captured ' + out + ' (' + after.length + ' elements)');
  }
}
JS
