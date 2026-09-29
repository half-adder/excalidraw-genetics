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

    return { view, api, fit, shot, dropLast, cleanup, setInput, button, genoForm, picker, pickCard, geno, besides, selectGenos, undo, box };
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
