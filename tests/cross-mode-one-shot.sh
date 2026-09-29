#!/usr/bin/env bash
# Cross Mode is one-shot: after a cross line produces an offspring, the mode
# turns itself off (line tool unlocked, stroke style restored).
# Creates two genotypes, turns Cross Mode on, draws a cross line between them
# (the cross commits through its test hook), then checks the offspring exists
# and the mode is off. Prints PASS or FAIL; exit 0 on PASS.
source "$(dirname "$0")/lib.sh"
fly_test <<'JS'
T.empty();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms = 8000) => { for (let t = 0; t < ms; t += 50) { if (f()) return true; await sleep(50); } return false; };
const make = async (at, g) => {
  F.deselect();
  window._genotypeCreateAt = at;
  window._genotypeAuto = g;
  await T.run('Genotype');
  return window._genotypeLastResult;
};
const P1 = await make({ x: 0, y: 0 }, { glyph: '♀', X: { top: 'w', bottom: 'w' }, II: { top: 'Sp', bottom: 'CyO' }, III: { top: '', bottom: '' } });
const P2 = await make({ x: 700, y: 0 }, { glyph: '♂', X: { top: 'w', bottom: 'Y' }, II: { top: 'Gla', bottom: 'Bc' }, III: { top: '', bottom: '' } });
F.deselect();
const ea = F.view();
const api = ea.targetView.excalidrawAPI;
const prevColor = api.getAppState().currentItemStrokeColor;
const prevLocked = !!api.getAppState().activeTool.locked;
await T.run('Cross Mode');
if (!window._flyCrossMode) throw new Error('Cross Mode did not turn on');
await until(() => api.getAppState().activeTool.type === 'line', 3000);

// The cross commits without the picker via its test hook.
window._crossGenotypesAuto = { offspringGlyph: null, pick: { X: 0, II: 0, III: 0 } };
window._crossGenotypesLastResult = undefined;
const frame = gid => api.getSceneElements().find(e => !e.isDeleted && e.customData?.genotypeId === gid && e.customData.kind === 'genotype-frame');
const f1 = frame(P1), f2 = frame(P2);
const y = f1.y + f1.height / 2;
ea.clear();
ea.style.strokeColor = '#e03131'; ea.style.strokeStyle = 'dashed'; ea.style.opacity = 20; ea.style.roughness = 0;
ea.addLine([[f1.x + f1.width - 12, y], [f2.x + 12, y]]);
await ea.addElementsToView(false, false, false);

const crossed = await until(() => window._crossGenotypesLastResult !== undefined);
const child = window._crossGenotypesLastResult;
T.pass(crossed && !!child && api.getSceneElements().some(e => !e.isDeleted && e.customData?.genotypeId === child && e.customData.parents),
  'the cross line produced an offspring', 'no offspring (result ' + JSON.stringify(child) + ')');

const off = await until(() => !window._flyCrossMode, 4000);
const st = api.getAppState();
const toolOk = st.activeTool.type === 'selection' && !!st.activeTool.locked === prevLocked;
const colorOk = st.currentItemStrokeColor === prevColor;
const msg = 'after the cross: mode ' + (off ? 'off' : 'ON') + ', tool ' + st.activeTool.type + (st.activeTool.locked ? ' (locked)' : '') + (prevLocked ? ', lock was on before' : '') + ', stroke ' + (colorOk ? 'restored' : 'still ' + st.currentItemStrokeColor);
T.pass(off && toolOk && colorOk, msg, msg);
window._flyCrossMode?.stop();
JS
