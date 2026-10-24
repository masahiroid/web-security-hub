'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluate } = require('../scripts/audit-gate');

const rule = { advisory: 'GHSA-aaaa', path: 'node_modules/a/node_modules/b', expires: '2026-12-31' };
const report = (nodes, id = 'GHSA-aaaa') => ({ vulnerabilities: { b: { nodes, via: [{ name: 'b', url: `https://github.com/advisories/${id}` }, 'parent'] } } });

test('an accepted advisory in its accepted path passes until it expires', () => {
  assert.equal(evaluate(report([rule.path]), [rule], '2026-12-31').rejected.length, 0);
  const late = evaluate(report([rule.path]), [rule], '2027-01-01');
  assert.equal(late.rejected.length, 1);
  assert.equal(late.rejected[0].expired, true);
});

test('the same advisory in another path, or another advisory, is rejected', () => {
  assert.equal(evaluate(report(['node_modules/b']), [rule], '2026-11-01').rejected.length, 1);
  assert.equal(evaluate(report([rule.path], 'GHSA-bbbb'), [rule], '2026-11-01').rejected.length, 1);
});
