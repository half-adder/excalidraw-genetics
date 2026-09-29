// Shared invariant checks for the Obsidian-driven tests. lib.sh evaluates
// this file in Obsidian (fly_load), which defines window.__fly. Each check
// returns one or more lines starting with PASS: or FAIL:. Scenario names
// (P1, A, ...) come from window.__t (name -> genotypeId).
window.__fly = (() => {
  const F = {};
  // Refuses to act on anything but the harness drawing (window.__flyDrawing).
  const view = () => {
    const ea = ExcalidrawAutomate; ea.setView();
    const p = ea.targetView?.file?.path ?? '';
    if (!p.startsWith('Excalidraw/_test-') || p !== window.__flyDrawing) throw new Error('active drawing is not a throwaway: ' + p);
    return ea;
  };
  const live = () => view().getViewElements().filter(e => !e.isDeleted);
  const kind = (v, k) => v.filter(e => e.customData?.kind === k);
  const ov = (a, b, pad = 0) => a.x < b.x + b.width - pad && a.x + a.width > b.x + pad && a.y < b.y + b.height - pad && a.y + a.height > b.y + pad;
  const name = (g, v) => {
    const n = Object.entries(window.__t ?? {}).find(([, x]) => x === g)?.[0];
    if (n) return n;
    const l = v.find(e => e.customData?.genotypeId === g && e.customData.kind === 'genotype-label');
    if (l) return '[' + l.originalText + ']';
    const a = v.filter(e => e.customData?.genotypeId === g && e.customData.kind === 'genotype-allele').map(e => e.originalText);
    return a.length ? a.slice(0, 2).join('/') : 'gid:' + String(g).slice(0, 8);
  };
  const xn = (g, v) => name(g.customData.parents.maternal, v) + 'x' + name(g.customData.parents.paternal, v);
  const line = (bad, fail, pass) => bad.length ? 'FAIL: ' + fail + ': ' + [...new Set(bad)].join('; ') : 'PASS: ' + pass;

  F.view = view;
  F.live = live;
  F.name = g => name(g, live());

  // Elements of named genotypes.
  F.els = (n, k) => live().filter(e => e.customData?.genotypeId === window.__t[n] && (!k || e.customData.kind === k));

  F.deselect = () => { window.__flyWant = []; view().targetView.excalidrawAPI.updateScene({ appState: { selectedElementIds: {}, selectedGroupIds: {} } }); return 1; };

  // Select one allele of each named genotype (all = every allele).
  F.select = (names, all = false) => {
    const ea = view();
    const els = names.flatMap(n => { const a = F.els(n, 'genotype-allele'); return all ? a : a.slice(0, 1); });
    window.__flyWant = els.map(e => e.id);
    ea.selectElementsInView(els);
    return els.length;
  };

  F.missing = names => {
    const miss = names.filter(n => !window.__t[n]);
    return miss.length ? 'FAIL: setup did not capture ' + miss.join(',') : 'ok';
  };

  // 1. No two genotype frames overlap (frames cover labels).
  F.overlaps = () => {
    const v = live(), fr = kind(v, 'genotype-frame'), bad = [];
    for (let i = 0; i < fr.length; i++) for (let j = i + 1; j < fr.length; j++)
      if (ov(fr[i], fr[j], 1)) bad.push(name(fr[i].customData.genotypeId, v) + ' & ' + name(fr[j].customData.genotypeId, v));
    return line(bad, 'overlapping genotypes', 'no overlapping genotypes (' + fr.length + ')');
  };

  // 2. No genotype frame overlaps a cross glyph that is not its own.
  F.foreignX = () => {
    const v = live(), fr = kind(v, 'genotype-frame'), gl = kind(v, 'cross-glyph'), bad = [];
    for (const g of gl) {
      const own = [g.customData.parents.maternal, g.customData.parents.paternal];
      for (const f of fr) if (!own.includes(f.customData.genotypeId) && ov(f, g)) bad.push(name(f.customData.genotypeId, v) + ' on x of ' + xn(g, v));
    }
    return line(bad, 'genotype on a foreign x', 'no genotype on a foreign x (' + gl.length + ' x glyphs)');
  };

  // 2b. Same, measured on each genotype's alleles and label (no frame).
  F.foreignXAlleles = () => {
    const ea = view(), v = live(), bad = [];
    const gids = new Set(kind(v, 'genotype-allele').map(e => e.customData.genotypeId));
    for (const g of kind(v, 'cross-glyph')) {
      const own = [g.customData.parents.maternal, g.customData.parents.paternal];
      for (const gid of gids) {
        if (own.includes(gid)) continue;
        const b = ea.getBoundingBox(v.filter(e => e.customData?.genotypeId === gid && e.customData.kind !== 'genotype-frame'));
        if (g.x < b.topX + b.width && g.x + g.width > b.topX && g.y < b.topY + b.height && g.y + g.height > b.topY)
          bad.push(name(gid, v) + ' overlaps x of ' + xn(g, v));
      }
    }
    return line(bad, 'genotype on a foreign cross glyph', 'no genotype overlaps a foreign cross glyph');
  };

  // 3. No two cross glyphs overlap.
  F.xOverlap = () => {
    const v = live(), gl = kind(v, 'cross-glyph'), bad = [];
    for (let i = 0; i < gl.length; i++) for (let j = i + 1; j < gl.length; j++)
      if (ov(gl[i], gl[j])) bad.push(xn(gl[i], v) + ' & ' + xn(gl[j], v));
    return line(bad, 'overlapping x glyphs', 'no overlapping x glyphs');
  };

  // 4. Every offspring has exactly one lineage arrow, bound from its parents'
  // x to its own frame; with pos, starting at the x bottom middle and ending
  // at the frame top middle (within 2 px).
  F.arrows = (opts = {}) => {
    const v = live(), fr = kind(v, 'genotype-frame'), gl = kind(v, 'cross-glyph'), ars = kind(v, 'cross-lineage'), bad = [];
    const near = (p, q) => Math.abs(p[0] - q[0]) <= 2 && Math.abs(p[1] - q[1]) <= 2;
    for (const gid of new Set(v.filter(e => e.customData?.parents && e.customData?.genotypeId).map(e => e.customData.genotypeId))) {
      const p = v.find(e => e.customData?.genotypeId === gid && e.customData.parents).customData.parents;
      const xg = gl.find(e => e.customData.parents.maternal === p.maternal && e.customData.parents.paternal === p.paternal);
      const f = fr.find(e => e.customData.genotypeId === gid);
      const mine = ars.filter(e => e.customData.childGenotypeId === gid);
      const n = name(gid, v);
      if (mine.length !== 1) { bad.push(n + ': ' + mine.length + ' arrows'); continue; }
      const a = mine[0], pts = a.points.map(([x, y]) => [a.x + x, a.y + y]);
      if (!xg || a.startBinding?.elementId !== xg.id) bad.push(n + ': arrow not bound to its parents x');
      else if (opts.pos && !near(pts[0], [xg.x + xg.width / 2, xg.y + xg.height])) bad.push(n + ': arrow does not start at the x bottom middle');
      if (!f || a.endBinding?.elementId !== f.id) bad.push(n + ': arrow not bound to its frame');
      else if (opts.pos && !near(pts[pts.length - 1], [f.x + f.width / 2, f.y])) bad.push(n + ': arrow does not end at the frame top middle');
    }
    return line(bad, 'offspring arrows', 'every offspring has one arrow from its parents x to its frame (' + ars.length + ' arrows)');
  };

  // 5. No lineage arrow segment passes through a frame other than its own
  // child's; with diag, no segment is diagonal.
  F.cut = (opts = {}) => {
    const v = live(), fr = kind(v, 'genotype-frame'), bad = [];
    for (const a of kind(v, 'cross-lineage')) {
      const pts = a.points.map(([x, y]) => [a.x + x, a.y + y]), to = name(a.customData.childGenotypeId, v);
      for (let i = 1; i < pts.length; i++) {
        const [x1, y1] = pts[i - 1], [x2, y2] = pts[i];
        if (opts.diag && Math.abs(x1 - x2) > 0.5 && Math.abs(y1 - y2) > 0.5) bad.push('arrow to ' + to + ' has a diagonal segment');
        const s = { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
        for (const f of fr) {
          if (f.customData.genotypeId === a.customData.childGenotypeId) continue;
          if (ov(s, f, 1)) bad.push('arrow to ' + to + ' crosses ' + name(f.customData.genotypeId, v));
        }
      }
    }
    return line(bad, 'lineage arrows through frames', 'no lineage arrow passes through a foreign genotype');
  };

  // Positions of every genotype frame, allele bounding box and x glyph,
  // rounded to the pixel, keyed by name.
  F.snap = () => {
    const ea = view(), v = live(), r = Math.round, o = {};
    for (const f of kind(v, 'genotype-frame')) o['frame ' + name(f.customData.genotypeId, v) + ' ' + String(f.customData.genotypeId).slice(0, 6)] = [r(f.x), r(f.y)];
    for (const g of kind(v, 'cross-glyph')) o['x ' + xn(g, v) + ' ' + String(g.customData.parents.maternal).slice(0, 6) + String(g.customData.parents.paternal).slice(0, 6)] = [r(g.x), r(g.y)];
    const al = kind(v, 'genotype-allele');
    for (const gid of new Set(al.map(e => e.customData.genotypeId))) {
      const b = ea.getBoundingBox(al.filter(e => e.customData.genotypeId === gid));
      o['alleles ' + name(gid, v) + ' ' + String(gid).slice(0, 6)] = [r(b.topX), r(b.topY)];
    }
    return Object.fromEntries(Object.entries(o).sort());
  };
  F.snapSave = () => { window.__snap = F.snap(); return 1; };
  // Compares the current positions with the last snapSave.
  F.unmoved = what => {
    const a = window.__snap, b = F.snap(), bad = [];
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)]))
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) bad.push(k + ' ' + JSON.stringify(a[k]) + ' -> ' + JSON.stringify(b[k]));
    return line(bad, what + ' moved something', what + ' moved nothing');
  };

  // Rows of the scenario genotypes, top to bottom, left to right.
  F.layout = () => {
    const fr = kind(live(), 'genotype-frame'), rows = {};
    for (const [n, g] of Object.entries(window.__t)) {
      const f = fr.find(e => e.customData.genotypeId === g);
      if (!f) continue;
      const y = Math.round(f.y + f.height);
      (rows[y] ??= []).push([f.x, n]);
    }
    return 'layout: ' + Object.keys(rows).sort((a, b) => a - b).map(y => rows[y].sort((a, b) => a[0] - b[0]).map(r => r[1]).join(' ')).join(' | ');
  };

  // Moves named genotypes (with labels and frames). spots maps name to
  // [x, y]: the allele bounding-box center goes there (abs) or moves by it.
  F.move = async (spots, abs = true) => {
    const ea = view();
    ea.clear();
    for (const [n, [x, y]] of Object.entries(spots)) {
      const els = F.els(n);
      const b = ea.getBoundingBox(els.filter(e => e.customData.kind === 'genotype-allele'));
      const dx = abs ? x - (b.topX + b.width / 2) : x, dy = abs ? y - (b.topY + b.height / 2) : y;
      ea.copyViewElementsToEAforEditing(els);
      for (const e of els) { const w = ea.getElement(e.id); w.x += dx; w.y += dy; }
    }
    await ea.addElementsToView(false, false, true);
    return 1;
  };

  // Allele bounding-box center x of a named genotype.
  F.cx = n => { const b = view().getBoundingBox(F.els(n, 'genotype-allele')); return b.topX + b.width / 2; };

  return F;
})();
1
