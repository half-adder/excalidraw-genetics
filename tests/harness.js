// In-Obsidian test harness. lib.sh loads checks.js, scenarios.js and this
// file with (0, eval) and calls window.__flyT.start(opts), which runs one
// test body (an async function of T) in a shared throwaway drawing and writes
// its output lines, then END, to opts.out.
//
// Scripts run through the Excalidraw Script Engine's executeScriptFile, which
// the harness wraps to count runs in flight; T.run waits until none are left,
// so the Tidy that Cross Genotypes and Tidy Below start is waited on too, and
// errors thrown by any script are recorded.
window.__flyT = (() => {
  const fs = require('fs');
  const crypto = require('crypto');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const DRAWING = 'Excalidraw/_test-harness.excalidraw.md';
  const SCRIPTS = ['Genotype', 'Cross Genotypes', 'Tidy', 'Select Below', 'Select Lineage', 'Tidy Below', 'Cross Mode', 'Break Cross', 'Update Fly Genetics'];
  const FIXTURE_SCRIPTS = ['Genotype', 'Cross Genotypes', 'Tidy'];
  // Plugin-engine fixture hash source: only the src/ files that can change
  // what the Genotype, Cross Genotypes and Tidy commands build (their
  // transitive dependencies), read in this fixed sorted order. Hashing all
  // of main.js instead made every plugin change (e.g. migration or font-offer
  // code, unrelated to drawing) mark every fixture stale, which rebuilt them
  // with new random genotype ids on the next test run (fixture churn, and
  // occasional sibling-order flips since ties break on random ids).
  // Deliberately excluded: src/main.ts (first-load wiring), src/first-load.ts,
  // src/migration.ts, src/settings.ts, src/font/, src/testing.ts, and the
  // other commands (select.ts, tidy-below.ts, cross-mode.ts, break-cross.ts)
  // the three fixture scenarios never call. A new drawing module must be
  // added here on purpose.
  const FIXTURE_SRC = [
    'src/backcross/index.ts',
    'src/backcross/plan.ts',
    'src/commands/cross-genotypes.ts',
    'src/commands/env.ts',
    'src/commands/genotype.ts',
    'src/commands/index.ts',
    'src/commands/tidy.ts',
    'src/constants.ts',
    'src/duplicates/index.ts',
    'src/duplicates/plan.ts',
    'src/excalidraw/ea.ts',
    'src/excalidraw/version.ts',
    'src/forms/cross-picker.ts',
    'src/forms/genotype-form.ts',
    'src/forms/picker-options.ts',
    'src/hooks.ts',
    'src/layout/index.ts',
    'src/operation/excalidraw.ts',
    'src/operation/index.ts',
    'src/operation/pure.ts',
    'src/render/index.ts',
    'src/scene/geometry.ts',
    'src/scene/graph.ts',
    'src/scene/index.ts',
    'src/scene/snapshot.ts',
    'src/schema/index.ts',
  ];
  const plugin = () => app.plugins.plugins['obsidian-excalidraw-plugin'];
  const sha = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

  const COMMANDS = SCRIPTS.filter(n => n !== 'Update Fly Genetics');
  const SCRIPT_ONLY = ['Install Fly Genetics', 'Update Fly Genetics'];
  const fly = () => app.plugins.plugins['fly-genetics'];
  // Full command id of a display name: kebab-case, as in src/commands/index.ts.
  const cid = name => 'fly-genetics:' + name.toLowerCase().replace(/ /g, '-');
  // Reloads the fly-genetics plugin when this checkout's main.js changed since
  // the last load (disable/enable reads main.js again; Obsidian itself is
  // never reloaded), then waits for its commands.
  async function reloadPlugin(repo) {
    const text = fs.readFileSync(repo + '/main.js', 'utf8');
    if (window.__flyPluginText !== text || !fly()) {
      await app.plugins.disablePlugin('fly-genetics');
      await app.plugins.enablePlugin('fly-genetics');
      window.__flyPluginText = text;
    }
    const missing = () => COMMANDS.filter(n => !app.commands.commands[cid(n)]);
    for (let i = 0; i < 100 && !(fly() && !missing().length); i++) await sleep(20);
    if (!fly()) throw new Error('fly-genetics plugin did not load');
    if (missing().length) throw new Error('fly-genetics loaded without its commands: ' + missing().join(', '));
  }

  let inflight = 0;
  const errors = [];

  // Wraps executeScriptFile (called synchronously by every script command)
  // to count runs in flight and record errors.
  function track() {
    const se = plugin().scriptEngine;
    if (se.__flyOrig) return;
    const orig = se.executeScriptFile;
    se.__flyOrig = orig;
    se.executeScriptFile = function (view, file, name, ...rest) {
      // Scripts run exactly as at full speed: a script started by another one
      // (Cross Genotypes starting Tidy, Tidy Below starting Select Below and
      // Tidy) is not delayed, so selection-timing races show up in tests.
      inflight++;
      const p = orig.call(this, view, file, name, ...rest);
      Promise.resolve(p).then(
        () => { inflight--; },
        e => { inflight--; errors.push((name ?? file?.basename) + ': ' + (e?.message ?? e)); });
      return p;
    };
  }
  function untrack() {
    const se = plugin().scriptEngine;
    if (!se.__flyOrig) return;
    se.executeScriptFile = se.__flyOrig;
    delete se.__flyOrig;
  }

  // Waits for Excalidraw to render (updateScene state lands on render).
  const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  // Waits until the selection last set through F.select / F.deselect is in
  // the app state (up to 60 frames).
  async function selectionLanded(api) {
    const want = window.__flyWant;
    if (!want) return;
    for (let i = 0; i < 60; i++) {
      const sel = api.getAppState().selectedElementIds;
      const n = Object.keys(sel).filter(k => sel[k]).length;
      if (want.length ? want.every(id => sel[id]) : n === 0) break;
      await frame();
    }
    window.__flyWant = undefined;
  }

  // Waits until no script has been running for 30 ms.
  async function idle(ms = 20000) {
    const t0 = Date.now();
    let calm = 0;
    while (Date.now() - t0 < ms) {
      calm = inflight === 0 ? calm + 1 : 0;
      if (calm >= 3) return;
      await sleep(10);
    }
    throw new Error('scripts still running after ' + ms + ' ms');
  }

  // Re-saves scripts whose file changed since the last reload so the Script
  // Engine drops its cached copy (it caches scripts edited outside Obsidian).
  async function reloadScripts(list = SCRIPTS) {
    const seen = (window.__flyScriptText ??= {});
    for (const n of list) {
      const f = app.vault.getAbstractFileByPath('Excalidraw/Scripts/' + n + '.md');
      if (!f) throw new Error('script missing: ' + n);
      const txt = await app.vault.adapter.read(f.path);
      if (seen[n] === txt) continue;
      await app.vault.modify(f, txt);
      seen[n] = txt;
    }
    for (let i = 0; i < 100 && !list.every(n => app.commands.commands['obsidian-excalidraw-plugin:' + n]); i++) await sleep(20);
  }

  // Opens (creating if needed) the shared throwaway drawing and makes it the
  // active view.
  async function ensureView() {
    const find = () => app.workspace.getLeavesOfType('excalidraw').find(l => l.view?.file?.path === DRAWING);
    let leaf = find();
    if (!leaf) {
      if (!app.vault.getAbstractFileByPath(DRAWING)) {
        const ea = ExcalidrawAutomate;
        ea.reset();
        ea.create({ filename: '_test-harness', foldername: 'Excalidraw', onNewPane: true }); // does not always resolve
        for (let i = 0; i < 200 && !find(); i++) await sleep(25);
      } else {
        leaf = app.workspace.getLeaf('tab');
        await leaf.setViewState({ type: 'excalidraw', state: { file: DRAWING }, active: true });
      }
      leaf = find();
    }
    if (!leaf) throw new Error('could not open ' + DRAWING);
    app.workspace.setActiveLeaf(leaf, { focus: true });
    for (let i = 0; i < 200; i++) {
      const v = leaf.view;
      if (v.excalidrawAPI && app.workspace.getActiveViewOfType(v.constructor) === v) break;
      await sleep(25);
    }
    window.__flyDrawing = DRAWING;
    return leaf.view;
  }

  // Closes and deletes the shared throwaway drawing and its exported .svg
  // (only these fixed paths), retrying once if Excalidraw re-saves it just
  // after it is deleted. Deleted outright, not sent to the system trash, so
  // test runs leave nothing in the user's Trash.
  async function trashDrawing() {
    const ps = [DRAWING, 'Excalidraw/_test-harness.excalidraw.svg', 'Excalidraw/_test-harness.svg'];
    const has = () => ps.filter(p => app.vault.getAbstractFileByPath(p));
    const go = async () => {
      for (const p of ps) for (const t of ['excalidraw', 'markdown'])
        app.workspace.getLeavesOfType(t).filter(l => l.view?.file?.path === p).forEach(l => l.detach());
      await sleep(300);
      for (const p of has()) try { await app.vault.delete(app.vault.getAbstractFileByPath(p)); } catch (e) {}
    };
    await go();
    await sleep(800);
    if (has().length) { await go(); await sleep(500); }
    window.__flyDrawing = undefined;
    return has();
  }

  function makeT(opts, lines, view) {
    const F = window.__fly;
    const api = () => view.excalidrawAPI;
    const T = { F, lines, repo: opts.repo, engine: opts.engine };
    T.out = s => { lines.push(String(s)); };
    T.check = s => { lines.push(s ? String(s) : 'FAIL: check returned nothing'); };
    T.pass = (ok, pass, fail) => T.check((ok ? 'PASS: ' : 'FAIL: ') + (ok ? pass : fail));

    // Replaces the scene with `elements`, nothing selected, with an empty
    // undo history (as in a freshly opened drawing).
    // Versions are raised above every version already in the scene: a
    // reloaded element at its old version would look unchanged to the undo
    // store, which then leaves it out of the next undo step.
    T.load = elements => {
      const base = Math.max(0, ...api().getSceneElementsIncludingDeleted().map(e => e.version ?? 0)) + 1;
      const fresh = structuredClone(elements).map(e => ({ ...e, version: (e.version ?? 1) + base, versionNonce: Math.floor(Math.random() * 2 ** 31) }));
      api().updateScene({ elements: fresh, appState: { selectedElementIds: {}, selectedGroupIds: {} }, captureUpdate: 'NEVER' });
      api().history?.clear?.();
      window._flyCrossMode?.stop?.();
    };
    T.empty = () => { T.load([]); window.__t = {}; };

    // Copies a drawing's saved elements (read only) into the scene.
    T.copyDrawing = async path => {
      const f = app.vault.getAbstractFileByPath(path);
      if (!f) throw new Error('missing drawing ' + path);
      const scene = await ExcalidrawAutomate.getSceneFromFile(f);
      T.load(scene.elements.filter(e => !e.isDeleted));
      window.__t = {};
    };

    // Runs a script or plugin command (and whatever it starts) to completion.
    // Errors thrown by any script/command fail the test unless tolerate is
    // set; they are returned. Only the named script-only tools (the scripts'
    // installer and updater) run as scripts on the plugin engine; any other
    // name that is not a plugin command fails there instead of silently
    // running a same-named script.
    T.run = async (name, { tolerate = false } = {}) => {
      await selectionLanded(api()); // updateScene state lands on the next render
      let errs;
      if (opts.engine === 'plugin' && !COMMANDS.includes(name) && !SCRIPT_ONLY.includes(name))
        throw new Error('not a plugin command: ' + name);
      if (opts.engine === 'plugin' && COMMANDS.includes(name)) {
        const P = fly(), e0 = P.testing.errors.length, cmd = app.commands.commands[cid(name)];
        if (!cmd) throw new Error('no command ' + name);
        if (!cmd.checkCallback(true)) throw new Error('command not available: ' + name);
        app.commands.executeCommandById(cid(name));
        await P.testing.idle();
        if (window.__flyGap) await sleep(window.__flyGap);
        errs = P.testing.errors.slice(e0);
      } else {
        if (opts.engine === 'plugin') {
          if (SCRIPTS.includes(name)) await reloadScripts([name]);
          track();
        }
        const f = app.vault.getAbstractFileByPath('Excalidraw/Scripts/' + name + '.md');
        if (!f) throw new Error('no script ' + name);
        const e0 = errors.length;
        plugin().scriptEngine.executeScriptFile(view, f, name);
        await idle();
        if (window.__flyGap) await sleep(window.__flyGap);
        errs = errors.slice(e0);
      }
      if (errs.length && !tolerate) throw new Error('script error: ' + errs.join('; '));
      return errs;
    };
    // Starts a script or command without waiting for it (a test that drives a
    // real form polls its own result). The scripts engine calls the untracked
    // executeScriptFile, as genotype-form-flip.sh did.
    T.launch = async name => {
      await selectionLanded(api());
      if (opts.engine === 'plugin') {
        if (!app.commands.commands[cid(name)]?.checkCallback(true)) throw new Error('command not available: ' + name);
        app.commands.executeCommandById(cid(name));
        return;
      }
      const se = plugin().scriptEngine, f = app.vault.getAbstractFileByPath('Excalidraw/Scripts/' + name + '.md');
      if (!f) throw new Error('no script ' + name);
      (se.__flyOrig || se.executeScriptFile).call(se, view, f, name);
    };
    // Fails the test unless every named genotype is in window.__t.
    T.setup = names => { const r = F.missing(names); if (r !== 'ok') throw new Error(r.replace('FAIL: ', '')); };
    T.deselect = () => F.deselect();
    T.select = (names, all) => F.select(names, all);
    T.tidy = () => T.run('Tidy');
    T.tidyAll = () => { F.deselect(); return T.run('Tidy'); };
    T.move = (spots, abs) => F.move(spots, abs);

    const gids = () => new Set(F.live().filter(e => e.customData?.genotypeId).map(e => e.customData.genotypeId));
    const noteErrs = (what, errs) => errs.forEach(e => T.out('note: ' + what + ' threw: ' + e));

    // Build steps. A script error here is noted, not fatal, as in the
    // original sleep-based builds; the new genotype is found by its id.
    T.genotype = async (name, auto) => {
      F.deselect();
      const before = gids();
      window._genotypeLastResult = undefined;
      window._genotypeAuto = auto;
      const errs = await T.run('Genotype', { tolerate: true });
      noteErrs('Genotype ' + name, errs);
      const fresh = [...gids()].filter(g => !before.has(g));
      const g = window._genotypeLastResult || (fresh.length === 1 ? fresh[0] : null);
      if (!g) throw new Error('Genotype ' + name + ' made no genotype');
      window.__t[name] = g;
      T.buildErrors.push(...errs.map(e => 'Genotype ' + name + ': ' + e));
    };
    T.cross = async (name, m, f, auto) => {
      F.select([m, f]);
      const t0 = window._tidyLastResult;
      window._crossGenotypesLastResult = undefined;
      window._crossGenotypesAuto = auto;
      const errs = await T.run('Cross Genotypes', { tolerate: true });
      noteErrs('Cross ' + name, errs);
      const g = window._crossGenotypesLastResult
        || F.live().find(e => e.customData?.kind === 'genotype-label' && e.originalText === auto.labelText)?.customData.genotypeId;
      if (!g) throw new Error('Cross Genotypes ' + name + ' made no offspring');
      if (window._tidyLastResult === t0) T.out('note: Cross ' + name + ' did not run Tidy');
      window.__t[name] = g;
      T.buildErrors.push(...errs.map(e => 'Cross ' + name + ': ' + e));
    };
    T.buildErrors = [];

    // Checks that `op` moves nothing (frames, allele boxes, x glyphs).
    T.unmoved = async (what, op) => { F.snapSave(); await op(); T.check(F.unmoved(what)); };

    // ---- Fixtures ------------------------------------------------------------
    const engineText = () => opts.engine === 'plugin'
      ? FIXTURE_SRC.map(p => fs.readFileSync(opts.repo + '/' + p, 'utf8')).join('\u0000')
      : FIXTURE_SCRIPTS.map(n => fs.readFileSync(opts.repo + '/scripts/' + n + '.md', 'utf8')).join('\u0000');
    const fixtureHash = s => sha(engineText() + window.__flyScenarios[s].toString() + JSON.stringify(window.__flyFounders));
    // Element and group ids are renumbered q0000001..., g0000001... (in scene
    // order): stable across rebuilds, and random ids can no longer spell
    // words by chance. Ids appear in the text only as quoted strings.
    const renumber = text => {
      const els = api().getSceneElements().filter(e => !e.isDeleted);
      const map = new Map();
      els.forEach((e, i) => map.set(e.id, 'q' + String(i + 1).padStart(7, '0')));
      let g = 0;
      for (const e of els) for (const id of e.groupIds ?? []) if (!map.has(id)) map.set(id, 'g' + String(++g).padStart(7, '0'));
      return text.replace(/"([^"\\]{1,64})"/g, (m, id) => map.has(id) ? '"' + map.get(id) + '"' : m);
    };
    T.buildFixture = async s => {
      const t0 = Date.now();
      T.empty();
      T.buildErrors = [];
      await window.__flyScenarios[s](T);
      F.deselect();
      const elements = api().getSceneElements().filter(e => !e.isDeleted);
      const dir = opts.repo + '/tests/fixtures';
      fs.mkdirSync(dir, { recursive: true });
      // Plain JSON, one element per line (readable, diffs by element).
      const j = JSON.stringify;
      const text = '{\n'
        + ' "hash": ' + j(fixtureHash(s)) + ',\n'
        + ' "names": ' + j(window.__t, null, 2).replace(/\n/g, '\n ') + ',\n'
        + ' "buildErrors": ' + j(T.buildErrors) + ',\n'
        + ' "elements": [\n' + elements.map(e => '  ' + j(e)).join(',\n') + '\n ]\n}\n';
      fs.writeFileSync(dir + '/' + s + '.json', renumber(text));
      T.out('built fixture ' + s + ' (' + elements.length + ' elements, ' + (Date.now() - t0) + ' ms)');
    };
    // Loads fixture `s` into the scene, rebuilding it first if it is missing
    // or was built with other scripts or build steps.
    T.fixture = async s => {
      const p = opts.repo + '/tests/fixtures/' + s + '.json';
      let fx = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
      if (!fx || (!opts.frozen && fx.hash !== fixtureHash(s))) {
        T.out('(fixture ' + s + (fx ? ' stale' : ' missing') + ': rebuilding)');
        await T.buildFixture(s);
        fx = JSON.parse(fs.readFileSync(p, 'utf8'));
      }
      T.load(fx.elements);
      window.__t = { ...fx.names };
    };
    return T;
  }

  // opts: {name, out, repo, body (file with the test body), keep}
  async function start(opts) {
    const lines = [];
    const t0 = Date.now();
    try {
      if (opts.engine === 'plugin') await reloadPlugin(opts.repo); else await reloadScripts();
      const view = await ensureView();
      if (opts.engine !== 'plugin') track();
      window.__t = {};
      const T = makeT(opts, lines, view);
      const body = new (async () => {}).constructor('T', 'F', fs.readFileSync(opts.body, 'utf8'));
      await body(T, T.F);
      await idle();
    } catch (e) {
      lines.push('FAIL: ' + (e?.message ?? e));
    } finally {
      try { fly()?.testing?.closeModals?.(); } catch (e) {}
      untrack();
      window._flyCrossMode?.stop?.();
      if (!opts.keep) {
        const left = await trashDrawing();
        if (left.length) lines.push('warning: could not trash ' + left.join(', '));
      }
      lines.push('(in Obsidian: ' + (Date.now() - t0) + ' ms)');
      fs.writeFileSync(opts.out, lines.join('\n') + '\nEND\n');
    }
    return 1;
  }

  return { start, trashDrawing, DRAWING };
})();
1
