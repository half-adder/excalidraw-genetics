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
