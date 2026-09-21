'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { candidatesFromDescriptor, similarityScore } = require('../core/scenario/locatorStrategy');
const { resolveWithHealing } = require('../core/scenario/locatorStrategy');

test('candidatesFromDescriptor ranks id above data-testid above name above text', () => {
  const candidates = candidatesFromDescriptor({ tag: 'button', id: 'submit-btn', dataTestId: 'submit', name: 'submit', text: 'Submit' });
  assert.equal(candidates[0], '#submit-btn');
  assert.match(candidates[1], /data-testid="submit"/);
});

test('candidatesFromDescriptor falls back to text/class when no stable attributes exist', () => {
  const candidates = candidatesFromDescriptor({ tag: 'button', text: 'Continue', classes: ['btn', 'btn-primary'] });
  assert.deepEqual(candidates, ['text="Continue"', 'button.btn.btn-primary']);
});

test('candidatesFromDescriptor returns nothing for an empty descriptor', () => {
  assert.deepEqual(candidatesFromDescriptor({}), []);
  assert.deepEqual(candidatesFromDescriptor(undefined), []);
});

test('similarityScore rewards matching name/ariaLabel/placeholder more than a bare tag match', () => {
  const hint = { tag: 'input', name: 'email', type: 'email', placeholder: 'you@example.com' };
  const exactMatch = similarityScore(hint, { tag: 'input', name: 'email', type: 'email', placeholder: 'you@example.com' });
  const tagOnlyMatch = similarityScore(hint, { tag: 'input', name: 'other-field', type: 'text' });
  assert.ok(exactMatch > tagOnlyMatch);
  assert.ok(exactMatch >= 5);
});

test('resolveWithHealing returns the primary locator untouched when it resolves', async () => {
  const fakePage = {
    locator: (selector) => ({
      first: () => ({ waitFor: async () => {} }),
      __selector: selector,
    }),
  };
  const result = await resolveWithHealing(fakePage, { selector: '#login-button' });
  assert.equal(result.healed, false);
  assert.equal(result.usedSelector, '#login-button');
});

test('resolveWithHealing throws the original error when the primary selector fails and there is no healHint', async () => {
  const fakePage = {
    locator: () => ({ first: () => ({ waitFor: async () => { throw new Error('not found'); } }) }),
  };
  await assert.rejects(() => resolveWithHealing(fakePage, { selector: '#gone' }), /not found/);
});

test('resolveWithHealing falls back to a healHint-derived candidate when the primary selector fails', async () => {
  const attempts = [];
  const fakePage = {
    locator: (selector) => {
      attempts.push(selector);
      return {
        first: () => ({
          waitFor: async () => {
            if (selector !== '#stable-testid-target' && !selector.includes('data-testid')) throw new Error('not found');
          },
        }),
      };
    },
  };
  const step = { selector: '#old-id', healHint: { tag: 'button', dataTestId: 'stable-testid-target' } };
  const result = await resolveWithHealing(fakePage, step);
  assert.equal(result.healed, true);
  assert.equal(result.strategy, 'fallback-selector');
  assert.ok(attempts.some((a) => a.includes('data-testid="stable-testid-target"')));
});
