#!/usr/bin/env bash
# Regression test: Tidy must keep sibling offspring in the left-to-right order
# the user placed them. Fixture sibling-order: a cross with two offspring,
# tidied. Drags the left sibling to the right of the other, keeps it
# selected, runs Tidy, and checks that the dragged sibling is still on the
# right. Prints PASS or FAIL; exit 0 on PASS.
source "$(dirname "$0")/lib.sh"
fly_test <<'JS'
await T.fixture('sibling-order');
T.setup(['P1', 'P2', 'A', 'B']);
const [L, R] = F.cx('A') < F.cx('B') ? ['A', 'B'] : ['B', 'A'];
await F.move({ [L]: [F.cx(R) - F.cx(L) + 400, 0] }, false);
F.select([L]);
T.out(L + ' dragged right of ' + R);
await T.tidy();
T.pass(F.cx(L) > F.cx(R), 'after Tidy ' + L + '.x=' + Math.round(F.cx(L)) + ' ' + R + '.x=' + Math.round(F.cx(R)),
  'after Tidy ' + L + '.x=' + Math.round(F.cx(L)) + ' ' + R + '.x=' + Math.round(F.cx(R)));
JS
