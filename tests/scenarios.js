// Build steps for the fixture scenarios (window.__flyScenarios). Each runs in
// an empty scene through Genotype and Cross Genotypes and records every
// genotype it makes in window.__t; the harness saves the result as
// fixtures/<name>.json (plain JSON). A fixture is the
// state right before the operation under test. Changing a scenario's steps,
// the founders below, or Genotype, Cross Genotypes or Tidy makes its fixture
// stale, and the next test that uses it rebuilds it. Generic public alleles only.
window.__flyFounders = {
  P1: { glyph: '♀', X: { top: 'w', bottom: '' }, II: { top: 'Sp', bottom: 'CyO' }, III: { top: '', bottom: '' } },
  P2: { glyph: '♂', X: { top: 'w', bottom: 'Y' }, II: { top: 'Gla', bottom: 'Bc' }, III: { top: '', bottom: '' } },
};
window.__flyScenarios = (() => {
  const P = () => window.__flyFounders;
  const founders = async T => { await T.genotype('P1', P().P1); await T.genotype('P2', P().P2); };
  return {
    // P1 x P2 -> A, B (siblings); A x P3 -> C, D; C x P4 -> E; then a full Tidy.
    'below': async T => {
      await founders(T);
      await T.cross('A', 'P1', 'P2', { offspringGlyph: '♀', pick: { X: 0, II: 2, III: 0 }, labelText: 'A', criterionText: 'CyO' });
      await T.cross('B', 'P1', 'P2', { offspringGlyph: '♂', pick: { X: 1, II: 3, III: 0 }, labelText: 'B' });
      await T.genotype('P3', { glyph: '♂', X: { top: 'yw', bottom: 'Y' }, II: { top: '', bottom: '' }, III: { top: 'MKRS', bottom: 'TM6B' } });
      await T.cross('C', 'A', 'P3', { offspringGlyph: '♀', pick: { X: 0, II: 0, III: 0 }, labelText: 'C' });
      await T.cross('D', 'A', 'P3', { offspringGlyph: '♀', pick: { X: 0, II: 0, III: 1 }, labelText: 'D' });
      await T.genotype('P4', { glyph: '♂', X: { top: 'w', bottom: 'Y' }, II: { top: '', bottom: '' }, III: { top: 'Sb', bottom: 'TM3' } });
      await T.cross('E', 'C', 'P4', { offspringGlyph: '♀', pick: { X: 0, II: 0, III: 0 }, labelText: 'E' });
      await T.tidyAll();
    },
    // Family 1: P1 x P2 -> A, B; A x P3 -> C. Family 2: Q1 x Q2 -> D, E. D x C -> F.
    'joined-families': async T => {
      await founders(T);
      await T.genotype('P3', { glyph: '♂', X: { top: 'yw', bottom: 'Y' }, II: { top: 'Gla', bottom: 'CyO' }, III: { top: '', bottom: '' } });
      await T.genotype('Q1', { glyph: '♀', X: { top: 'w', bottom: '' }, II: { top: 'Bc', bottom: 'CyO' }, III: { top: '', bottom: '' } });
      await T.genotype('Q2', { glyph: '♂', X: { top: 'yw', bottom: 'Y' }, II: { top: 'Sp', bottom: 'CyO' }, III: { top: '', bottom: '' } });
      await T.cross('A', 'P1', 'P2', { offspringGlyph: '♀', pick: { X: 0, II: 0, III: 0 }, labelText: 'A' });
      await T.cross('B', 'P1', 'P2', { offspringGlyph: '♂', pick: { X: 1, II: 3, III: 0 }, labelText: 'B' });
      await T.cross('C', 'A', 'P3', { offspringGlyph: '♂', pick: { X: 1, II: 0, III: 0 }, labelText: 'C' });
      await T.cross('D', 'Q1', 'Q2', { offspringGlyph: '♀', pick: { X: 0, II: 0, III: 0 }, labelText: 'D' });
      await T.cross('E', 'Q1', 'Q2', { offspringGlyph: '♂', pick: { X: 1, II: 1, III: 0 }, labelText: 'E' });
      await T.cross('F', 'D', 'C', { offspringGlyph: '♀', pick: { X: 0, II: 0, III: 0 }, labelText: 'F' });
    },
    // P1 x P2 -> A (male), B, C, D (females); B x A -> E, C x A -> F, D x A -> G.
    'three-partners': async T => {
      await founders(T);
      await T.cross('A', 'P1', 'P2', { offspringGlyph: '♂', pick: { X: 1, II: 3, III: 0 }, labelText: 'A' });
      await T.cross('B', 'P1', 'P2', { offspringGlyph: '♀', pick: { X: 0, II: 0, III: 0 }, labelText: 'B' });
      await T.cross('C', 'P1', 'P2', { offspringGlyph: '♀', pick: { X: 0, II: 1, III: 0 }, labelText: 'C' });
      await T.cross('D', 'P1', 'P2', { offspringGlyph: '♀', pick: { X: 0, II: 2, III: 0 }, labelText: 'D' });
      await T.cross('E', 'B', 'A', { offspringGlyph: '♀', pick: { X: 0, II: 0, III: 0 }, labelText: 'E' });
      await T.cross('F', 'C', 'A', { offspringGlyph: '♀', pick: { X: 0, II: 0, III: 0 }, labelText: 'F' });
      await T.cross('G', 'D', 'A', { offspringGlyph: '♀', pick: { X: 0, II: 0, III: 0 }, labelText: 'G' });
    },
    // P1 x P2 -> A, B, C; A x B -> D; A x C -> E.
    'sibling-chain': async T => {
      await founders(T);
      await T.cross('A', 'P1', 'P2', { offspringGlyph: '♀', pick: { X: 0, II: 0, III: 0 }, labelText: 'A' });
      await T.cross('B', 'P1', 'P2', { offspringGlyph: '♂', pick: { X: 1, II: 3, III: 0 }, labelText: 'B' });
      await T.cross('C', 'P1', 'P2', { offspringGlyph: '♂', pick: { X: 1, II: 1, III: 0 }, labelText: 'C' });
      await T.cross('D', 'A', 'B', { offspringGlyph: '♀', pick: { X: 0, II: 0, III: 0 }, labelText: 'D' });
      await T.cross('E', 'A', 'C', { offspringGlyph: '♀', pick: { X: 0, II: 0, III: 0 }, labelText: 'E' });
    },
    // P1 x P2 -> A, B, C; A x B -> D.
    'sibling-cross': async T => {
      await founders(T);
      await T.cross('A', 'P1', 'P2', { offspringGlyph: '♀', pick: { X: 0, II: 0, III: 0 }, labelText: 'A' });
      await T.cross('B', 'P1', 'P2', { offspringGlyph: '♂', pick: { X: 1, II: 3, III: 0 }, labelText: 'B' });
      await T.cross('C', 'P1', 'P2', { offspringGlyph: '♀', pick: { X: 0, II: 1, III: 0 }, labelText: 'C' });
      await T.cross('D', 'A', 'B', { offspringGlyph: '♀', pick: { X: 0, II: 0, III: 0 }, labelText: 'D' });
    },
    // P1 x P2 -> A, B (offspring sex left to the pick); then a full Tidy.
    'sibling-order': async T => {
      await founders(T);
      await T.cross('A', 'P1', 'P2', { offspringGlyph: null, pick: { X: 0, II: 0, III: 0 }, labelText: 'A' });
      await T.cross('B', 'P1', 'P2', { offspringGlyph: null, pick: { X: 1, II: 3, III: 0 }, labelText: 'B' });
      await T.tidyAll();
    },
    // P1 x P2 -> A, B, C; A x P3 -> D, E; then a full Tidy (the select-move
    // README animation).
    'select-move': async T => {
      await founders(T);
      await T.cross('A', 'P1', 'P2', { offspringGlyph: '♀', pick: { X: 0, II: 2, III: 0 }, labelText: 'A', criterionText: 'CyO' });
      await T.cross('B', 'P1', 'P2', { offspringGlyph: '♂', pick: { X: 1, II: 3, III: 0 }, labelText: 'B' });
      await T.cross('C', 'P1', 'P2', { offspringGlyph: '♀', pick: { X: 0, II: 1, III: 0 }, labelText: 'C' });
      await T.genotype('P3', { glyph: '♂', X: { top: 'yw', bottom: 'Y' }, II: { top: '', bottom: '' }, III: { top: 'MKRS', bottom: 'TM6B' } });
      await T.cross('D', 'A', 'P3', { offspringGlyph: '♀', pick: { X: 0, II: 0, III: 0 }, labelText: 'D' });
      await T.cross('E', 'A', 'P3', { offspringGlyph: '♀', pick: { X: 0, II: 0, III: 1 }, labelText: 'E', criterionText: 'TM6B' });
      await T.tidyAll();
    },
    // P1 x P2 -> A (female); the start of a backcross of A to its father.
    'backcross': async T => {
      await founders(T);
      await T.cross('A', 'P1', 'P2', { offspringGlyph: '♀', pick: { X: 0, II: 0, III: 0 }, labelText: 'A' });
    },
    // P1 x P2 -> A, C (both female); both are later crossed back to P2.
    'backcross-sibs': async T => {
      await founders(T);
      await T.cross('A', 'P1', 'P2', { offspringGlyph: '♀', pick: { X: 0, II: 0, III: 0 }, labelText: 'A' });
      await T.cross('C', 'P1', 'P2', { offspringGlyph: '♀', pick: { X: 0, II: 1, III: 0 }, labelText: 'C' });
    },
    // P1 x P2 -> A, B (female); A x P3 -> C; stock S, crossed later to B
    // (row 1) and to C (row 2).
    'reused-stock': async T => {
      await founders(T);
      await T.cross('A', 'P1', 'P2', { offspringGlyph: '♀', pick: { X: 0, II: 0, III: 0 }, labelText: 'A' });
      await T.cross('B', 'P1', 'P2', { offspringGlyph: '♀', pick: { X: 0, II: 1, III: 0 }, labelText: 'B' });
      await T.genotype('P3', { glyph: '♂', X: { top: 'yw', bottom: 'Y' }, II: { top: '', bottom: '' }, III: { top: 'MKRS', bottom: 'TM6B' } });
      await T.cross('C', 'A', 'P3', { offspringGlyph: '♀', pick: { X: 0, II: 0, III: 0 }, labelText: 'C' });
      await T.genotype('S', { glyph: '♂', X: { top: 'y', bottom: 'Y' }, II: { top: '', bottom: '' }, III: { top: 'Sb', bottom: 'TM3' } });
    },
    // P1 x P2 -> F, made with a label and a selection criterion.
    'label-criterion': async T => {
      await founders(T);
      await T.cross('F', 'P1', 'P2', { offspringGlyph: '♀', pick: { X: 0, II: 0, III: 0 }, labelText: 'F1-a', criterionText: 'non-Cy' });
    },
  };
})();
1
