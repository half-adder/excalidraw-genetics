#!/usr/bin/env bash
# The plugin engine of the test harness: the fly-genetics plugin is loaded
# from this checkout's main.js, its eight commands exist and are available in
# the harness drawing, T.run returns the commands' errors, and a modal left open
# by the plugin is closed when the test ends. Run with FLY_ENGINE=plugin.
# Prints PASS/FAIL; exit 0 only if all pass.
source "$(dirname "$0")/lib.sh"
status=0
fly_test <<'JS' || status=$?
const P = app.plugins.plugins['fly-genetics'];
T.pass(!!P, 'plugin loaded', 'plugin not loaded');
const names = ['Genotype', 'Cross Genotypes', 'Cross Mode', 'Tidy', 'Tidy Below', 'Select Below', 'Select Lineage', 'Break Cross'];
const cid = n => 'fly-genetics:' + n.toLowerCase().replace(/ /g, '-');
const missing = names.filter(n => !app.commands.commands[cid(n)]);
T.pass(!missing.length, 'all eight commands registered', 'missing commands: ' + missing.join(', '));
const avail = names.filter(n => app.commands.commands[cid(n)].checkCallback(true));
T.pass(avail.length === names.length, 'commands available in an Excalidraw drawing', 'unavailable: ' + names.filter(n => !avail.includes(n)).join(', '));
const errs = await T.run('Tidy', { tolerate: true });
T.pass(Array.isArray(errs), 'T.run returns the command errors (' + errs.length + ')', 'T.run did not return errors');
// A stand-in for a form left open: the harness must close it when the test ends.
window.__flySmokeClosed = false;
P.testing.modals.add({ close() { window.__flySmokeClosed = true; } });
T.check('PASS: registered an open modal for the cleanup check');
JS
closed=$(ev "String(window.__flySmokeClosed)")
[[ "$closed" == "true" ]] && echo "PASS: the harness closed the plugin's open modal" || { echo "FAIL: the plugin's open modal was not closed"; status=1; }
exit $status
