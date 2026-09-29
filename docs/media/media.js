// README animation capture, run inside Obsidian by make-media.sh through the
// test harness (tests/lib.sh fly_test): window.__flyMedia.run(T, F, gif)
// drives the scripts in the throwaway drawing Excalidraw/_test-harness and
// saves PNG frames to <window.__mediaOut>/<gif>/NN.png.
//
// Privacy: every frame is captured with webContents.capturePage(rect), so
// nothing outside rect is ever written. rect is a fixed box inside the
// drawing area of the throwaway view (its .excalidraw container), grown to
// cover an open script modal but always clamped to that drawing area. Tab
// bar, breadcrumb, sidebars and other panes lie outside it. F.view() refuses
// to act on any drawing but the throwaway one; shot() also refuses to capture
// when that view is not the visible active one, or when a modal other than
// one of the scripts' own is open. Only generic public alleles are drawn.
window.__flyMedia = (() => {
  const fs = require('fs');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  const CW = 1000, CH = 760; // crop box (CSS px): 800 px wide GIF at 0.8x; tall enough for the cross picker

  async function waitFor(fn, what, ms = 10000) {
    const t0 = Date.now();
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() - t0 > ms) throw new Error('timed out waiting for ' + what);
      await sleep(20);
    }
  }

  async function make(T, F, gif) {
    const view = F.view().targetView;
    // Too narrow for the crop box: collapse the sidebars (make-media.sh
    // restores their previous state at the end).
    if (view.contentEl.querySelector('.excalidraw').getBoundingClientRect().width < CW + 40) {
      app.workspace.leftSplit.collapse();
      app.workspace.rightSplit.collapse();
      await sleep(500);
    }
    const api = view.excalidrawAPI;
    // Hide the empty-canvas welcome screen (plugin tips and drawing counts)
    // and Excalidraw's own toolbar and menus.
    view.contentEl.classList.add('fly-media');
    const style = document.head.createEl('style', { attr: { id: 'fly-media-style' } });
    style.textContent = '.fly-media [class*="welcome-screen"] { display: none !important; } .fly-media .layer-ui__wrapper { visibility: hidden !important; }';
    const wc = require('electron').remote.getCurrentWebContents();
    const out = window.__mediaOut + '/' + gif;
    fs.rmSync(out, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });
    let n = 0;

    const container = () => view.contentEl.querySelector('.excalidraw');
    const area = () => {
      const r = container().getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    };
    // Fixed crop box: CW x CH around the window center (where modals open),
    // inside the drawing area.
    const box = () => {
      const a = area();
      const w = Math.min(CW, a.w), h = Math.min(CH, a.h);
      const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
      return { x: clamp(innerWidth / 2 - w / 2, a.x, a.x + a.w - w), y: clamp(innerHeight / 2 - h / 2, a.y, a.y + a.h - h), w, h };
    };
    const ours = () => [window._genotypeFormModal?.modal, window._crossGenotypesModal?.modal].filter(Boolean).map(m => m.modalEl);
    const openModals = () => [...document.querySelectorAll('.modal-container .modal')];

    // Zooms and scrolls so the scene box b ({topX, topY, width, height}, or
    // the bounding box of `els`) is centered in the crop box.
    const fit = async (els = F.live(), { maxZoom = 1.6, margin = 50, b = null } = {}) => {
      b ??= F.view().getBoundingBox(els);
      const c = box(), st = api.getAppState();
      const z = Math.min(maxZoom, (c.w - 2 * margin) / b.width, (c.h - 2 * margin) / b.height);
      const cx = c.x + c.w / 2 - st.offsetLeft, cy = c.y + c.h / 2 - st.offsetTop;
      api.updateScene({ appState: { zoom: { value: z }, scrollX: cx / z - (b.topX + b.width / 2), scrollY: cy / z - (b.topY + b.height / 2) }, captureUpdate: 'NEVER' });
      await frame(); await frame();
    };

    const shot = async (label, { fast = false } = {}) => {
      F.view(); // throws unless the throwaway drawing is the active view
      if (!view.containerEl.isConnected || app.workspace.getActiveViewOfType(view.constructor) !== view) throw new Error('throwaway view not active');
      if (fast) await frame(); else { await frame(); await frame(); await sleep(300); }
      const mine = ours();
      const foreign = openModals().filter(m => !mine.includes(m));
      if (foreign.length) throw new Error('a modal that is not a script form is open; refusing to capture');
      const a = area();
      let r = box();
      for (const m of mine) {
        const q = m.getBoundingClientRect();
        const x0 = Math.min(r.x, q.left), y0 = Math.min(r.y, q.top);
        r = { x: x0, y: y0, w: Math.max(r.x + r.w, q.right) - x0, h: Math.max(r.y + r.h, q.bottom) - y0 };
      }
      // Clamp to the drawing area (never outside it).
      const x0 = Math.max(r.x, a.x), y0 = Math.max(r.y, a.y);
      const x1 = Math.min(r.x + r.w, a.x + a.w), y1 = Math.min(r.y + r.h, a.y + a.h);
      const rect = { x: Math.ceil(x0), y: Math.ceil(y0), width: Math.floor(x1 - Math.ceil(x0)), height: Math.floor(y1 - Math.ceil(y0)) };
      for (const m of mine) {
        const q = m.getBoundingClientRect();
        if (q.left < rect.x - 1 || q.top < rect.y - 1 || q.right > rect.x + rect.width + 1 || q.bottom > rect.y + rect.height + 1)
          T.out('warning: ' + gif + ' frame ' + (n + 1) + ': modal extends beyond the drawing area and is cut off');
      }
      // Notices sit top right of the window; hide them for the capture anyway.
      const notices = document.querySelector('.notice-container');
      const vis = notices?.style.visibility;
      if (notices) { notices.style.visibility = 'hidden'; await frame(); await frame(); }
      let img;
      try { img = await wc.capturePage(rect); } finally { if (notices) notices.style.visibility = vis ?? ''; }
      const file = out + '/' + String(++n).padStart(2, '0') + '.png';
      fs.writeFileSync(file, img.toPNG());
      T.out('frame ' + gif + '/' + String(n).padStart(2, '0') + ' ' + JSON.stringify(rect) + ' ' + label);
    };

    const setInput = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    const button = (root, text) => {
      const b = [...root.querySelectorAll('button')].find(x => x.textContent === text);
      if (!b) throw new Error('no button ' + text);
      return b;
    };
    const genoForm = () => waitFor(() => window._genotypeFormModal, 'Genotype form');
    const picker = () => waitFor(() => window._crossGenotypesModal, 'Cross picker');
    // Clicks the card of `chr` whose top/bottom match.
    const pickCard = (chr, top, bottom) => {
      const m = window._crossGenotypesModal;
      const opts = window._crossGenotypesOptions[chr];
      const i = opts.findIndex(o => o.top === top && o.bottom === bottom);
      if (i < 0) throw new Error('no ' + chr + ' card ' + top + '/' + bottom + ' in ' + JSON.stringify(opts.map(o => o.top + '/' + o.bottom)));
      m.columns[chr].children[i].click();
    };
    const geno = async (name, at, g) => { window._genotypeCreateAt = at; await T.genotype(name, g); };
    // Places `right` `gap` scene px to the right of `left` (frame to frame),
    // aligned on the fraction lines, as Tidy lays out a pair of parents.
    const besides = async (left, right, gap = 180) => {
      const fr = n => F.els(n, 'genotype-frame')[0];
      const a = fr(left), b = fr(right);
      await F.move({ [right]: [a.x + a.width + gap - b.x, a.y + a.height / 2 - (b.y + b.height / 2)] }, false);
    };
    // Selects whole genotypes as a click on each would (their groups).
    const selectGenos = names => {
      const els = names.flatMap(n => F.els(n));
      const groups = Object.fromEntries(els.map(e => e.groupIds?.at(-1)).filter(Boolean).map(g => [g, true]));
      window.__flyWant = els.map(e => e.id);
      api.updateScene({ appState: { selectedElementIds: Object.fromEntries(els.map(e => [e.id, true])), selectedGroupIds: groups } });
    };
    const undo = () => container().dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', metaKey: true, bubbles: true, cancelable: true }));

    const cleanup = () => { view.contentEl.classList.remove('fly-media'); style.remove(); };
    const dropLast = () => { fs.rmSync(out + '/' + String(n).padStart(2, '0') + '.png'); n--; };
    // Optional per-frame timing and review subset, read by make-media.sh:
    // delays.txt (one delay per frame, in 1/100 s) and review.txt (the frame
    // files to copy to docs/media/frames/<gif>/). Without them every frame
    // shows 1.2 s (2.5 s the last) and every frame is copied.
    const count = () => n;
    const writeMeta = (delays, review) => {
      if (delays.length !== n) throw new Error(delays.length + ' delays for ' + n + ' frames');
      fs.writeFileSync(out + '/delays.txt', delays.join('\n') + '\n');
      fs.writeFileSync(out + '/review.txt', review.map(i => String(i).padStart(2, '0') + '.png').join('\n') + '\n');
    };

    return { view, api, fit, shot, dropLast, cleanup, setInput, button, genoForm, picker, pickCard, geno, besides, selectGenos, undo, box, count, writeMeta, container };
  }

  // ---- The animations ------------------------------------------------------

  const GIFS = {
    async genotype(T, F, M) {
      T.empty();
      await M.fit(null, { b: { topX: -170, topY: -60, width: 340, height: 120 }, maxZoom: 1.8 });
      await M.shot('empty canvas');
      window._genotypeCreateAt = { x: 0, y: 0 };
      window._genotypeLastResult = undefined;
      let run = T.run('Genotype');
      let f = await M.genoForm();
      await M.shot('Genotype form, blank');
      M.button(f.modal.contentEl, '♀').click();
      const vals = { 'X.top': 'w', 'X.bottom': 'FM7a', 'II.top': 'Sp', 'II.bottom': 'CyO', 'III.top': 'MKRS', 'III.bottom': 'TM6B' };
      for (const [k, v] of Object.entries(vals)) M.setInput(f.inputs[k], v);
      f.inputs['III.bottom'].focus();
      await M.shot('fields filled');
      M.button(f.modal.contentEl, 'OK').click();
      await run;
      window.__t.G = window._genotypeLastResult;
      F.deselect();
      await M.fit(F.live(), { maxZoom: 1.8 });
      await M.shot('genotype drawn');
      F.select(['G'], true);
      run = T.run('Genotype');
      f = await M.genoForm();
      M.setInput(f.inputs['X.top'], 'yw');
      f.inputs['X.top'].focus();
      await M.shot('form reopened, X allele changed to yw');
      M.button(f.modal.contentEl, 'OK').click();
      await run;
      F.deselect();
      await M.shot('redrawn in place');
    },

    async cross(T, F, M) {
      T.empty();
      await M.geno('P1', { x: 0, y: 0 }, { glyph: '♀', X: { top: 'w', bottom: 'FM7a' }, II: { top: 'Sp', bottom: 'CyO' }, III: { top: 'MKRS', bottom: 'TM6B' } });
      await M.geno('P2', { x: 600, y: 0 }, { glyph: '♂', X: { top: 'w', bottom: 'Y' }, II: { top: 'Gla', bottom: 'Bc' }, III: { top: 'Sb', bottom: 'TM3' } });
      await M.besides('P1', 'P2');
      M.selectGenos(['P1', 'P2']);
      const b = F.view().getBoundingBox(F.live());
      await M.fit(null, { b: { ...b, height: b.height + 180 }, maxZoom: 1.4 });
      await M.shot('two parents selected');
      window._crossGenotypesLastResult = undefined;
      const run = T.run('Cross Genotypes');
      const p = await M.picker();
      await M.shot('Cross Genotypes picker');
      M.pickCard('X', 'w', 'Y');
      await M.shot('son X card picked: sex follows');
      M.pickCard('II', 'CyO', 'Gla');
      M.pickCard('III', 'TM6B', 'Sb');
      await M.shot('II and III picked');
      M.setInput(p.labelInput, 'F1');
      M.setInput(p.critInput, 'CyO\nTM6B');
      p.critInput.focus();
      await M.shot('label and criterion');
      M.button(p.modal.contentEl, 'OK').click();
      await run;
      F.deselect();
      await M.fit(F.live(), { maxZoom: 1.4 });
      await M.shot('offspring drawn');
    },

    async 'cross-mode'(T, F, M) {
      T.empty();
      await M.geno('P1', { x: 0, y: 0 }, { glyph: '♀', X: { top: 'yw', bottom: 'yw' }, II: { top: 'UAS-GFP', bottom: 'CyO' }, III: { top: '', bottom: '' } });
      await M.geno('P2', { x: 600, y: 0 }, { glyph: '♂', X: { top: 'w', bottom: 'Y' }, II: { top: '', bottom: '' }, III: { top: 'Df(3R)BSC468', bottom: 'TM6B' } });
      await M.besides('P1', 'P2', 150);
      F.deselect();
      const b = F.view().getBoundingBox(F.live());
      await M.fit(null, { b: { ...b, height: b.height + 180 }, maxZoom: 1.4 });
      await M.shot('two genotypes');
      await T.run('Cross Mode');
      if (!window._flyCrossMode) throw new Error('Cross Mode did not turn on');
      const api = M.api;
      for (let i = 0; i < 150 && api.getAppState().activeTool.type !== 'line'; i++) await sleep(20);
      const frameOf = n => F.els(n, 'genotype-frame')[0];
      const f1 = frameOf('P1'), f2 = frameOf('P2');
      const y = f1.y + f1.height / 2, x1 = f1.x + f1.width - 12, x2 = f2.x + 12;
      // The mode polls every 250 ms and removes the line when it sees it; the
      // frame counts only if the line is still there once the capture is done.
      let ok = false;
      for (let attempt = 0; attempt < 4 && !ok; attempt++) {
        const ea = F.view();
        ea.clear();
        ea.style.strokeColor = '#e03131'; ea.style.strokeStyle = 'dashed'; ea.style.opacity = 20; ea.style.strokeWidth = 3; ea.style.roughness = 0;
        const id = ea.addLine([[x1, y], [x2, y]]);
        await ea.addElementsToView(false, false, false);
        const live = () => api.getSceneElements().find(e => e.id === id && !e.isDeleted);
        await M.shot('cross line drawn (Cross Mode on)', { fast: true });
        ok = !!live();
        if (!ok) {
          T.out('note: cross line removed before the capture finished; retrying');
          const p = await M.picker();
          window._crossGenotypesLastResult = undefined;
          p.modal.close(); // skips this cross; the mode stays on
          await waitFor(() => window._crossGenotypesLastResult !== undefined, 'cancelled cross');
          await sleep(600);
          M.dropLast();
        }
      }
      if (!ok) throw new Error('could not capture the cross line');
      const p = await M.picker();
      await M.shot('picker opens with the two as parents');
      M.pickCard('II', 'UAS-GFP', '+');
      M.pickCard('III', '+', 'TM6B');
      M.setInput(p.labelInput, 'F1');
      await M.shot('cards picked, label F1');
      const t0 = window._tidyLastResult;
      window._crossGenotypesLastResult = undefined;
      M.button(p.modal.contentEl, 'OK').click();
      await waitFor(() => window._crossGenotypesLastResult, 'cross result');
      await waitFor(() => window._tidyLastResult !== t0, 'Tidy after the cross');
      await sleep(400);
      window._flyCrossMode?.stop?.();
      await sleep(200);
      F.deselect();
      await M.fit(F.live(), { maxZoom: 1.4 });
      await M.shot('offspring drawn');
    },

    async tidy(T, F, M) {
      await T.fixture('below');
      T.setup(['P1', 'P2', 'A', 'B', 'P3', 'C', 'D', 'P4', 'E']);
      const c = n => { const b = F.view().getBoundingBox(F.els(n, 'genotype-allele')); return [b.topX + b.width / 2, b.topY + b.height / 2]; };
      const [ox, oy] = c('P1');
      await F.move({
        P1: [ox + 520, oy + 40], P2: [ox - 40, oy + 170], A: [ox + 700, oy + 330], B: [ox - 20, oy + 420],
        P3: [ox + 250, oy - 60], C: [ox + 330, oy + 560], D: [ox + 900, oy + 620], P4: [ox + 20, oy + 690], E: [ox + 560, oy + 820],
      });
      F.deselect();
      await M.fit(F.live());
      await M.shot('messy pedigree');
      await T.tidyAll();
      F.deselect();
      await M.fit(F.live());
      await M.shot('after Tidy');
      const [ax, ay] = c('A');
      await F.move({ C: [ax + 420, ay + 260], D: [ax - 380, ay + 360], E: [ax + 60, ay + 520], P4: [ax - 260, ay + 170] });
      F.deselect();
      await M.fit(F.live());
      await M.shot("A's branch scrambled");
      M.selectGenos(['A']);
      await M.shot('A selected');
      F.deselect();
      F.select(['A']);
      await T.run('Tidy Below');
      F.deselect();
      await M.fit(F.live());
      await M.shot('after Tidy Below');
    },

    async 'break-cross'(T, F, M) {
      await T.fixture('sibling-order');
      T.setup(['P1', 'P2', 'A', 'B']);
      F.deselect();
      await M.fit(F.live(), { maxZoom: 2.4 });
      await M.shot('cross with two offspring');
      M.selectGenos(['A']);
      await M.shot('offspring A selected');
      await T.run('Break Cross');
      await M.shot('after Break Cross');
      F.deselect();
      await M.shot('A standalone');
      const lineage = () => F.live().filter(e => e.customData?.kind === 'cross-lineage' && e.customData.childGenotypeId === window.__t.A);
      M.undo();
      await waitFor(() => lineage().length, 'undo to restore the arrow into A');
      F.deselect();
      await M.shot('after undo');
    },

    // Fixture select-move: P1 x P2 -> A, B, C; A x P3 -> D, E. Selects A, runs Select Below, then
    // drags the selection with real pointer events on Excalidraw's interactive
    // canvas (so Excalidraw moves it and re-routes the bound arrow into A
    // itself), one frame per pointermove. Verifies the bindings after the drop.
    async 'select-move'(T, F, M) {
      await T.fixture('select-move');
      T.setup(['P1', 'P2', 'A', 'B', 'C', 'P3', 'D', 'E']);
      T.out(F.layout());
      for (const g of ['A', 'D', 'E']) T.out(g + ': ' + F.els(g, 'genotype-allele').map(e => e.originalText).join(' '));
      const api = M.api, N = window.__t;
      const kind = k => F.live().filter(e => e.customData?.kind === k);
      const frameOf = g => kind('genotype-frame').find(e => e.customData.genotypeId === g);
      const glyphOf = (m, f) => kind('cross-glyph').find(e => e.customData.parents.maternal === m && e.customData.parents.paternal === f);
      const arrowInto = g => F.live().filter(e => e.type === 'arrow' && e.customData?.kind === 'cross-lineage' && e.customData.childGenotypeId === g);

      // The subtree Select Below should pick: A, P3, D, E and the furniture of
      // the A x P3 cross.
      const sub = ['A', 'P3', 'D', 'E'].map(n => N[n]);
      const want = F.live().filter(e => {
        const cd = e.customData;
        if (cd?.genotypeId) return sub.includes(cd.genotypeId);
        if (cd?.kind === 'cross-glyph') return cd.parents.maternal === N.A;
        if (cd?.kind === 'cross-lineage' || cd?.kind === 'cross-criterion') return [N.D, N.E].includes(cd.childGenotypeId);
        return false;
      });

      // The drag: the subtree of A ends up (DX, DY) scene px away, toward the
      // side A sits on; on the way it dips DIP px lower. Excalidraw elbows the
      // dropped arrow into A down from the x, across halfway between the x
      // and A, then down into A; the first leg runs through the middle sibling
      // unless the crossing lies above A's old row, so DY keeps it 30 px above
      // that row. DX is a share of the pedigree's width (so the move reads the
      // same at any zoom), and DIP is what makes the area the drag sweeps as
      // tall as the crop box's shape asks for (within bounds).
      // Visible extent (frames are drawn only while selected; the subtree's
      // box keeps them, as it is selected while it moves).
      const all = F.view().getBoundingBox(F.live().filter(e => e.customData?.kind !== 'genotype-frame'));
      const sb = F.view().getBoundingBox(want);
      const a0 = frameOf(N.A), x0 = glyphOf(N.P1, N.P2);
      const left = a0.x + a0.width / 2 < all.topX + all.width / 2;
      const rowTop = Math.min(...kind('genotype-frame').filter(f => f.y < a0.y + a0.height && f.y + f.height > a0.y).map(f => f.y));
      const DX = (left ? -1 : 1) * Math.round(0.2 * all.width);
      const DY = Math.max(0, Math.floor(2 * (rowTop - 30) - (x0.y + x0.height) - a0.y));
      const MARGIN = 36; // CSS px around the swept area (selection handles)
      // Union of the pedigree and the subtree at every point of the path.
      const swept = dip => {
        let x1 = all.topX, y1 = all.topY, x2 = all.topX + all.width, y2 = all.topY + all.height;
        for (let i = 0; i <= 40; i++) {
          const t = i / 40, px = DX * t, py = DY * t + dip * Math.sin(Math.PI * t);
          x1 = Math.min(x1, sb.topX + px); x2 = Math.max(x2, sb.topX + sb.width + px);
          y1 = Math.min(y1, sb.topY + py); y2 = Math.max(y2, sb.topY + sb.height + py);
        }
        return { topX: x1, topY: y1, width: x2 - x1, height: y2 - y1 };
      };
      const c = M.box(), aspect = (c.h - 2 * MARGIN) / (c.w - 2 * MARGIN);
      let DIP = Math.round(0.15 * all.height);
      while (DIP < 0.8 * all.height && swept(DIP).height < swept(DIP).width * aspect) DIP += 5;
      const path = t => [DX * t, DY * t + DIP * Math.sin(Math.PI * t)];
      const room = swept(DIP);
      T.out('drag: DX ' + DX + ', DY ' + DY + ', DIP ' + DIP + ', swept ' + [room.width, room.height].map(Math.round));
      F.deselect();
      await M.fit(null, { b: room, maxZoom: 4, margin: MARGIN });
      T.out('zoom ' + api.getAppState().zoom.value.toFixed(3));
      await M.shot('pedigree');
      M.selectGenos(['A']);
      await M.shot('A selected');
      window._flySelectResult = undefined;
      await T.run('Select Below');
      const sel = () => { const s = api.getAppState().selectedElementIds; return new Set(Object.keys(s).filter(k => s[k])); };
      const into = arrowInto(N.A);
      if (into.length !== 1) throw new Error(into.length + ' arrows into A');
      const seedArrow = into[0];
      const picked = sel();
      if (picked.has(seedArrow.id)) throw new Error('Select Below selected the arrow into A');
      const missing = want.filter(e => !picked.has(e.id)).map(e => e.customData.kind);
      const extra = [...picked].filter(id => !want.some(e => e.id === id));
      T.pass(!missing.length && !extra.length, 'Select Below selected the subtree of A (' + picked.size + ' elements), not the arrow into A',
        'Select Below selection: missing ' + JSON.stringify(missing) + ', extra ' + extra.length);
      await M.shot('after Select Below');

      // Real drag: pointerdown on the center of one of A's alleles (selected),
      // eased pointermoves, pointerup, dispatched on the interactive canvas.
      const canvas = M.container().querySelector('canvas.interactive') ?? [...M.container().querySelectorAll('canvas')].at(-1);
      const toClient = (sx, sy) => { const st = api.getAppState(), z = st.zoom.value; return [(sx + st.scrollX) * z + st.offsetLeft, (sy + st.scrollY) * z + st.offsetTop]; };
      const allele = F.els('A', 'genotype-allele').find(e => picked.has(e.id));
      const sx = allele.x + allele.width / 2, sy = allele.y + allele.height / 2;
      const pe = (type, [x, y], buttons) => canvas.dispatchEvent(new PointerEvent(type, {
        clientX: x, clientY: y, screenX: x, screenY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true,
        button: 0, buttons, bubbles: true, cancelable: true, composed: true, view: window,
      }));
      const beforeA = { x: a0.x, y: a0.y };
      const firstDrag = M.count() + 1;
      pe('pointermove', toClient(sx, sy), 0);
      pe('pointerdown', toClient(sx, sy), 1);
      await sleep(30);
      const STEPS = 26;
      const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      for (let i = 1; i <= STEPS; i++) {
        const [px, py] = path(ease(i / STEPS));
        pe('pointermove', toClient(sx + px, sy + py), 1);
        await M.shot('drag ' + i + '/' + STEPS, { fast: true });
      }
      pe('pointerup', toClient(sx + DX, sy + DY), 0);
      await sleep(200);
      const lastDrag = M.count();

      // The drag moved the selection (Excalidraw did it, not the script API).
      const a1 = frameOf(N.A);
      const mdx = a1.x - beforeA.x, mdy = a1.y - beforeA.y;
      T.pass(Math.abs(mdx - DX) < 25 && Math.abs(mdy - DY) < 25, 'drag moved A by ' + [mdx, mdy].map(Math.round) + ' (asked ' + [DX, DY] + ')',
        'drag did not move A as asked: ' + [mdx, mdy].map(Math.round) + ' vs ' + [DX, DY]);

      // Bindings after the drop.
      const seed = F.live().find(e => e.id === seedArrow.id);
      const xg = glyphOf(N.P1, N.P2), fa = frameOf(N.A);
      const bad = [];
      if (!seed) bad.push('arrow into A is gone');
      else {
        if (seed.startBinding?.elementId !== xg?.id) bad.push('start bound to ' + seed.startBinding?.elementId + ', not the P1 x P2 x');
        if (seed.endBinding?.elementId !== fa?.id) bad.push('end bound to ' + seed.endBinding?.elementId + ', not A frame');
        const p0 = [seed.x + seed.points[0][0], seed.y + seed.points[0][1]], pn = [seed.x + seed.points.at(-1)[0], seed.y + seed.points.at(-1)[1]];
        const t0 = [xg.x + xg.width / 2, xg.y + xg.height], tn = [fa.x + fa.width / 2, fa.y];
        const d0 = Math.hypot(p0[0] - t0[0], p0[1] - t0[1]), dn = Math.hypot(pn[0] - tn[0], pn[1] - tn[1]);
        T.out('arrow into A: start ' + p0.map(Math.round) + ' (x bottom middle ' + t0.map(Math.round) + ', off ' + d0.toFixed(2) + ' px), end '
          + pn.map(Math.round) + ' (A frame top middle ' + tn.map(Math.round) + ', off ' + dn.toFixed(2) + ' px), elbowed ' + !!seed.elbowed
          + ', points ' + JSON.stringify(seed.points.map(p => p.map(Math.round))));
        if (dn > 3) bad.push('end ' + dn.toFixed(1) + ' px from A frame top middle');
        if (d0 > 3) bad.push('start ' + d0.toFixed(1) + ' px from the x bottom middle');
      }
      T.pass(!bad.length, 'arrow into A still bound (P1 x P2 x -> A frame) and ends on the frame top middle', 'arrow into A after the drag: ' + bad.join('; '));
      T.check(F.arrows());
      T.check(F.cut());
      T.check(F.overlaps());
      if (bad.length) throw new Error('arrow into A did not follow the drag; not making the GIF');

      F.deselect();
      await M.shot('dropped');
      const n = M.count();
      const delays = Array.from({ length: n }, (_, i) => i + 1 >= firstDrag && i + 1 <= lastDrag ? 5 : 120);
      delays[n - 1] = 250;
      const mid = Math.round((firstDrag + lastDrag) / 2);
      const review = [...Array(firstDrag - 1).keys()].map(i => i + 1).concat([firstDrag, Math.round((firstDrag + mid) / 2), mid, lastDrag, n]);
      M.writeMeta(delays, [...new Set(review)]);
    },
  };

  async function run(T, F, gif) {
    if (!GIFS[gif]) throw new Error('unknown gif ' + gif);
    const M = await make(T, F, gif);
    try {
      await GIFS[gif](T, F, M);
      T.pass(true, gif + ' captured');
    } finally {
      // Never leave a script modal or Cross Mode behind.
      window._genotypeFormModal?.modal?.close();
      window._crossGenotypesModal?.modal?.close();
      window._flyCrossMode?.stop?.();
      M.cleanup();
    }
  }

  return { run, GIFS: Object.keys(GIFS) };
})();
1
