#!/usr/bin/env bash
# Regression test: pressing Esc in the drawing leaves Cross Mode.
# In an empty throwaway drawing, turns Cross Mode on, dispatches an Escape
# keydown on the drawing, and checks that the mode is off, the line tool is
# no longer locked on, and the previous stroke style is restored.
# Prints PASS or FAIL; exit 0 on PASS.
source "$(dirname "$0")/lib.sh"
fly_test <<'JS'
T.empty();
const ea = F.view();
const api = ea.targetView.excalidrawAPI;
const prevColor = api.getAppState().currentItemStrokeColor;
await T.run('Cross Mode');
if (!window._flyCrossMode) throw new Error('Cross Mode did not turn on');
// Cross Mode arms the line tool with setActiveTool, which lands on a later render.
for (let i = 0; i < 150 && api.getAppState().activeTool.type !== 'line'; i++) await new Promise(r => setTimeout(r, 20));
T.out('after enabling: mode/tool = ' + (!!window._flyCrossMode) + ' ' + api.getAppState().activeTool.type);
const c = ea.targetView.contentEl.querySelector('.excalidraw');
(c.querySelector('canvas.interactive') || c).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
// Poll up to 3 s for the mode to switch off and the tool and stroke to be restored.
let st, off, toolOk, colorOk;
for (let i = 0; i < 150; i++) {
  st = api.getAppState(); off = !window._flyCrossMode;
  toolOk = !(st.activeTool.type === 'line' && st.activeTool.locked);
  colorOk = st.currentItemStrokeColor === prevColor;
  if (off && toolOk && colorOk) break;
  await new Promise(r => setTimeout(r, 20));
}
const msg = 'after Esc mode ' + (off ? 'off' : 'ON') + ', tool ' + st.activeTool.type + (st.activeTool.locked ? ' (locked)' : '') + ', stroke ' + (colorOk ? 'restored' : 'still ' + st.currentItemStrokeColor);
T.pass(off && toolOk && colorOk, msg, msg);
JS
